import { useMemo, useState } from 'react'
import { useApp } from '../../store'
import { STRATEGIES, type TradePlan } from '../../domain/trade'
import { makeContext } from '../../domain/scanner'
import type { Instrument } from '../../domain/types'
import { pulseFromSets } from '../../market/pulse'
import type { ExchangePulse, PulseMover } from '../../market/client'
import { DataBadge, Disclaimer, ExchangeTag, IndexStrip, NoData, PageHeader, Skeleton, Sparkline, StateBadge, StarButton } from '../components/bits'
import { dateOnly, pct, price, tone } from '../format'

export function Dashboard() {
  const status = useApp(s => s.marketStatus)
  const source = useApp(s => s.source)
  const sets = useApp(s => s.sets)
  const benchmark = useApp(s => s.benchmark)
  const shortlist = useApp(s => s.shortlist)
  const settings = useApp(s => s.settings)
  const pulse = useApp(s => s.pulse)
  const marketCounts = useApp(s => s.market.counts)
  const indexLevels = useApp(s => s.indexLevels)
  const indexSpark = useApp(s => s.indexSpark)
  const go = useApp(s => s.go)
  const setFor = useApp(s => s.setFor)
  const openChart = useApp(s => s.openChart)
  const openIndex = useApp(s => s.openIndex)
  const openMarketStock = useApp(s => s.openMarketStock)
  const [moversEx, setMoversEx] = useState<'NSE' | 'BSE'>('NSE')
  const demo = source === 'demo'

  // The watchlist: stocks you starred. Their prices come from the live source when one is connected, else the end-of-day files.
  const watch = useMemo(() => {
    const rows: { i: Instrument; last: number; chg: number; spark: number[] }[] = []
    const setups: { i: Instrument; plan: TradePlan; strategy: string }[] = []
    const params = { rr: [settings.rr1, settings.rr2] as [number, number] }
    for (const s of shortlist) {
      const set = setFor(s.instrumentId)
      const c = set?.candles
      if (!set || !c || c.length < 2) continue
      rows.push({ i: set.instrument, last: c[c.length - 1].c, chg: (c[c.length - 1].c / c[c.length - 2].c - 1) * 100, spark: c.slice(-30).map(x => x.c) })
      const ctx = makeContext(set, null)
      for (const st of STRATEGIES) {
        const plan = st.evaluate(set, params, ctx)
        if (plan.state === 'entry_eligible' || plan.state === 'setup_forming') setups.push({ i: set.instrument, plan, strategy: st.name })
      }
    }
    setups.sort((a, b) => Number(b.plan.state === 'entry_eligible') - Number(a.plan.state === 'entry_eligible') || b.plan.score - a.plan.score)
    return { rows, setups }
    // marketCounts changes when end-of-day data finishes loading, which is what makes market stocks resolvable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortlist, sets, marketCounts, settings.rr1, settings.rr2])

  // Whole-market panels: published by the backend for real data, computed from the synthetic stocks for demo.
  const demoPulse = useMemo(() => (demo ? pulseFromSets(sets.values()) : null), [demo, sets])
  const panels: Partial<Record<'NSE' | 'BSE', ExchangePulse>> | null = demo ? (demoPulse ? { NSE: demoPulse } : null) : pulse

  if (status === 'loading') return <><PageHeader title="Dashboard" /><div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-40" /><Skeleton className="h-40" /><Skeleton className="h-40" /></div></>
  if (status === 'error') return <><PageHeader title="Dashboard" /><NoData /></>

  const nifty = !demo ? indexLevels.find(l => l.id === 'NSE:NIFTY50') : undefined
  const niftyChg = nifty?.prevClose ? (nifty.ltp / nifty.prevClose - 1) * 100 : null
  const bc = benchmark?.candles
  const demoBench = demo && bc && bc.length > 1 ? { last: bc[bc.length - 1].c, chg: (bc[bc.length - 1].c / bc[bc.length - 2].c - 1) * 100, spark: bc.slice(-60).map(x => x.c) } : null
  const asOfDate = demo && bc ? dateOnly(bc[bc.length - 1].t) : pulse?.date ? dateOnly(Date.parse(`${pulse.date}T12:00:00+05:30`)) : nifty ? dateOnly(nifty.at) : null
  const exs = (['NSE', 'BSE'] as const).filter(e => panels?.[e])
  const eligible = watch.setups.filter(s => s.plan.state === 'entry_eligible').length
  const movers = panels?.[moversEx] ?? panels?.NSE
  const exShown = panels?.[moversEx] ? moversEx : 'NSE'
  const openMover = (m: PulseMover) => (sets.has(m.id) ? openChart(m.id) : void openMarketStock(m.id))

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={asOfDate ? `${asOfDate}. Whole-market panels are end-of-day closes.${demo ? ' Demo stocks are synthetic.' : ''}` : 'Search for a stock, or run a scan in Discover.'}
        actions={<span className="hidden md:inline-flex"><DataBadge set={benchmark} /></span>}
      />

      <IndexStrip />

      <div className="grid gap-4 lg:grid-cols-3">
        {nifty ? (
          <section className="card flex cursor-pointer items-center justify-between gap-4 p-5 transition hover:!border-accent/50" role="button" tabIndex={0} onClick={() => openIndex('NSE:NIFTY50')} onKeyDown={e => { if (e.key === 'Enter') openIndex('NSE:NIFTY50') }}>
            <div>
              <div className="label flex items-center gap-2">Nifty 50 <ExchangeTag id="NSE:NIFTY50" /> <span className={nifty.live ? 'text-up' : ''}>{nifty.live ? 'LIVE' : 'EOD'}</span></div>
              <div className="num mt-1 text-3xl font-semibold">{price(nifty.ltp)}</div>
              <div className={`num mt-1 text-sm font-medium ${niftyChg === null ? 'text-mute' : tone(niftyChg)}`}>{niftyChg === null ? '—' : pct(niftyChg)}</div>
            </div>
            {indexSpark['NSE:NIFTY50'] && <Sparkline values={indexSpark['NSE:NIFTY50']} width={140} height={56} />}
          </section>
        ) : demoBench ? (
          <section className="card flex items-center justify-between gap-4 p-5">
            <div>
              <div className="label">Demo index</div>
              <div className="num mt-1 text-3xl font-semibold">{price(demoBench.last)}</div>
              <div className={`num mt-1 text-sm font-medium ${tone(demoBench.chg)}`}>{pct(demoBench.chg)}</div>
            </div>
            <Sparkline values={demoBench.spark} width={140} height={56} />
          </section>
        ) : (
          <section className="card p-5"><div className="label">Nifty 50</div><p className="mt-2 text-sm text-mute">Index levels load from the shared market data.</p></section>
        )}

        <section className="card p-5">
          <div className="label">Market breadth</div>
          {!panels || exs.length === 0 ? (
            <p className="mt-2 text-sm text-mute">The whole-market summary appears after the next daily update of the shared market data.</p>
          ) : (
            <div className="mt-2 space-y-3">
              {exs.map(e => {
                const p = panels[e]!
                return (
                  <div key={e}>
                    <div className="flex items-center justify-between text-xs text-mute">
                      <span className="flex items-center gap-2">{demo ? 'Demo stocks' : <ExchangeTag id={`${e}:`} />}<span>{p.total.toLocaleString('en-IN')} stocks</span></span>
                      <span className="num">{p.highs} highs · {p.lows} lows</span>
                    </div>
                    <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-panel2">
                      <div className="bg-up" style={{ width: `${(p.adv / p.total) * 100}%` }} />
                      <div className="bg-down" style={{ width: `${(p.dec / p.total) * 100}%`, marginLeft: 'auto' }} />
                    </div>
                    <div className="num mt-1 flex justify-between text-xs"><span className="text-up">{p.adv.toLocaleString('en-IN')} up</span><span className="text-down">{p.dec.toLocaleString('en-IN')} down</span></div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <section className="card p-5">
          <div className="label">Watchlist setups</div>
          <div className="num mt-1 text-3xl font-semibold">{eligible}</div>
          <div className="mt-1 text-sm text-mute">{watch.setups.length - eligible} more forming · {watch.rows.length} stock{watch.rows.length === 1 ? '' : 's'} watched</div>
        </section>
      </div>

      {movers && (
        <div className="mt-4">
          <div className="mb-2 flex items-center gap-3">
            <h2 className="font-semibold">Top movers</h2>
            {!demo && exs.length > 1 && (
              <div className="flex rounded-lg bg-panel p-0.5 text-xs" role="group" aria-label="Exchange">
                {exs.map(e => <button key={e} onClick={() => setMoversEx(e)} aria-pressed={exShown === e} className={`rounded-md px-2.5 py-1 transition ${exShown === e ? 'bg-panel2 text-ink' : 'text-mute hover:text-ink'}`}>{e}</button>)}
              </div>
            )}
            <span className="text-xs text-mute">{demo ? 'demo stocks' : 'liquid stocks, last session'}</span>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {([['Gainers', movers.gainers], ['Losers', movers.losers]] as const).map(([title, list]) => (
              <section key={title} className="card p-4">
                <h3 className="mb-1 text-sm font-semibold text-mute">{title}</h3>
                {list.length === 0 ? <p className="py-2 text-sm text-mute">None.</p> : (
                  <ul>
                    {list.slice(0, 6).map(m => (
                      <li key={m.id}>
                        <button className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-panel2/50" onClick={() => openMover(m)}>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2 font-medium">{m.sym}{!demo && <ExchangeTag id={m.id} />}</span>
                            <span className="block truncate text-xs text-mute">{m.name}</span>
                          </span>
                          <span className="num text-right text-sm">{price(m.c / 100)} <span className={`ml-1 text-xs ${tone(m.chg)}`}>{pct(m.chg, 1)}</span></span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <section className="card p-5 lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Setups to review <span className="text-xs font-normal text-mute">your watchlist</span></h2>
            <button className="btn btn-sm btn-ghost" onClick={() => go('discover')}>Open scanners →</button>
          </div>
          {watch.rows.length === 0 ? (
            <p className="text-sm text-mute">Your watchlist is empty. Search for a stock, or run a scan in Discover and star the results. Starred stocks are checked against the trade strategies here.</p>
          ) : watch.setups.length === 0 ? <p className="text-sm text-mute">None of your watched stocks has an eligible or forming setup right now.</p> : (
            <ul className="divide-y divide-line/60">
              {watch.setups.slice(0, 8).map(({ i, plan, strategy }) => (
                <li key={i.id + strategy} className="flex cursor-pointer items-center gap-3 py-2.5 transition hover:bg-panel2/40" onClick={() => openChart(i.id)}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><span className="font-medium">{i.symbol}</span><ExchangeTag id={i.id} /><StateBadge state={plan.state} /></div>
                    <div className="truncate text-xs text-mute">{strategy} · {plan.summary}</div>
                  </div>
                  <div className="num hidden text-right text-xs sm:block">
                    <div className="text-mute">Entry {price(plan.entry)}</div>
                    <div><span className="text-down">SL {price(plan.stop)}</span> · <span className="text-up">T1 {price(plan.targets[0]?.price)}</span></div>
                  </div>
                  <StarButton instrumentId={i.id} source={strategy} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-5 lg:col-span-2">
          <h2 className="mb-3 font-semibold">Your watchlist</h2>
          {watch.rows.length === 0 ? <p className="text-sm text-mute">Star stocks from search or scan results to follow them here.</p> : (
            <ul className="space-y-1">
              {watch.rows.slice(0, 8).map(r => (
                <li key={r.i.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-panel2/50" onClick={() => openChart(r.i.id)}>
                  <div className="min-w-0 flex-1"><div className="flex items-center gap-2 font-medium">{r.i.symbol}<ExchangeTag id={r.i.id} /></div><div className="truncate text-xs text-mute">{r.i.name}</div></div>
                  <Sparkline values={r.spark} />
                  <div className="num w-20 text-right"><div className="text-sm">{price(r.last)}</div><div className={`text-xs ${tone(r.chg)}`}>{pct(r.chg)}</div></div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <div className="mt-6"><Disclaimer /></div>
    </>
  )
}
