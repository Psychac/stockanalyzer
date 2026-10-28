import type { ReactNode } from 'react'
import type { CandleSet } from '../../domain/types'
import { STATE_LABEL, type SignalState } from '../../domain/trade'
import { useApp } from '../../store'
import { isMarketOpen } from '../../domain/time'
import { dateOnly, pct, price, timeOnly, tone } from '../format'

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-mute">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">{actions}</div>
    </div>
  )
}

/** Always visible: tells the user what the numbers on screen actually are (spec §5.5). */
export function DataBadge({ set, compact }: { set?: CandleSet | null; compact?: boolean }) {
  const feed = useApp(s => s.feed)
  const source = useApp(s => s.source)
  const loading =useApp(s => s.marketStatus === 'loading')
  const now = Date.now()
  const open = isMarketOpen(now)
  const view = loading ? { text: 'LOADING', tone: 'accent', tip: 'Loading market data…' } : {
    demo: { text: 'DEMO DATA', tone: 'warn', tip: 'Synthetic data for development. Not real prices.' },
    live: open && feed.updatedAt
      ? { text: 'LIVE', tone: 'up', tip: `Live prices${feed.updatedAt ? `, last update ${timeOnly(feed.updatedAt)}` : ''}` }
      : { text: 'EOD', tone: 'up', tip: open ? 'End-of-day data. Waiting for the first live price.' : 'End-of-day data. The market is closed.' },
    cached: { text: 'CACHED', tone: 'warn', tip: feed.message ?? 'Saved on this device. Not connected.' },
    stale: { text: 'STALE', tone: 'down', tip: feed.message ?? 'Some data could not be refreshed.' },
    none: { text: 'NO DATA', tone: 'down', tip: 'No market data loaded.' },
  }[feed.mode]
  const color = { warn: 'border-warn/40 text-warn', up: 'border-up/40 text-up', down: 'border-down/40 text-down', accent: 'border-accent/40 text-accent' }[view.tone]
  const dot = { warn: 'bg-warn', up: 'bg-up', down: 'bg-down', accent: 'bg-accent' }[view.tone]
  if (set?.source === 'market') {
    return <span className="chip border-accent/40 text-accent" title="End-of-day data from the shared backend (NSE and BSE files), not a live feed"><span className="h-1.5 w-1.5 rounded-full bg-accent" />EOD · SHARED DATA<span className="text-mute">· as of {dateOnly(set.asOf)} close</span></span>
  }
  return (
    <span className={`chip ${color}`} title={view.tip}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot} ${feed.mode === 'live' && open && feed.updatedAt ? 'animate-pulse' : ''}`} />
      {!loading && feed.mode !== 'demo' && feed.mode !== 'none' && <span className="text-mute">{source === 'breeze' ? 'BREEZE' : 'FYERS'} ·</span>}
      {view.text}
      {!compact && !loading && set && <span className="text-mute">· {set.candles[set.candles.length - 1]?.closed === false ? `${dateOnly(set.asOf)} session in progress` : `as of ${dateOnly(set.asOf)} close`}</span>}
    </span>
  )
}

/** Explains degraded states and load progress; renders nothing when everything is healthy. */
export function FeedBanner() {
  const feed = useApp(s => s.feed)
  const status = useApp(s => s.marketStatus)
  const go = useApp(s => s.go)
  const loadMarket = useApp(s => s.loadMarket)
  const route = useApp(s => s.route)
  const source = useApp(s => s.source)
  if (status === 'loading' && feed.progress) {
    const pct = Math.round((feed.progress.done / feed.progress.total) * 100)
    return (
      <div className="card mb-4 p-3">
        <div className="flex justify-between text-xs"><span>Loading {source === 'breeze' ? 'Breeze' : 'FYERS'} history ({feed.progress.done}/{feed.progress.total}). Requests are paced to stay inside the free plan's limits.</span><span className="num text-mute">{pct}%</span></div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-panel2"><div className="h-full rounded-full bg-gradient-to-r from-accent to-up transition-all" style={{ width: `${pct}%` }} /></div>
      </div>
    )
  }
  if (feed.mode === 'demo' || feed.mode === 'live' || (!feed.message && feed.mode !== 'none')) return null
  // A full-page empty state already explains a failed load; the banner would only repeat it.
  if (status === 'loading' || status === 'error') return null
  const bad = feed.mode === 'stale' || feed.mode === 'none'
  return (
    <div className={`mb-4 flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm ${bad ? 'border-down/40 bg-down/5 text-down' : 'border-warn/40 bg-warn/5 text-warn'}`}>
      <span className="min-w-0 flex-1">{feed.message ?? 'No market data.'}</span>
      {route !== 'settings' && <button className="btn btn-sm" onClick={() => go('settings')}>Settings</button>}
      <button className="btn btn-sm" onClick={() => void loadMarket()}>Retry</button>
    </div>
  )
}

export function Skeleton({ className = 'h-24' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />
}

export function Empty({ icon = '◌', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center">
      <div className="text-3xl text-mute">{icon}</div>
      <div className="font-medium">{title}</div>
      {children && <div className="max-w-md text-sm text-mute">{children}</div>}
    </div>
  )
}

/** Shown instead of a page's content when no market data could be loaded. */
export function NoData() {
  const error = useApp(s => s.marketError)
  const go = useApp(s => s.go)
  const setSource = useApp(s => s.setSource)
  const source = useApp(s => s.source)
  return (
    <Empty icon="⚠" title="No market data">
      {error ?? 'Nothing has been loaded yet.'}
      <div className="mt-4 flex justify-center gap-2">
        <button className="btn btn-primary" onClick={() => go('settings')}>Open Settings</button>
        {source !== 'demo' && <button className="btn" onClick={() => void setSource('demo')}>Use demo data</button>}
      </div>
    </Empty>
  )
}

const STATE_STYLE: Record<SignalState, string> = {
  entry_eligible: 'border-up/40 bg-up/10 text-up',
  setup_forming: 'border-accent/40 bg-accent/10 text-accent',
  missed_entry: 'border-warn/40 bg-warn/10 text-warn',
  watching: 'border-line bg-panel2 text-mute',
  data_insufficient: 'border-line bg-panel2 text-mute',
}
export function StateBadge({ state }: { state: SignalState }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATE_STYLE[state]}`}>{STATE_LABEL[state]}</span>
}

export function ScoreRing({ score, size = 44 }: { score: number | null; size?: number }) {
  const r = size / 2 - 4
  const c = 2 * Math.PI * r
  const v = score === null ? 0 : Math.max(0, Math.min(100, score))
  const color = v >= 70 ? 'var(--color-up)' : v >= 45 ? 'var(--color-accent)' : 'var(--color-mute)'
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title="Setup score (technical, explainable). Not a probability of profit.">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth="4" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} />
      </svg>
      <div className="num absolute inset-0 grid place-items-center text-[11px] font-semibold">{score === null ? '—' : Math.round(v)}</div>
    </div>
  )
}

export function Sparkline({ values, width = 84, height = 28 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`)
  const up = values[values.length - 1] >= values[0]
  const color = up ? 'var(--color-up)' : 'var(--color-down)'
  return (
    <svg width={width} height={height} className="shrink-0" aria-hidden>
      <defs>
        <linearGradient id={`sg-${up}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.25" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${pts.join(' ')} ${width},${height}`} fill={`url(#sg-${up})`} />
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export function StarButton({ instrumentId, source }: { instrumentId: string; source: string }) {
  const on = useApp(s => s.shortlist.some(x => x.instrumentId === instrumentId))
  const add = useApp(s => s.addToShortlist)
  const remove = useApp(s => s.removeFromShortlist)
  return (
    <button
      className={`grid h-8 w-8 place-items-center rounded-lg text-lg transition hover:bg-panel2 ${on ? 'text-warn' : 'text-mute'}`}
      aria-label={on ? 'Remove from shortlist' : 'Add to shortlist'}
      onClick={e => { e.stopPropagation(); void (on ? remove(instrumentId) : add(instrumentId, source)) }}
    >
      {on ? '★' : '☆'}
    </button>
  )
}

export const Disclaimer = () => (
  <p className="text-[11px] leading-relaxed text-mute">
    Informational only, not investment advice. Signals are rule-based and unvalidated; trading involves risk of loss. Stop-losses do not guarantee execution at the stop price.
  </p>
)

export function IndexStrip() {
  const levels = useApp(s => s.indexLevels)
  const source = useApp(s => s.source)
  const status = useApp(s => s.marketStatus)
  // Demo data must never sit beside real index levels.
  if (source === 'demo' || status !== 'ready') return null
  if (levels.length === 0) {
    return <p className="mb-4 text-xs text-mute">Index levels are not available from Breeze yet. They appear once Breeze returns daily bars for the Nifty indices.</p>
  }
  return (
    <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
      {levels.map(l => {
        const chg = l.prevClose ? (l.ltp / l.prevClose - 1) * 100 : null
        return (
          <div key={l.id} className="card min-w-[8.5rem] shrink-0 px-3 py-2.5" title={l.live ? 'Live tick' : 'Last daily close'}>
            <div className="flex items-center justify-between gap-2 text-[11px] text-mute">
              <span className="truncate">{l.name}</span>
              <span className={`flex items-center gap-1 ${l.live ? 'text-up' : ''}`}><span className={`h-1.5 w-1.5 rounded-full ${l.live ? 'animate-pulse bg-up' : 'bg-mute'}`} />{l.live ? 'LIVE' : 'EOD'}</span>
            </div>
            <div className="num mt-0.5 text-base font-semibold">{price(l.ltp)}</div>
            <div className={`num text-xs font-medium ${chg === null ? 'text-mute' : tone(chg)}`}>{chg === null ? '—' : pct(chg)}</div>
          </div>
        )
      })}
    </div>
  )
}
