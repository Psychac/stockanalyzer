import { useSyncExternalStore } from 'react'

/**
 * Sign-in to this deployment's own backend (see api/_lib/auth.ts). The browser holds only an HttpOnly cookie that scripts
 * cannot read, so there is no secret to store, and nothing here is persisted.
 */
export interface AuthState {
  /** Loaded from the server yet. */
  known: boolean
  /** The deployment has an APP_PASSWORD, so signing in is possible. False on a static host or a local run. */
  configured: boolean
  signedIn: boolean
}

let state: AuthState = { known: false, configured: false, signedIn: false }
const listeners = new Set<() => void>()
const set = (next: Partial<AuthState>) => { state = { ...state, ...next }; listeners.forEach(l => l()) }

type FetchFn = typeof fetch

/** Secrets that earlier versions kept in this browser. They are not used any more, so remove them. */
export function forgetLegacySecrets() {
  try { localStorage.removeItem('ingestSecret'); localStorage.removeItem('breeze.relayCode') } catch { /* storage unavailable */ }
}

export async function refreshAuth(fetchFn: FetchFn = fetch): Promise<void> {
  try {
    const r = await fetchFn('/api/auth', { cache: 'no-store' })
    const body = (await r.json().catch(() => null)) as { configured?: boolean; signedIn?: boolean } | null
    set({ known: true, configured: r.ok && body?.configured === true, signedIn: r.ok && body?.signedIn === true })
  } catch {
    set({ known: true, configured: false, signedIn: false })
  }
}

/** Resolves to an error message, or null when signed in. */
export async function signIn(password: string, fetchFn: FetchFn = fetch): Promise<string | null> {
  try {
    const r = await fetchFn('/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
    const body = (await r.json().catch(() => ({}))) as { error?: string }
    if (r.ok) { set({ known: true, configured: true, signedIn: true }); return null }
    return body.error ?? `Sign-in failed (HTTP ${r.status}).`
  } catch {
    return 'Could not reach the server.'
  }
}

export async function signOut(fetchFn: FetchFn = fetch): Promise<void> {
  try { await fetchFn('/api/auth', { method: 'DELETE' }) } catch { /* the cookie simply stays until it expires */ }
  set({ signedIn: false })
}

export function useAuth(): AuthState {
  return useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, () => state)
}

/** Test hook. */
export const authState = () => state
