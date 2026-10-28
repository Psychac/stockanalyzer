import { useState, useRef } from 'react'
import { exportData, importData, db } from '../../db/db'
import { useApp } from '../../store'
import { Disclaimer, PageHeader } from '../components/bits'
import { redirectUri } from '../../providers/fyers/auth'
import { dateTime } from '../format'
import { BreezePanel } from '../components/BreezePanel'

const NumField = ({ label, value, onChange, suffix, step = 1 }: { label: string; value: number; onChange: (n: number) => void; suffix?: string; step?: number }) => (
  <label className="block">
    <span className="label">{label}</span>
    <div className="relative mt-1">
      <input className="field num pr-9" type="number" step={step} min={0} value={value} onChange={e => onChange(Number(e.target.value))} />
      {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-mute">{suffix}</span>}
    </div>
  </label>
)

export function SettingsPage() {
  const settings = useApp(s => s.settings)
  const setSettings = useApp(s => s.setSettings)
  const reload = useApp(s => s.reloadUserData)
  const fileRef = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const patch = (p: Partial<typeof settings>) => void setSettings({ ...settings, ...p })

  async function doExport() {
    const blob = new Blob([JSON.stringify(await exportData(), null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `stock-analyzer-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    setMsg({ ok: true, text: 'Exported scanners, shortlist and settings. No credentials are included.' })
  }

  async function doImport(file: File) {
    try {
      const r = await importData(JSON.parse(await file.text()))
      await reload()
      setMsg({ ok: true, text: `Imported ${r.scanners} scanner(s) and ${r.shortlist} shortlist item(s).` })
    } catch (e) {
      setMsg({ ok: false, text: `Import failed: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  return (
    <>
      <PageHeader title="Settings" subtitle="Everything here is stored on this device only." />
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card space-y-4 p-5">
          <div><h2 className="font-semibold">Risk &amp; sizing</h2><p className="text-xs text-mute">Used to size every trade plan: shares = floor(risk budget ÷ risk per share).</p></div>
          <div className="grid grid-cols-2 gap-3">
            <NumField label="Trading capital" value={settings.capital} onChange={n => patch({ capital: n })} suffix="₹" step={10000} />
            <NumField label="Risk per trade" value={settings.riskPct} onChange={n => patch({ riskPct: n })} suffix="%" step={0.25} />
            <NumField label="Max position size" value={settings.maxPositionPct} onChange={n => patch({ maxPositionPct: n })} suffix="%" step={5} />
            <NumField label="Round-trip costs" value={settings.roundTripCostPct} onChange={n => patch({ roundTripCostPct: n })} suffix="%" step={0.05} />
            <NumField label="Target 1" value={settings.rr1} onChange={n => patch({ rr1: n })} suffix="R" step={0.5} />
            <NumField label="Target 2" value={settings.rr2} onChange={n => patch({ rr2: n })} suffix="R" step={0.5} />
          </div>
          <p className="text-xs text-mute">Costs are an estimate (brokerage, STT, exchange fees, slippage). Check your broker's contract note.</p>
        </section>

        <MarketDataCard />

        <MarketWideCard />

        <section className="card space-y-3 p-5">
          <h2 className="font-semibold">Backup &amp; restore</h2>
          <p className="text-xs text-mute">Move scanners, shortlist and settings between devices. No sync service involved.</p>
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={() => void doExport()}>Export JSON</button>
            <button className="btn" onClick={() => fileRef.current?.click()}>Import JSON</button>
            <input ref={fileRef} type="file" accept="application/json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void doImport(f); e.target.value = '' }} />
          </div>
          {msg && <p className={`text-xs ${msg.ok ? 'text-up' : 'text-down'}`}>{msg.text}</p>}
        </section>

        <section className="card space-y-3 p-5">
          <h2 className="font-semibold">Local data</h2>
          <p className="text-xs text-mute">Clears your scanners, shortlist, cached scan results and settings from this device. Built-in presets are unaffected.</p>
          <button className="btn text-down" onClick={async () => { if (confirm('Delete all local data on this device?')) { await db.delete(); location.reload() } }}>Erase local data</button>
        </section>
      </div>
      <div className="mt-6"><Disclaimer /></div>
    </>
  )
}

function MarketDataCard() {
  const { source, fyers, feed, marketStatus, setSource, connectFyers, disconnectFyers, loadMarket } = useApp()
  const [appId, setAppId] = useState(fyers.appId)
  const [secret, setSecret] = useState('')
  const [remember, setRemember] = useState(fyers.hasSecret)
  const [copied, setCopied] = useState(false)
  const redirect = redirectUri()
  const session = fyers.session
  const loading = marketStatus === 'loading'
  const canConnect = appId.trim().length > 0 && (secret.trim().length > 0)

  return (
    <section className="card space-y-4 p-5 lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="font-semibold">Live price source</h2><p className="text-xs text-mute">Where the tracked 50 stocks and live prices come from. Your choice is remembered on this device. Market-wide end-of-day data is separate, below.</p></div>
        <div className="flex rounded-xl bg-bg/60 p-1 text-sm">
          {([['demo', 'Demo data'], ['fyers', 'FYERS'], ['breeze', 'ICICI Breeze']] as const).map(([k, label]) => (
            <button key={k} disabled={loading} onClick={() => source !== k && void setSource(k)} className={`rounded-lg px-3 py-1.5 transition disabled:opacity-50 ${source === k ? 'bg-panel2 text-ink' : 'text-mute hover:text-ink'}`}>{label}</button>
          ))}
        </div>
      </div>

      {source === 'demo' && (
        <div className="rounded-xl border border-warn/30 bg-warn/5 p-3 text-xs text-mute">
          <span className="font-medium text-warn">Synthetic data.</span> Scanners and charts run on generated prices so the app can be explored end to end. Switch to FYERS for real NSE data.
        </div>
      )}

      {source === 'breeze' && <BreezePanel />}

      {source === 'fyers' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-3">
            <div className={`rounded-xl border p-3 text-sm ${session ? 'border-up/30 bg-up/5' : 'border-line'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{session ? 'Connected' : 'Not connected'}</span>
                {session && <span className="chip border-up/40 text-up">Session active</span>}
              </div>
              <p className="mt-1 text-xs text-mute">
                {session ? `Signed in as ${session.appId}. FYERS sessions end at 06:30 IST (${dateTime(session.expiresAt)}); reconnect each trading day.` : 'Log in with your FYERS app to load live NSE prices. Without a session the app shows data saved on this device.'}
              </p>
            </div>
            {fyers.loginError && <p className="rounded-lg border border-down/40 bg-down/5 p-2.5 text-xs text-down">{fyers.loginError}</p>}
            {feed.message && source === 'fyers' && <p className="text-xs text-warn">{feed.message}</p>}

            <label className="block"><span className="label">App ID</span><input className="field mt-1" placeholder="XXXXXXXXXX-100" autoComplete="off" value={appId} onChange={e => setAppId(e.target.value)} /></label>
            <label className="block"><span className="label">App secret</span><input className="field mt-1" type="password" autoComplete="off" placeholder={fyers.hasSecret ? 'Saved on this device. Enter again to change' : ''} value={secret} onChange={e => setSecret(e.target.value)} /></label>
            <label className="flex items-start gap-2 text-xs text-mute">
              <input type="checkbox" className="mt-0.5 accent-[var(--color-accent)]" checked={remember} onChange={e => setRemember(e.target.checked)} />
              <span>Remember the secret on this device so reconnecting only needs a tap. It is stored unencrypted in this browser's local database and is never included in backups. Leave unchecked to type it each day.</span>
            </label>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-primary" disabled={!canConnect} onClick={() => connectFyers(appId, secret, remember)}>{session ? 'Reconnect' : 'Connect FYERS'}</button>
              {session && <button className="btn" onClick={() => void disconnectFyers()}>Disconnect</button>}
              <button className="btn" disabled={loading} onClick={() => void loadMarket()}>{loading ? 'Loading…' : 'Refresh data'}</button>
            </div>
          </div>

          <div className="space-y-3 text-xs text-mute">
            <div className="rounded-xl border border-line p-3">
              <div className="label mb-1">Redirect URL for your FYERS app</div>
              <code className="block break-all rounded-lg bg-bg/60 p-2 text-[11px] text-ink">{redirect}</code>
              <button className="btn btn-sm mt-2" onClick={() => { void navigator.clipboard?.writeText(redirect); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>{copied ? 'Copied' : 'Copy'}</button>
              <p className="mt-2">FYERS only redirects to the exact URL registered on the app, so register this one unchanged.</p>
            </div>
            <ol className="list-decimal space-y-1.5 pl-4">
              <li>In your FYERS API dashboard, create an <span className="text-ink">individual</span> app.</li>
              <li>Paste the redirect URL above.</li>
              <li>Grant <span className="text-ink">Market Data</span> permission only. This app never places orders, so give it no trading rights.</li>
              <li>Enter the App ID and secret here and connect.</li>
            </ol>
            <p>The secret is used once at login to prove your identity (as a hash). Prices come straight from FYERS to this device; there is no server in between.</p>
            <p>Free plan limits: 50 data calls a minute and 100 live symbols. Requests are paced below that, and the first load takes a minute or two.</p>
          </div>
        </div>
      )}
    </section>
  )
}

/** The market-wide end-of-day data downloaded from this project's own backend. */
function MarketWideCard() {
  const meta = useApp(s => s.marketMeta)
  const market = useApp(s => s.market)
  const loadMarketData = useApp(s => s.loadMarketData)
  const clear = useApp(s => s.clearMarketData)
  const busy = market.status === 'loading'
  const total = (meta.NSE?.stocks ?? 0) + (meta.BSE?.stocks ?? 0)
  return (
    <section className="card space-y-3 p-5 lg:col-span-2">
      <div>
        <h2 className="font-semibold">Market-wide data <span className="text-xs font-normal text-mute">end-of-day</span></h2>
        <p className="text-xs text-mute">Liquid NSE and BSE stocks, published daily by your shared backend and screened on this device. It powers the All NSE and All BSE scans and search. It is public market data, so it is not part of backups.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {(['NSE', 'BSE'] as const).map(ex => {
          const m = meta[ex]
          return (
            <div key={ex} className="rounded-xl border border-line/80 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className={`chip !py-0 text-[11px] ${ex === 'BSE' ? 'text-warn' : 'text-accent'}`}>{ex}</span>
                <span className="text-xs text-mute">{m ? `${m.stocks.toLocaleString('en-IN')} stocks` : 'Not downloaded'}</span>
              </div>
              <p className="mt-1.5 text-xs text-mute">{m ? `As of ${m.date}. Saved ${dateTime(m.at)}.` : 'Downloads about 6 MB the first time, then only small daily updates.'}</p>
              <button className="btn btn-sm mt-2" disabled={busy} onClick={() => void loadMarketData([ex])}>{busy ? 'Working…' : m ? 'Check for updates' : `Download ${ex}`}</button>
            </div>
          )
        })}
      </div>
      {market.message && <p className={`text-xs ${market.status === 'error' ? 'text-down' : 'text-warn'}`}>{market.message}</p>}
      {total > 0 && (
        <button className="btn btn-sm text-down" disabled={busy} onClick={() => { if (confirm('Remove the downloaded market-wide data from this device? You can download it again.')) void clear() }}>Remove downloaded data</button>
      )}
    </section>
  )
}
