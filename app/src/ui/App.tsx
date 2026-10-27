import { useEffect, type ReactNode } from 'react'
import { useApp, type Route } from '../store'
import { Dashboard } from './pages/Dashboard'
import { Discover } from './pages/Discover'
import { Shortlist } from './pages/Shortlist'
import { Charts } from './pages/Charts'
import { SettingsPage } from './pages/Settings'
import { Planned } from './pages/Planned'
import { DataBadge, FeedBanner } from './components/bits'
import { dateOnly } from './format'

const ICONS: Record<Route, ReactNode> = {
  dashboard: <path d="M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z" />,
  discover: <path d="M10 2a8 8 0 1 0 4.9 14.3l5.4 5.4 1.4-1.4-5.4-5.4A8 8 0 0 0 10 2Zm0 2a6 6 0 1 1 0 12 6 6 0 0 1 0-12Z" />,
  shortlist: <path d="m12 17.3 6.2 3.7-1.6-7 5.4-4.7-7.2-.6L12 2 9.2 8.7 2 9.3l5.5 4.7-1.7 7 6.2-3.7Z" />,
  charts: <path d="M4 20V10h3v10H4Zm6.5 0V4h3v16h-3ZM17 20v-7h3v7h-3Z" />,
  journal: <path d="M6 2h11a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6V2Zm2 2v16h9V4H8Zm-4 3h2v2H4V7Zm0 4h2v2H4v-2Zm0 4h2v2H4v-2Z" />,
  news: <path d="M4 5h13v14H4V5Zm15 3h2v9a2 2 0 0 1-2 2V8ZM6 7v4h9V7H6Zm0 6v2h9v-2H6Z" />,
  settings: <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8.4 5.3 1.7 1.3-2 3.4-2-.8a7.600 7.600 0 0 1-1.700 1l-.3 2.100h-4l-.3-2.100a7.600 7.600 0 0 1-1.700-1l-2 .8-2-3.400 1.700-1.300a7.800 7.800 0 0 1 0-2l-1.700-1.300 2-3.400 2 .8a7.600 7.600 0 0 1 1.700-1L10 4.500h4l.3 2.100c.6.200 1.200.6 1.700 1l2-.8 2 3.400-1.700 1.300c.1.700.1 1.300.1 2Z" />,
}

const NAV: { key: Route; label: string; mobile: boolean; soon?: boolean }[] = [
  { key: 'dashboard', label: 'Dashboard', mobile: true },
  { key: 'discover', label: 'Discover', mobile: true },
  { key: 'shortlist', label: 'Shortlist', mobile: true },
  { key: 'charts', label: 'Charts', mobile: true },
  { key: 'journal', label: 'Journal', mobile: false, soon: true },
  { key: 'news', label: 'News', mobile: false, soon: true },
  { key: 'settings', label: 'Settings', mobile: true },
]

const Icon = ({ r, className = '' }: { r: Route; className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={`h-5 w-5 ${className}`}>{ICONS[r]}</svg>
)

function Page({ route }: { route: Route }) {
  switch (route) {
    case 'dashboard': return <Dashboard />
    case 'discover': return <Discover />
    case 'shortlist': return <Shortlist />
    case 'charts': return <Charts />
    case 'settings': return <SettingsPage />
    case 'journal': return <Planned title="Journal" milestone="Milestone 6" bullets={['Paper trades with costs and slippage', 'Strategy version preserved on every trade', 'Win rate, expectancy, drawdown']} />
    case 'news': return <Planned title="News & disclosures" milestone="Milestone 5" bullets={['NSE/BSE announcements and corporate actions', 'SEBI and RBI updates', 'Source-labelled links, never a buy/sell trigger']} />
  }
}

export function App() {
  const route = useApp(s => s.route)
  const go = useApp(s => s.go)
  const init = useApp(s => s.init)
  const set = useApp(s => s.benchmark)
  useEffect(() => { void init() }, [init])
  useEffect(() => { window.scrollTo({ top: 0 }) }, [route])

  return (
    <div className="mx-auto flex min-h-full max-w-[1500px]">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line/70 p-4 md:flex">
        <div className="mb-6 flex items-center gap-2.5 px-2 pt-1">
          <img src="icon.svg" alt="" className="h-8 w-8" />
          <div className="leading-tight">
            <div className="text-[15px] font-semibold">Stock Analyzer</div>
            <div className="text-[11px] text-mute">NSE research & trade plans</div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map(n => (
            <button key={n.key} onClick={() => go(n.key)} className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${route === n.key ? 'bg-panel2 text-ink shadow-[inset_2px_0_0_var(--color-accent)]' : 'text-mute hover:bg-panel hover:text-ink'}`}>
              <Icon r={n.key} className={route === n.key ? 'text-accent' : ''} />
              {n.label}
              {n.soon && <span className="ml-auto rounded-full bg-panel2 px-2 py-0.5 text-[10px] uppercase tracking-wide text-mute">Soon</span>}
            </button>
          ))}
        </nav>
        <div className="space-y-2 px-1">
          <DataBadge compact />
          {set && <p className="text-[11px] text-mute">{set.candles[set.candles.length - 1]?.closed === false ? `Session in progress · ${dateOnly(set.asOf)}` : `Prices as of ${dateOnly(set.asOf)} close`}</p>}
          <p className="text-[10px] leading-snug text-mute">Chart by TradingView Lightweight Charts™. Data stays on this device.</p>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-x-clip px-4 pb-28 pt-5 md:px-8 md:pb-10 md:pt-8">
        <div className="mb-4 flex items-center justify-between md:hidden">
          <div className="flex items-center gap-2"><img src="icon.svg" alt="" className="h-7 w-7" /><span className="font-semibold">Stock Analyzer</span></div>
          <DataBadge compact />
        </div>
        <FeedBanner />
        <div key={route} className="rise"><Page route={route} /></div>
      </main>

      <nav className="safe-b fixed inset-x-0 bottom-0 z-30 flex border-t border-line/80 bg-panel/90 px-1 pt-1 backdrop-blur-xl md:hidden">
        {NAV.filter(n => n.mobile).map(n => (
          <button key={n.key} onClick={() => go(n.key)} className={`flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10px] ${route === n.key ? 'text-accent' : 'text-mute'}`}>
            <Icon r={n.key} />
            {n.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
