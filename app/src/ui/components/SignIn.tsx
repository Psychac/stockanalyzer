import { useState } from 'react'
import { signIn, signOut, useAuth } from '../../market/auth'

/** The deployment's one password. Shown wherever a feature needs the backend; signing in once unlocks all of them. */
export function SignIn({ why }: { why: string }) {
  const auth = useAuth()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!auth.known) return <p className="text-xs text-mute">Checking the server…</p>
  if (!auth.configured) return <p className="text-xs text-mute">{why} It needs a deployment with APP_PASSWORD set (a local run or a static host has no sign-in).</p>

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(await signIn(password))
    setBusy(false)
    setPassword('')
  }

  return (
    <form className="space-y-2" onSubmit={e => void submit(e)}>
      <label className="block">
        <span className="label">Password</span>
        <input className="field mt-1" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
      </label>
      <p className="text-xs text-mute">{why} Signing in sets a cookie that scripts cannot read; the password itself is not stored.</p>
      <button className="btn btn-primary" type="submit" disabled={busy || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
      {error && <p className="text-xs text-down">{error}</p>}
    </form>
  )
}

export function SignOutButton() {
  return <button className="btn" onClick={() => void signOut()}>Sign out</button>
}
