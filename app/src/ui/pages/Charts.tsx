import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../../store'
import { STRATEGIES, sizePosition } from '../../domain/trade'
import { DataBadge, Disclaimer, NoData, PageHeader, ScoreRing, Skeleton, StarButton, StateBadge } from '../components/bits'
import { PriceChart, type ChartOptions } from '../components/PriceChart'
import { dateOnly, pct, price, rupees, tone } from '../format'

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
  const openChart = useApp(s => s.openChart)

  const [opts, setOpts] = useState<ChartOptions>(() => {
    try { return { ...DEFAULT_OPTS, ...JSON.parse(localStorage.getItem('chartOpts') ?? '{}') } } catch { return DEFAULT_OPTS }
  })
  const [strategyId, setStrategyId] = useState(STRATEGIES[0].id)
  const [showPlan, setShowPlan] = useState(true)
  useEffect(() => { try { localStorage.setItem('chartOpts', JSON.stringify(opts)) } catch { /* storage may be unavailable */ } }, [opts])

  const id = chartSymbol ?? instruments[0]?.id
  const set = id ? sets.get(id) : undefined
  const strategy = STRATEGIES.find(s => s.id === strategyId)!
  const plan = useMemo(() => (set ? strategy.evaluate(set, { rr: [settings.rr1, settings.rr2] }) : null), [set, strategy, settings.rr1, settings.rr2])
  const sizing = useMemo(() => (plan && plan.riskPerShare > 0 ? sizePosition({ capital: settings.capital, riskPct: settings.riskPct, entry: plan.entry, stop: plan.stop, maxPositionPct: settings.maxPositionPct, roundTripCostPct: settings.roundTripCostPct }) : null), [plan, settings])

  if (status === 'loading') return <><PageHeader title="Charts" /><Skeleton className="h-[480px]" /></>
  if (status === 'error' || !set || !plan) return <><PageHeader title="Charts" /><NoData /></>

  const c = set.candles
  const last = c[c.length - 1]
  const chg = (last.c / c[c.length - 2].c - 1) * 100
  const extraPanes = Number(opts.rsi) + Number(opts.macd)
  const height = 420 + extraPanes * 130
  const tradable = plan.state === 'entry_eligible' || plan.state === 'setup_forming'

  return (
    <>
      <PageHeader title="Charts" actions={<DataBadge set={set} />} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select className="field !w-auto min-w-48" value={id} onChange={e => openChart(e.target.value)} aria-label="Instrument">
          {instruments.map(i => <option key={i.id} value={i.id}>{i.symbol} — {i.name}</option>)}
        </select>
        <div className="flex items-baseline gap-3">
          <span className="num text-2xl font-semibold">₹{price(last.c)}</span>
          <span className={`num text-sm font-medium ${tone(chg)}`}>{pct(chg)}</span>
          <span className="text-xs text-mute">{last.closed ? 'Close' : 'Last'} · {dateOnly(last.t)} · {set.instrument.sector}</span>
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
          <PriceChart set={set} options={opts} plan={showPlan && tradable ? plan : null} height={height} />
          <div className="mt-1 flex justify-between px-1 text-[10px] text-mute"><span>Daily candles · {c.length} bars</span><span>Chart by TradingView</span></div>
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

            {tradable && (
              <dl className="num mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
                <Row k={plan.state === 'setup_forming' && plan.level ? 'Trigger' : 'Entry'} v={`₹${price(plan.entry)}`} />
                <Row k="Entry zone" v={`${price(plan.entryZone[0])}–${price(plan.entryZone[1])}`} />
                <Row k="Stop-loss" v={`₹${price(plan.stop)}`} cls="text-down" />
                <Row k="Risk / share" v={`₹${price(plan.riskPerShare)}`} />
                {plan.targets.map(t => <Row key={t.rr} k={`Target ${t.rr}R`} v={`₹${price(t.price)}`} cls="text-up" />)}
              </dl>
            )}
          </section>

          {tradable && sizing && (
            <section className="card p-5">
              <h3 className="mb-3 font-semibold">Position size</h3>
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
