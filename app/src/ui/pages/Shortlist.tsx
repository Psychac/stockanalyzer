import { STATUSES, type ShortlistStatus } from '../../db/db'
import { useApp } from '../../store'
import { Empty, ExchangeTag, PageHeader, Sparkline } from '../components/bits'
import { dateOnly, pct, price, tone } from '../format'

export function Shortlist() {
  const shortlist = useApp(s => s.shortlist)
  const setFor = useApp(s => s.setFor)
  const marketStatus = useApp(s => s.market.status)
  const update = useApp(s => s.updateShortlist)
  const remove = useApp(s => s.removeFromShortlist)
  const openChart = useApp(s => s.openChart)
  const go = useApp(s => s.go)

  if (shortlist.length === 0) {
    return (
      <>
        <PageHeader title="Shortlist" subtitle="Candidates you are researching, grouped by status." />
        <Empty icon="☆" title="Nothing shortlisted yet">
          Run a scanner in Discover and star promising stocks. They are saved on this device and available offline.
          <div className="mt-4"><button className="btn btn-primary" onClick={() => go('discover')}>Go to Discover</button></div>
        </Empty>
      </>
    )
  }

  return (
    <>
      <PageHeader title="Shortlist" subtitle={`${shortlist.length} candidate${shortlist.length === 1 ? '' : 's'}. Move each one through your research.`} />
      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
        {STATUSES.map(st => {
          const items = shortlist.filter(s => s.status === st.key)
          return (
            <section key={st.key} className="space-y-3">
              <div className="flex items-center gap-2 px-1"><h2 className="text-sm font-semibold">{st.label}</h2><span className="chip">{items.length}</span></div>
              {items.length === 0 && <div className="rounded-2xl border border-dashed border-line/70 p-4 text-center text-xs text-mute">Empty</div>}
              {items.map(item => {
                const set = setFor(item.instrumentId)
                if (!set) {
                  // A stock from the market-wide data whose files are not on this device yet.
                  return (
                    <article key={item.instrumentId} className="card p-4">
                      <div className="flex items-center gap-2 font-semibold">{item.instrumentId.replace(/^\w+:/, '')}<ExchangeTag id={item.instrumentId} /></div>
                      <p className="mt-1 text-xs text-mute">{marketStatus === 'loading' ? 'Loading market data…' : 'Prices need the market-wide data. Run a scan on All NSE or All BSE in Discover to load it.'}</p>
                      <button className="btn btn-sm btn-ghost mt-2 text-down" onClick={() => void remove(item.instrumentId)}>Remove</button>
                    </article>
                  )
                }
                const c = set.candles
                const last = c[c.length - 1].c
                const chg = (last / c[c.length - 2].c - 1) * 100
                return (
                  <article key={item.instrumentId} className="card p-4">
                    <div className="flex cursor-pointer items-start justify-between gap-2" onClick={() => openChart(item.instrumentId)}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 font-semibold">{set.instrument.symbol}<ExchangeTag id={item.instrumentId} /></div>
                        <div className="truncate text-xs text-mute">{set.instrument.name}</div>
                      </div>
                      <div className="text-right"><div className="num font-medium">₹{price(last)}</div><div className={`num text-xs ${tone(chg)}`}>{pct(chg)}</div></div>
                    </div>
                    <div className="mt-2 flex items-center justify-between"><Sparkline values={c.slice(-40).map(x => x.c)} width={120} height={28} /><span className="text-[11px] text-mute">via {item.source} · {dateOnly(item.addedAt)}</span></div>
                    <textarea className="field mt-3 min-h-[52px] resize-y text-xs" placeholder="Notes: thesis, levels, what would change your mind" defaultValue={item.note} onBlur={e => e.target.value !== item.note && void update(item.instrumentId, { note: e.target.value })} />
                    <div className="mt-3 flex items-center gap-2">
                      <select className="field !w-auto flex-1 !py-1 text-xs" value={item.status} onChange={e => void update(item.instrumentId, { status: e.target.value as ShortlistStatus })} aria-label="Status">
                        {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                      </select>
                      <button className="btn btn-sm" onClick={() => openChart(item.instrumentId)}>Plan</button>
                      <button className="btn btn-sm btn-ghost text-down" onClick={() => void remove(item.instrumentId)} aria-label="Remove">✕</button>
                    </div>
                  </article>
                )
              })}
            </section>
          )
        })}
      </div>
    </>
  )
}
