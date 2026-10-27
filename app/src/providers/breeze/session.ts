import { nextTokenExpiry } from '../../domain/time'
import { ProviderError } from '../errors'

/**
 * Breeze cannot be called from a browser: its session call is a GET with a JSON body and its data host sends no CORS
 * headers. These calls go through a same-origin relay (`api/_lib/breezeRelay.ts`) served by the Vite dev/preview server
 * or deployed as Vercel functions. A host without the relay answers with the app's own HTML, and the app says so.
 */
export const HELPER = '/api/breeze'

export interface BreezeSession {
  appKey: string
  /** Base64 of `userId:token`, exactly as Breeze returns it. Sent as X-SessionToken. */
  sessionToken: string
  userId: string
  /** The decoded token half, used to authenticate the streaming socket. */
  streamToken: string
  obtainedAt: number
  /** Breeze sessions are daily; the exact cut-off is not documented, so this assumes 06:30 IST like FYERS. */
  expiresAt: number
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>
const defaultFetch: FetchFn = (i, init) => fetch(i, init)

const CODE_KEY = 'breeze.relayCode'

/** Optional shared secret for a deployed relay (its BREEZE_RELAY_CODE setting). Kept in this browser only. */
export function getRelayCode(): string {
  try { return localStorage.getItem(CODE_KEY) ?? '' } catch { return '' }
}
export function setRelayCode(code: string) {
  try { if (code) localStorage.setItem(CODE_KEY, code); else localStorage.removeItem(CODE_KEY) } catch { /* not persisted */ }
}

/** Required on every relay call. A custom header forces a CORS preflight, which stops other websites poking the relay. */
export function helperHeaders(): Record<string, string> {
  const code = getRelayCode()
  return code ? { 'X-Breeze-Helper': '1', 'X-Relay-Code': code } : { 'X-Breeze-Helper': '1' }
}

export const loginUrl = (appKey: string) => `https://api.icicidirect.com/apiuser/login?api_key=${encodeURIComponent(appKey)}`

/**
 * Breeze redirects back with the one-time code. The docs call the parameter `API_Session`, but a real redirect arrived as
 * `apisession`, so match any casing with or without the underscore.
 */
export function apiSessionFromSearch(search: string): string | null {
  const q = new URLSearchParams(search)
  for (const [k, v] of q) if (k.toLowerCase().replace(/_/g, '') === 'apisession' && v) return v
  return null
}

export function decodeSessionToken(b64: string): { userId: string; token: string } {
  let text: string
  try { text = atob(b64) } catch { throw new ProviderError('Breeze returned a session token in an unexpected format.', 'api') }
  const i = text.indexOf(':')
  if (i <= 0 || i === text.length - 1) throw new ProviderError('Breeze returned a session token in an unexpected format.', 'api')
  return { userId: text.slice(0, i), token: text.slice(i + 1) }
}

export interface HelperInfo {
  available: boolean
  /** The deployed relay was configured with an access code. */
  needsCode: boolean
}

export async function helperInfo(fetchFn: FetchFn = defaultFetch): Promise<HelperInfo> {
  try {
    const res = await fetchFn(`${HELPER}/ping`, { headers: helperHeaders() })
    const body = (await res.json().catch(() => null)) as { helper?: string; needsCode?: boolean } | null
    const available = res.ok && body?.helper === 'breeze-relay'
    return { available, needsCode: available && body?.needsCode === true }
  } catch {
    return { available: false, needsCode: false }
  }
}

export const helperAvailable = async (fetchFn: FetchFn = defaultFetch) => (await helperInfo(fetchFn)).available

const HELPER_MISSING = 'The Breeze relay is not available here. Run the app with npm run dev, or deploy it with its api/ folder (see the README). A plain static host cannot reach Breeze.'

/** The relay refuses callers it does not trust before ICICI is ever contacted. */
export function relayRefusal(body: { relayError?: string; message?: string } | null, status: number): ProviderError | null {
  if (status !== 403 || !body?.relayError) return null
  if (body.relayError === 'code') return new ProviderError('The Breeze relay needs its access code. Enter it in Settings.', 'api')
  return new ProviderError(`The Breeze relay refused the request: ${body.message ?? 'not allowed'}`, 'api')
}

/** Documented error strings from the official SDK. */
function loginError(message: string): ProviderError {
  if (/invalid session/i.test(message)) return new ProviderError('Breeze did not accept that session code. Each code works once, so log in again for a fresh one.', 'auth')
  if (/public key/i.test(message)) return new ProviderError('Breeze does not recognise that app key. Check it in the Breeze API portal.', 'auth')
  if (/resource not available/i.test(message)) return new ProviderError('The Breeze session expired. Log in again.', 'auth')
  return new ProviderError(`Breeze login failed: ${message}`, 'auth')
}

export async function exchangeSession(appKey: string, apiSession: string, now = Date.now(), fetchFn: FetchFn = defaultFetch): Promise<BreezeSession> {
  let res: Response
  try {
    res = await fetchFn(`${HELPER}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...helperHeaders() },
      body: JSON.stringify({ appKey, apiSession }),
    })
  } catch {
    throw new ProviderError('Could not reach the Breeze relay.', 'network')
  }
  const body = (await res.json().catch(() => null)) as { Success?: { session_token?: string } | null; Error?: string | null; relayError?: string; message?: string } | null
  // A static host answers unknown paths with the app's own HTML, which is not JSON.
  if (body === null) throw new ProviderError(HELPER_MISSING, 'api')
  const refused = relayRefusal(body, res.status)
  if (refused) throw refused
  const token = body.Success?.session_token
  if (!res.ok || !token) throw loginError(body.Error ?? `HTTP ${res.status}`)
  const { userId, token: streamToken } = decodeSessionToken(token)
  return { appKey, sessionToken: token, userId, streamToken, obtainedAt: now, expiresAt: nextTokenExpiry(now) }
}

export { HELPER_MISSING }

const PENDING = 'breeze.pending'

/** Leaves for ICICI's login page; the app key is parked so the redirect back can finish the exchange. */
export function beginLogin(appKey: string) {
  try { sessionStorage.setItem(PENDING, appKey) } catch { /* private mode: use the paste field instead */ }
  location.assign(loginUrl(appKey))
}

/** Call on startup. Returns null when the URL is not a Breeze redirect. */
export async function completeLoginFromUrl(storedAppKey: string): Promise<BreezeSession | null> {
  const code = apiSessionFromSearch(location.search)
  if (!code) return null
  // Strip the one-time code from the address bar first so a reload cannot replay it.
  history.replaceState(null, '', `${location.pathname}${location.hash}`)
  let appKey = storedAppKey
  try { appKey = sessionStorage.getItem(PENDING) || storedAppKey; sessionStorage.removeItem(PENDING) } catch { /* fall back to the stored key */ }
  if (!appKey) throw new ProviderError('Breeze sent a session code but no app key is saved. Enter your app key and paste the code instead.', 'auth')
  return exchangeSession(appKey, code)
}
