import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../../store'
import { STRATEGIES, sizePosition } from '../../domain/trade'
import { DataBadge, Disclaimer, ExchangeTag, NoData, PageHeader, ScoreRing, Skeleton, StarButton, StateBadge } from '../components/bits'
import { PriceChart, type ChartOptions } from '../components/PriceChart'
import { dateOnly, pct, price, rupees, timeOnly, tone } from '../format'
import { indexStats } from '../../indices'
import { TF_NAME, TimeframeBar, useChartTimeframe, useTimeframeData, type TimeframeData } from '../components/timeframe'
import { isIntraday } from '../../domain/timeframes'
import type { Timeframe } from '../../domain/types'

const DEFAULT_OPTS: ChartOptions = { sma20: false, sma50: true, sma200: true, ema20: false, volume: true, rsi: false, macd: false }
const TOGGLES: { key: keyof ChartOptions; label: string }[] = [
  { key: 'sma20', label: 'SMA 20' }, { key: 'sma50', label: 'SMA 50' }, { key: 'sma200', label: 'SMA 200' }, { key: 'ema20', label: 'EMA 20' },
  { key: 'volume', label: 'Volume' }, { key: 'rsi', label: 'RSI' }, { key: 'macd', label: 'MACD' },
]

export function Charts() {
  const status = useApp(s => s.marketStatus)
  const instruments = useApp(s => s.instruments)
  const sets = useApp(s => s.sets)
  const settings = useApp(s => s.settings)
  const chartSymbol = useApp(s => s.chartSymbol)
  const extras = useApp(s => s.extras)
  const extraStatus = useApp(s => s.extraStatus)
  const feed = useApp(s => s.feed)

  const [opts, setOpts] = useState<ChartOptions>(() => {
    try { return { ...DEFAULT_OPTS, ...JSON.parse(localStorage.getItem('chartOpts') ?? '{}') } } catch { return DEFAULT_OPTS }
  })
  const [strategyId, setStrategyId] = useState(STRATEGIES[0].id)
  const [showPlan, setShowPlan] = useState(true)
  useEffect(() => { try { localStorage.setItem('chartOpts', JSON.stringify(opts)) } catch { /* storage may be unavailable */ } }, [opts])

  const id = chartSymbol ?? instruments[0]?.id
  const set = id ? sets.get(id) ?? extras.get(id) : undefined
  const strategy = STRATEGIES.find(s => s.id === strategyId)!
  const isIndex = set?.instrument.kind === 'index'
  const [tf, setTf] = useChartTimeframe()
  const td = useTimeframeData(set, tf)
  const plan = useMemo(() => (set && !isIndex ? strategy.evaluate(set, { rr: [settings.rr1, settings.rr2] }) : null), [set, isIndex, strategy, settings.rr1, settings.rr2])
  const sizing = useMemo(() => (plan && plan.riskPerShare > 0 ? sizePosition({ capital: settings.capital, riskPct: settings.riskPct, entry: plan.entry, stop: plan.stop, maxPositionPct: settings.maxPositionPct, roundTripCostPct: settings.roundTripCostPct }) : null), [plan, settings])

  if (status === 'loading') return <><PageHeader title="Charts" /><Skeleton className="h-[480px]" /></>
  if (extraStatus && extraStatus.id === id && !set) {
    const sym = id?.replace('NSE:', '')
    return (
      <>
        <PageHeader title="Charts" />
        {extraStatus.state === 'loading'
          ? <><p className="mb-3 text-sm text-mute">Loading {sym}… the first stock from an exchange downloads its end-of-day data once (about 6 MB).</p><Skeleton className="h-[420px]" /></>
          : <NoData />}
        {extraStatus.state === 'error' && <p className="mt-3 text-sm text-down">{extraStatus.message}</p>}
      </>
    )
  }
  if (set && isIndex) return <IndexView set={set} opts={opts} setOpts={setOpts} />
  if (status === 'error' || !set || !plan) return <><PageHeader title="Charts" /><NoData /></>

  const c = set.candles
  const last = c[c.length - 1]
  const chg = (last.c / c[c.length - 2].c - 1) * 100
  const extraPanes = Number(opts.rsi) + Number(opts.macd)
  const height = 420 + extraPanes * 130
  // Levels are drawn for every stock that has enough history. Without an active setup they are labelled as reference only.
  const hasLevels = plan.state !== 'data_insufficient' && plan.riskPerShare > 0
  const active = plan.state === 'entry_eligible' || plan.state === 'setup_forming'
  const live = feed.mode === 'live' && !!feed.updatedAt && !last.closed && set.source !== 'market'

  return (
    <>
      <PageHeader title="Charts" actions={<DataBadge set={set} />} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <InstrumentPicker id={id} />
        <div className="flex items-baseline gap-3">
          <ExchangeTag id={set.instrument.id} className="self-center !text-xs !py-0.5" /><span className="num text-2xl font-semibold">₹{price(last.c)}</span>
          <span className={`num text-sm font-medium ${tone(chg)}`}>{pct(chg)}</span>
          <span className="text-xs text-mute">{last.closed ? 'Close' : 'Last'} · {dateOnly(last.t)}{set.instrument.sector !== 'Other' ? ` · ${set.instrument.sector}` : ''}</span>
          {live && <span className="chip border-up/40 text-up"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-up" />LIVE{feed.updatedAt ? ` · ${timeOnly(feed.updatedAt)}` : ''}</span>}
        </div>
        <StarButton instrumentId={set.instrument.id} source="Charts" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <section className="card p-3">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {TOGGLES.map(t => (
              <button key={t.key} onClick={() => setOpts({ ...opts, [t.key]: !opts[t.key] })} className={`chip cursor-pointer transition ${opts[t.key] ? 'border-accent/60 bg-accent/10 text-accent' : 'hover:text-ink'}`}>{t.label}</button>
            ))}
            <button onClick={() => setShowPlan(!showPlan)} className={`chip ml-auto cursor-pointer ${showPlan ? 'border-up/50 bg-up/10 text-up' : ''}`}>Trade plan overlay</button>
          </div>
          <div className="mb-2"><TimeframeBar tf={tf} onChange={setTf} /></div>
          <ChartArea td={td} tf={tf} options={opts} plan={showPlan && hasLevels && tf === '1D' ? plan : null} height={height} />
          {tf !== '1D' && <p className="mt-1 px-1 text-[10px] text-mute">The trade plan is built from daily candles, so its levels are drawn on the 1D chart only.</p>}
        </section>

        <aside className="space-y-4">
          <section className="card p-5">
            <div className="mb-3 flex gap-1 rounded-xl bg-bg/60 p-1">
              {STRATEGIES.map(s => (
                <button key={s.id} onClick={() => setStrategyId(s.id)} className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition ${s.id === strategyId ? 'bg-panel2 text-ink' : 'text-mute hover:text-ink'}`}>{s.name}</button>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3">
              <div><StateBadge state={plan.state} /><p className="mt-2 text-sm text-mute">{plan.summary}</p></div>
              <ScoreRing score={plan.state === 'data_insufficient' ? null : plan.score} size={52} />
            </div>
            {plan.provisional && <p className="mt-2 text-xs text-warn">Provisional: based on a candle that has not closed.</p>}

            {hasLevels && !active && (
              <p className="mt-3 rounded-lg border border-warn/30 bg-warn/5 p-2 text-xs text-warn">No active setup. These are reference levels for where the strategy would trigger, not a signal to trade.</p>
            )}
            {hasLevels && (
              <dl className="num mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
                <Row k={plan.state === 'setup_forming' && plan.level ? 'Trigger' : active ? 'Entry' : 'Reference entry'} v={`₹${price(plan.entry)}`} />
                <Row k="Entry zone" v={`${price(plan.entryZone[0])}–${price(plan.entryZone[1])}`} />
                <Row k="Timeframe" v={plan.timeframe === '1D' ? 'Daily (1D)' : plan.timeframe} />
                <Row k="Typical hold" v={plan.holding} />
                <Row k="Signal bar" v={dateOnly(plan.asOf)} />
                <Row k={active ? 'Valid until' : 'Would expire'} v={`~${dateOnly(plan.validUntil)}`} />
                <Row k="Stop-loss" v={`₹${price(plan.stop)}`} cls="text-down" />
                <Row k="Risk / share" v={`₹${price(plan.riskPerShare)}`} />
                {plan.targets.map(t => <Row key={t.rr} k={`Target ${t.rr}R`} v={`₹${price(t.price)}`} cls="text-up" />)}
              </dl>
            )}
          </section>

          {hasLevels && sizing && (
            <section className="card p-5">
              <h3 className="mb-3 font-semibold">Position size{!active && <span className="ml-2 text-xs font-normal text-warn">hypothetical</span>}</h3>
              {sizing.shares === 0 ? <p className="text-sm text-warn">Risk budget or position cap is too small for one share at this stop distance.</p> : (
                <dl className="num grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
                  <Row k="Quantity" v={`${sizing.shares.toLocaleString('en-IN')} sh`} />
                  <Row k="Capital used" v={rupees(sizing.capitalNeeded)} />
                  <Row k="Planned risk" v={rupees(sizing.plannedRisk)} cls="text-down" />
                  <Row k="Risk budget" v={`${rupees(sizing.riskBudget)} (${settings.riskPct}%)`} />
                  <Row k="Est. costs" v={`${rupees(sizing.estCosts)}`} />
                  <Row k="Limited by" v={sizing.limitedBy === 'capital' ? 'Position cap' : 'Risk budget'} />
                </dl>
              )}
              <p className="mt-3 text-[11px] leading-snug text-mute">Planned risk is theoretical: it excludes costs, slippage and gaps through the stop. Adjust capital and risk in Settings.</p>
            </section>
          )}

          <section className="card p-5">
            <h3 className="mb-1 font-semibold">Why this state</h3>
            <p className="mb-3 text-xs text-mute">{strategy.description}</p>
            <ul className="space-y-2.5">
              {plan.checks.map(ch => (
                <li key={ch.label} className="flex gap-2.5 text-sm">
                  <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] ${ch.pass ? 'bg-up/20 text-up' : 'bg-down/15 text-down'}`}>{ch.pass ? '✓' : '✗'}</span>
                  <div><div>{ch.label}</div><div className="text-xs text-mute">{ch.detail}</div></div>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-mute">Strategy {strategy.name} v{plan.strategyVersion}. Score = weighted share of criteria met.</p>
          </section>
        </aside>
      </div>
      <div className="mt-6"><Disclaimer /></div>
    </>
  )
}

const Row = ({ k, v, cls = '' }: { k: string; v: string; cls?: string }) => (
  <div><dt className="label">{k}</dt><dd className={`mt-0.5 font-medium ${cls}`}>{v}</dd></div>
)

/** One picker for indices and stocks: indices come from the dashboard's list, stocks from the tracked set plus anything opened. */
function InstrumentPicker({ id }: { id: string | undefined }) {
  const instruments = useApp(s => s.instruments)
  const extras = useApp(s => s.extras)
  const levels = useApp(s => s.indexLevels)
  const openChart = useApp(s => s.openChart)
  const openIndex = useApp(s => s.openIndex)
  const stocks = [...instruments, ...[...extras.values()].map(e => e.instrument).filter(i => i.kind !== 'index')]
  return (
    <select className="field !w-auto min-w-48" value={id} aria-label="Instrument" onChange={e => (levels.some(l => l.id === e.target.value) ? openIndex(e.target.value) : openChart(e.target.value))}>
      {levels.length > 0 && <optgroup label="Indices">{levels.map(l => <option key={l.id} value={l.id}>{l.id.startsWith('BSE:') ? 'BSE' : 'NSE'} · {l.name}</option>)}</optgroup>}
      <optgroup label="Stocks">{stocks.map(i => <option key={i.id} value={i.id}>{i.exchange} · {i.symbol} — {i.name}</option>)}</optgroup>
    </select>
  )
}

const INDEX_TOGGLES = TOGGLES.filter(t => t.key !== 'volume')

/** An index is not tradable, so no trade plan or sizing: the picture, the levels, and how it has been trending. */
function IndexView({ set, opts, setOpts }: { set: import('../../domain/types').CandleSet; opts: ChartOptions; setOpts: (o: ChartOptions) => void }) {
  const level = useApp(s => s.indexLevels.find(l => l.id === set.instrument.id))
  const stats = indexStats(set.candles)
  const c = set.candles
  const last = c[c.length - 1]
  const shown = level?.ltp ?? last.c
  const chg = level?.prevClose ? (level.ltp / level.prevClose - 1) * 100 : stats?.changePct ?? null
  const extraPanes = Number(opts.rsi) + Number(opts.macd)
  const chartOpts = { ...opts, volume: false }
  const [tf, setTf] = useChartTimeframe()
  const td = useTimeframeData(set, tf)
  return (
    <>
      <PageHeader title="Charts" actions={<DataBadge set={set} />} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <InstrumentPicker id={set.instrument.id} />
        <div className="flex items-baseline gap-3">
          <ExchangeTag id={set.instrument.id} className="self-center !text-xs !py-0.5" /><span className="num text-2xl font-semibold">{price(shown)}</span>
          {chg !== null && <span className={`num text-sm font-medium ${tone(chg)}`}>{pct(chg)}</span>}
          <span className="text-xs text-mute">{level?.live ? 'Live' : 'Close'} · {dateOnly(level?.live ? level.at : last.t)} · points</span>
          {level?.live && <span className="chip border-up/40 text-up"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-up" />LIVE</span>}
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <section className="card p-3">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {INDEX_TOGGLES.map(t => (
              <button key={t.key} onClick={() => setOpts({ ...opts, [t.key]: !opts[t.key] })} className={`chip cursor-pointer transition ${opts[t.key] ? 'border-accent/60 bg-accent/10 text-accent' : 'hover:text-ink'}`}>{t.label}</button>
            ))}
          </div>
          <div className="mb-2"><TimeframeBar tf={tf} onChange={setTf} /></div>
          <ChartArea td={td} tf={tf} options={chartOpts} plan={null} height={420 + extraPanes * 130} />
        </section>
        {stats && (
          <aside className="space-y-4">
            <section className="card p-5">
              <h3 className="mb-3 font-semibold">Range</h3>
              <dl className="num grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
                <Stat k={`High (${Math.min(252, stats.bars)} sessions)`} v={price(stats.high)} />
                <Stat k="Low" v={price(stats.low)} />
                <Stat k="From high" v={pct(stats.fromHighPct)} cls={tone(stats.fromHighPct)} />
                <Stat k="Previous close" v={stats.prev === null ? '—' : price(stats.prev)} />
              </dl>
            </section>
            <section className="card p-5">
              <h3 className="mb-3 font-semibold">Returns</h3>
              <dl className="num grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
                {stats.returns.map(r => <Stat key={r.label} k={r.label} v={r.pct === null ? 'not enough history' : pct(r.pct)} cls={r.pct === null ? 'text-mute' : tone(r.pct)} />)}
              </dl>
            </section>
            <section className="card p-5">
              <h3 className="mb-3 font-semibold">Trend</h3>
              <ul className="space-y-2 text-sm">
                {([['SMA 50', stats.sma50], ['SMA 200', stats.sma200]] as const).map(([label, v]) => (
                  <li key={label} className="flex items-center justify-between gap-3">
                    <span>{label} <span className="num text-mute">{v === null ? '' : price(v)}</span></span>
                    {v === null ? <span className="text-mute">not enough history</span> : <span className={stats.last > v ? 'text-up' : 'text-down'}>{stats.last > v ? 'Above' : 'Below'}</span>}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[11px] leading-snug text-mute">An index cannot be bought directly, so there is no trade plan here. Levels are index points, not rupees.</p>
            </section>
          </aside>
        )}
      </div>
      <div className="mt-6"><Disclaimer /></div>
    </>
  )
}

const Stat = ({ k, v, cls = '' }: { k: string; v: string; cls?: string }) => (
  <div><dt className="label">{k}</dt><dd className={`mt-0.5 font-medium ${cls}`}>{v}</dd></div>
)

/** The chart for the chosen timeframe, or an honest message while it loads or when that timeframe is not available. */
function ChartArea({ td, tf, options, plan, height }: { td: TimeframeData; tf: Timeframe; options: ChartOptions; plan: import('../../domain/trade').TradePlan | null; height: number }) {
  if (td.error) {
    return (
      <div className="grid place-items-center rounded-xl border border-dashed border-line px-6 text-center text-sm text-mute" style={{ height }}>
        <div className="max-w-sm"><p className="text-ink">{TF_NAME[tf]} candles are not available</p><p className="mt-1 text-xs">{td.error}</p></div>
      </div>
    )
  }
  if (!td.view) return <div style={{ height }}><Skeleton className="h-full" /></div>
  const n = td.view.candles.length
  return (
    <>
      <PriceChart set={td.view} options={options} plan={plan} height={height} />
      <div className="mt-1 flex flex-wrap justify-between gap-x-3 px-1 text-[10px] text-mute">
        <span>{TF_NAME[tf]} candles · {n} bars{isIntraday(tf) ? ' · Upstox public data, may be delayed; refreshes every 45 s while the market is open' : tf === '1D' ? '' : ' · built from daily candles'}</span>
        <span>Chart by TradingView</span>
      </div>
    </>
  )
}
