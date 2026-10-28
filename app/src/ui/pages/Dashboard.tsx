import { useMemo } from 'react'
import { useApp } from '../../store'
import { STRATEGIES, type TradePlan } from '../../domain/trade'
import { makeContext } from '../../domain/scanner'
import { DataBadge, Disclaimer, ExchangeTag, IndexStrip, NoData, PageHeader, Skeleton, Sparkline, StateBadge, StarButton } from '../components/bits'
import { dateOnly, pct, price, tone } from '../format'

export function Dashboard() {
  const status = useApp(s => s.marketStatus)
  const sets = useApp(s => s.sets)
  const benchmark = useApp(s => s.benchmark)
  const instruments = useApp(s => s.instruments)
  const shortlist = useApp(s => s.shortlist)
  const settings = useApp(s => s.settings)
  const openChart = useApp(s => s.openChart)
  const go = useApp(s => s.go)
  const setFor = useApp(s => s.setFor)
  const openIndex = useApp(s => s.openIndex)
  const indexLevels = useApp(s => s.indexLevels)
  const indexSpark = useApp(s => s.indexSpark)
  const source = useApp(s => s.source)

  const data = useMemo(() => {
    if (status !== 'ready') return null
    const rows = instruments.map(i => {
      const c = sets.get(i.id)!.candles
      const last = c[c.length - 1]
      const prev = c[c.length - 2]
      return { i, last: last.c, chg: (last.c / prev.c - 1) * 100, spark: c.slice(-30).map(x => x.c) }
    })
    const params = { rr: [settings.rr1, settings.rr2] as [number, number] }
    const setups: { i: (typeof instruments)[number]; plan: TradePlan; strategy: string }[] = []
    for (const i of instruments) {
      const set = sets.get(i.id)!
      const ctx = makeContext(set, null)
      for (const s of STRATEGIES) {
        const plan = s.evaluate(set, params, ctx)
        if (plan.state === 'entry_eligible' || plan.state === 'setup_forming') setups.push({ i, plan, strategy: s.name })
      }
    }
    setups.sort((a, b) => Number(b.plan.state === 'entry_eligible') - Number(a.plan.state === 'entry_eligible') || b.plan.score - a.plan.score)
    const bc = benchmark!.candles
    return {
      rows,
      setups,
      adv: rows.filter(r => r.chg > 0).length,
      dec: rows.filter(r => r.chg < 0).length,
      bench: { last: bc[bc.length - 1].c, chg: (bc[bc.length - 1].c / bc[bc.length - 2].c - 1) * 100, spark: bc.slice(-60).map(x => x.c) },
      gainers: [...rows].sort((a, b) => b.chg - a.chg).slice(0, 5),
      losers: [...rows].sort((a, b) => a.chg - b.chg).slice(0, 5),
    }
  }, [status, sets, instruments, benchmark, settings])

  if (status === 'loading') return <><PageHeader title="Dashboard" /><div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-40" /><Skeleton className="h-40" /><Skeleton className="h-40" /></div></>
  if (!data) return <><PageHeader title="Dashboard" /><NoData /></>

  const asOf = benchmark!.asOf
  // The shortlist can hold stocks from the market-wide data, not only the tracked 50.
  const watch = shortlist.flatMap(s => {
    const set = setFor(s.instrumentId)
    const c = set?.candles
    return set && c && c.length >= 2 ? [{ i: set.instrument, last: c[c.length - 1].c, chg: (c[c.length - 1].c / c[c.length - 2].c - 1) * 100, spark: c.slice(-30).map(x => x.c) }] : []
  })
  const nifty = source !== 'demo' ? indexLevels.find(l => l.id === 'NSE:NIFTY50') : undefined
  const niftyChg = nifty?.prevClose ? (nifty.ltp / nifty.prevClose - 1) * 100 : null

  return (
    <>
      <PageHeader title="Dashboard" subtitle={`${dateOnly(asOf)}. ${benchmark!.candles[benchmark!.candles.length - 1].closed ? 'Prices are end-of-day closes.' : "Includes today's session in progress."}`} actions={<span className="hidden md:inline-flex"><DataBadge set={benchmark} /></span>} />

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
        ) : (
        <section className="card flex items-center justify-between gap-4 p-5">
          <div>
            <div className="label">{source === 'breeze' ? 'Nifty BeES · Nifty 50 ETF' : source === 'demo' ? 'Nifty 50 · demo index' : 'Nifty 50'}</div>
            <div className="num mt-1 text-3xl font-semibold">{price(data.bench.last)}</div>
            <div className={`num mt-1 text-sm font-medium ${tone(data.bench.chg)}`}>{pct(data.bench.chg)}</div>
          </div>
          <Sparkline values={data.bench.spark} width={140} height={56} />
        </section>
        )}
        <section className="card p-5">
          <div className="label">Breadth · tracked {data.rows.length}</div>
          <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-panel2">
            <div className="bg-up" style={{ width: `${(data.adv / data.rows.length) * 100}%` }} />
            <div className="bg-down" style={{ width: `${(data.dec / data.rows.length) * 100}%`, marginLeft: 'auto' }} />
          </div>
          <div className="num mt-3 flex justify-between text-sm"><span className="text-up">{data.adv} advancing</span><span className="text-down">{data.dec} declining</span></div>
        </section>
        <section className="card p-5">
          <div className="label">Entry-eligible setups · tracked</div>
          <div className="num mt-1 text-3xl font-semibold">{data.setups.filter(s => s.plan.state === 'entry_eligible').length}</div>
          <div className="mt-1 text-sm text-mute">{data.setups.filter(s => s.plan.state === 'setup_forming').length} more forming · across {STRATEGIES.length} strategies</div>
        </section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <section className="card p-5 lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Setups to review <span className="text-xs font-normal text-mute">tracked stocks</span></h2>
            <button className="btn btn-sm btn-ghost" onClick={() => go('discover')}>Open scanners →</button>
          </div>
          {data.setups.length === 0 ? <p className="text-sm text-mute">No strategy has an eligible or forming setup right now.</p> : (
            <ul className="divide-y divide-line/60">
              {data.setups.slice(0, 8).map(({ i, plan, strategy }) => (
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
          <h2 className="mb-3 font-semibold">Your shortlist</h2>
          {watch.length === 0 ? <p className="text-sm text-mute">Star stocks from scan results to track them here.</p> : (
            <ul className="space-y-1">
              {watch.slice(0, 6).map(r => (
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

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {([['Top gainers', data.gainers], ['Top losers', data.losers]] as const).map(([title, list]) => (
          <section key={title} className="card p-5">
            <h2 className="mb-2 font-semibold">{title}</h2>
            <ul>
              {list.map(r => (
                <li key={r.i.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-panel2/50" onClick={() => openChart(r.i.id)}>
                  <div className="flex min-w-0 flex-1 items-center gap-2 font-medium">{r.i.symbol}<ExchangeTag id={r.i.id} /><span className="hidden truncate text-xs font-normal text-mute sm:inline">{r.i.sector}</span></div>
                  <Sparkline values={r.spark} width={64} height={22} />
                  <div className="num w-24 text-right text-sm">{price(r.last)} <span className={`ml-1 text-xs ${tone(r.chg)}`}>{pct(r.chg, 1)}</span></div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <div className="mt-6"><Disclaimer /></div>
    </>
  )
}
