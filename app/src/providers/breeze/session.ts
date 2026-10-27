import { nextTokenExpiry } from '../../domain/time'
import { ProviderError } from '../errors'

/**
 * Breeze cannot be called from a browser: its session call is a GET with a JSON body and its data host sends no CORS
 * headers. These calls go through a local helper that exists only in the Vite dev/preview server (`vite/breezeHelper.ts`).
 * An installed or statically hosted copy of the app has no helper, and says so.
 */
export const HELPER = '/__breeze'

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

/** Required on every helper call. A custom header forces a CORS preflight, which stops other websites poking the helper. */
export const helperHeaders = { 'X-Breeze-Helper': '1' }

export const loginUrl = (appKey: string) => `https://api.icicidirect.com/apiuser/login?api_key=${encodeURIComponent(appKey)}`

/** Breeze redirects back with the one-time code as `API_Session`. */
export function apiSessionFromSearch(search: string): string | null {
  const q = new URLSearchParams(search)
  for (const [k, v] of q) if (k.toLowerCase() === 'api_session' && v) return v
  return null
}

export function decodeSessionToken(b64: string): { userId: string; token: string } {
  let text: string
  try { text = atob(b64) } catch { throw new ProviderError('Breeze returned a session token in an unexpected format.', 'api') }
  const i = text.indexOf(':')
  if (i <= 0 || i === text.length - 1) throw new ProviderError('Breeze returned a session token in an unexpected format.', 'api')
  return { userId: text.slice(0, i), token: text.slice(i + 1) }
}

export async function helperAvailable(fetchFn: FetchFn = defaultFetch): Promise<boolean> {
  try {
    const res = await fetchFn(`${HELPER}/ping`, { headers: helperHeaders })
    const body = (await res.json().catch(() => null)) as { helper?: string } | null
    return res.ok && body?.helper === 'breeze-dev-proxy'
  } catch {
    return false
  }
}

const HELPER_MISSING = 'The Breeze helper is not running. Breeze only works through the local dev server (npm run dev); an installed or hosted copy cannot reach it.'

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
      headers: { 'Content-Type': 'application/json', ...helperHeaders },
      body: JSON.stringify({ appKey, apiSession }),
    })
  } catch {
    throw new ProviderError('Could not reach the Breeze helper.', 'network')
  }
  const body = (await res.json().catch(() => null)) as { Success?: { session_token?: string } | null; Error?: string | null; helper?: string } | null
  // A static host answers unknown paths with the app's own HTML, which is not JSON.
  if (body === null) throw new ProviderError(HELPER_MISSING, 'api')
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
