import { useEffect, useState } from 'react'
import { useApp } from '../../store'
import { redirectUri } from '../../providers/fyers/auth'
import { runBreezeDiagnostics, type DiagStep } from '../../providers/breeze/diagnostics'
import { getRelayCode, setRelayCode } from '../../providers/breeze/session'
import { dateTime } from '../format'

const dotClass = (s: DiagStep['status']) => (s === 'ok' ? 'bg-up/20 text-up' : s === 'fail' ? 'bg-down/15 text-down' : 'bg-warn/20 text-warn')
const dotGlyph = (s: DiagStep['status']) => (s === 'ok' ? '✓' : s === 'fail' ? '✗' : '!')

export function BreezePanel() {
  const { breeze, feed, marketStatus, connectBreeze, connectBreezeWithCode, disconnectBreeze, checkBreezeHelper, loadMarket } = useApp()
  const [appKey, setAppKey] = useState(breeze.appKey)
  const [code, setCode] = useState('')
  const [steps, setSteps] = useState<DiagStep[] | null>(null)
  const [running, setRunning] = useState(false)
  const session = breeze.session
  const loading = marketStatus === 'loading'
  const helperTone = breeze.helper === 'ok' ? 'border-up/30 bg-up/5 text-mute' : breeze.helper === 'missing' ? 'border-down/40 bg-down/5 text-down' : 'border-line text-mute'
  useEffect(() => { void checkBreezeHelper() }, [checkBreezeHelper])

  async function diagnose() {
    setRunning(true)
    setSteps([])
    try { await runBreezeDiagnostics(session, setSteps) } finally { setRunning(false) }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-3">
        <div className={`rounded-xl border p-3 text-xs ${helperTone}`}>
          <span className="font-medium text-ink">Breeze relay: {breeze.helper === 'ok' ? 'running' : breeze.helper === 'missing' ? 'not available' : 'checking…'}</span>
          <p className="mt-1">
            {breeze.helper === 'missing'
              ? 'Breeze blocks browsers (no CORS, and its login call is a GET with a body), so it needs a small relay on the same server as this app: npm run dev locally, or the api/ folder deployed on Vercel. A plain static host cannot use Breeze.'
              : 'Calls to ICICI are passed through the relay on this app’s own server. It stores nothing and only forwards your own login and history requests.'}
          </p>
        </div>
        {breeze.needsCode && (
          <label className="block">
            <span className="label">Relay access code</span>
            <input
              className="field mt-1" type="password" autoComplete="off" placeholder="Set as BREEZE_RELAY_CODE on the server"
              defaultValue={getRelayCode()}
              onChange={e => setRelayCode(e.target.value.trim())}
              onBlur={() => void checkBreezeHelper()}
            />
            <span className="mt-1 block text-[11px] text-mute">This relay is protected. The code is kept in this browser only.</span>
          </label>
        )}

        <div className={`rounded-xl border p-3 text-sm ${session ? 'border-up/30 bg-up/5' : 'border-line'}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{session ? 'Connected' : 'Not connected'}</span>
            {session && <span className="chip border-up/40 text-up">Session active</span>}
          </div>
          <p className="mt-1 text-xs text-mute">
            {session
              ? `Signed in as ${session.userId}. Sessions are daily; this one is assumed to last until ${dateTime(session.expiresAt)}.`
              : 'Log in with ICICI to load NSE prices. Without a session the app shows data saved on this device.'}
          </p>
        </div>
        {breeze.loginError && <p className="rounded-lg border border-down/40 bg-down/5 p-2.5 text-xs text-down">{breeze.loginError}</p>}
        {feed.message && <p className="text-xs text-warn">{feed.message}</p>}

        <label className="block">
          <span className="label">App key</span>
          <input className="field mt-1" autoComplete="off" value={appKey} onChange={e => setAppKey(e.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" disabled={!appKey.trim() || breeze.helper === 'missing'} onClick={() => connectBreeze(appKey)}>
            {session ? 'Log in again' : 'Log in with ICICI'}
          </button>
          {session && <button className="btn" onClick={() => void disconnectBreeze()}>Disconnect</button>}
          <button className="btn" disabled={loading} onClick={() => void loadMarket()}>{loading ? 'Loading…' : 'Refresh data'}</button>
        </div>

        <div className="rounded-xl border border-line p-3">
          <div className="label mb-1">Or paste the session code</div>
          <p className="mb-2 text-xs text-mute">
            If ICICI does not return you here after login, copy the <code className="text-ink">API_Session</code> value from the address bar of the page it lands on. Each code works once.
          </p>
          <div className="flex gap-2">
            <input className="field" placeholder="API_Session value" autoComplete="off" value={code} onChange={e => setCode(e.target.value)} />
            <button
              className="btn"
              disabled={!appKey.trim() || !code.trim() || breeze.helper === 'missing'}
              onClick={() => { void connectBreezeWithCode(appKey, code); setCode('') }}
            >
              Connect
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-3 text-xs text-mute">
        <div className="rounded-xl border border-line p-3">
          <div className="label mb-1">Redirect URL for your Breeze app</div>
          <code className="block break-all rounded-lg bg-bg/60 p-2 text-[11px] text-ink">{redirectUri()}</code>
          <p className="mt-2">Set this as the redirect URL in the Breeze API portal so login returns straight here. No secret key is needed: this app only reads data, and never signs requests or places orders.</p>
        </div>

        <div className="rounded-xl border border-line p-3">
          <div className="flex items-center justify-between">
            <span className="label">Connection test</span>
            <button className="btn btn-sm" disabled={running} onClick={() => void diagnose()}>{running ? 'Testing…' : 'Run test'}</button>
          </div>
          {steps === null && <p className="mt-2">Checks the helper, your session, a real history call, the symbol map and the live feed, one stage at a time.</p>}
          <ul className="mt-2 space-y-2">
            {steps?.map(st => (
              <li key={st.label} className="flex gap-2">
                <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] ${dotClass(st.status)}`}>{dotGlyph(st.status)}</span>
                <div><div className="text-ink">{st.label}</div><div>{st.detail}</div></div>
              </li>
            ))}
          </ul>
        </div>

        <p>Limits: 100 calls a minute and 5,000 a day. Requests are paced below that. History comes from daily bars; live prices come over ICICI's streaming socket and only flow while the market is open.</p>
        <p className="text-warn">The live feed is the least certain part: the official client sends a User-Agent header that browsers cannot set. If the test reports it cannot connect, history still works and prices stay end-of-day.</p>
      </div>
    </div>
  )
}
