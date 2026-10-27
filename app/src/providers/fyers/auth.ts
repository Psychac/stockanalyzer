import { nextTokenExpiry } from '../../domain/time'
import { FyersError } from './client'
import { FYERS_API, type FyersCredentials, type FyersSession } from './types'

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

/** FYERS sends the user back to this exact URL, so it must be registered on the app unchanged. */
export const redirectUri = () => `${location.origin}${location.pathname}`

export function loginUrl(appId: string, redirect: string, state: string): string {
  const q = new URLSearchParams({ client_id: appId, redirect_uri: redirect, response_type: 'code', state })
  return `${FYERS_API}/api/v3/generate-authcode?${q}`
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function exchangeAuthCode(
  appId: string, secret: string, code: string, now = Date.now(), fetchFn: FetchFn = (i, init) => fetch(i, init),
): Promise<FyersSession> {
  const appIdHash = await sha256Hex(`${appId}:${secret}`)
  let res: Response
  try {
    res = await fetchFn(`${FYERS_API}/api/v3/validate-authcode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', appIdHash, code }),
    })
  } catch {
    throw new FyersError('Could not reach FYERS to finish login.', 'network')
  }
  const body = (await res.json().catch(() => null)) as { s?: string; code?: number; message?: string; access_token?: string } | null
  if (!res.ok || body?.s !== 'ok' || !body.access_token) {
    throw new FyersError(body?.message ? `FYERS login failed: ${body.message}` : `FYERS login failed (HTTP ${res.status})`, 'auth', body?.code ?? null)
  }
  return { appId, accessToken: body.access_token, obtainedAt: now, expiresAt: nextTokenExpiry(now) }
}

/* The login round-trip leaves the page, so the in-flight request is parked in sessionStorage. */
const PENDING_KEY = 'fyers.pending'
interface Pending { state: string; appId: string; secret: string; remember: boolean }

const store = {
  read(): Pending | null {
    try { return JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? 'null') } catch { return null }
  },
  write(p: Pending) {
    try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(p)) } catch { /* private mode: login cannot complete */ }
  },
  clear() {
    try { sessionStorage.removeItem(PENDING_KEY) } catch { /* nothing to clear */ }
  },
}

export function beginLogin(appId: string, secret: string, remember: boolean) {
  const state = crypto.randomUUID().replaceAll('-', '')
  store.write({ state, appId, secret, remember })
  location.assign(loginUrl(appId, redirectUri(), state))
}

export interface CompletedLogin { session: FyersSession; credentials: FyersCredentials }

/** Call on startup. Returns null when the URL is not a FYERS redirect. */
export async function completeLoginFromUrl(): Promise<CompletedLogin | null> {
  const q = new URLSearchParams(location.search)
  const code = q.get('auth_code')
  if (!code) return null
  const state = q.get('state')
  // Drop the code from the address bar before anything else so a reload cannot replay it.
  history.replaceState(null, '', `${location.pathname}${location.hash}`)
  const pending = store.read()
  store.clear()
  if (!pending || pending.state !== state) throw new FyersError('Login response did not match the request. Start the connection again.', 'auth')
  const session = await exchangeAuthCode(pending.appId, pending.secret, code)
  return { session, credentials: { appId: pending.appId, secret: pending.remember ? pending.secret : undefined } }
}
