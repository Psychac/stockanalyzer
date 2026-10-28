import { useEffect, useMemo, useRef } from 'react'
import {
  CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries, LineStyle, createChart,
  type IChartApi, type IPriceLine, type ISeriesApi, type Time, type UTCTimestamp,
} from 'lightweight-charts'
import type { CandleSet, Series } from '../../domain/types'
import { istDate } from '../../domain/time'
import { IST_SHIFT_S, isIntraday } from '../../domain/timeframes'
import { makeContext, series, type EvalContext } from '../../domain/scanner'
import type { TradePlan } from '../../domain/trade'

export interface ChartOptions {
  sma20: boolean
  sma50: boolean
  sma200: boolean
  ema20: boolean
  volume: boolean
  rsi: boolean
  macd: boolean
}

const C = {
  up: '#2dd48a', down: '#ff5c7a', text: '#8593ae', grid: 'rgba(32,44,68,0.45)', line: '#202c44',
  sma20: '#f5b84a', sma50: '#4cc2ff', sma200: '#b38cff', ema20: '#ff9f6b',
}

interface Line { api: ISeriesApi<'Line'>; get: (ctx: EvalContext) => Series }
interface Built {
  chart: IChartApi
  id: string
  count: number
  candles: ISeriesApi<'Candlestick'>
  vol: ISeriesApi<'Histogram'> | null
  hist: ISeriesApi<'Histogram'> | null
  lines: Line[]
}

/** Daily and longer bars are placed by date. Intraday bars need real timestamps, shifted so the axis reads in Indian time. */
const time = (set: CandleSet, i: number): Time =>
  isIntraday(set.timeframe) ? ((Math.floor(set.candles[i].t / 1000) + IST_SHIFT_S) as UTCTimestamp) : (istDate(set.candles[i].t) as Time)
/** Identifies what the chart is drawing; a change means a rebuild rather than a live update. */
const keyOf = (set: CandleSet) => `${set.instrument.id}|${set.timeframe}`
const lineData = (set: CandleSet, s: Series) => set.candles.flatMap((_, i) => (s[i] === null ? [] : [{ time: time(set, i), value: s[i] as number }]))
const histColor = (v: number) => (v >= 0 ? 'rgba(45,212,138,0.7)' : 'rgba(255,92,122,0.7)')
const volPoint = (set: CandleSet, i: number) => ({ time: time(set, i), value: set.candles[i].v, color: set.candles[i].c >= set.candles[i].o ? 'rgba(45,212,138,0.35)' : 'rgba(255,92,122,0.35)' })

/** Chart is built once per stock/option change. Live prices then touch only the latest bar, so it never flickers or loses zoom. */
export function PriceChart({ set, options, plan, height }: { set: CandleSet; options: ChartOptions; plan: TradePlan | null; height: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const built = useRef<Built | null>(null)
  const latest = useRef(set)
  latest.current = set

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const data = latest.current
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: C.text, fontFamily: 'Inter, system-ui, sans-serif', fontSize: 11, panes: { separatorColor: C.line } },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: C.line },
      timeScale: { borderColor: C.line, timeVisible: isIntraday(data.timeframe), secondsVisible: false, rightOffset: 6 },
      localization: { locale: 'en-IN' },
    })
    const ctx = makeContext(data, null)
    const candles = chart.addSeries(CandlestickSeries, { upColor: C.up, downColor: C.down, borderUpColor: C.up, borderDownColor: C.down, wickUpColor: C.up, wickDownColor: C.down })
    const b: Built = { chart, id: keyOf(data), count: data.candles.length, candles, vol: null, hist: null, lines: [] }

    const overlay = (on: boolean, get: Line['get'], color: string, title: string) => {
      if (!on) return
      b.lines.push({ api: chart.addSeries(LineSeries, { color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title }), get })
    }
    overlay(options.sma20, c => series(c, 'sma', { period: 20 }), C.sma20, 'SMA20')
    overlay(options.sma50, c => series(c, 'sma', { period: 50 }), C.sma50, 'SMA50')
    overlay(options.sma200, c => series(c, 'sma', { period: 200 }), C.sma200, 'SMA200')
    overlay(options.ema20, c => series(c, 'ema', { period: 20 }), C.ema20, 'EMA20')

    if (options.volume) {
      b.vol = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol', priceLineVisible: false, lastValueVisible: false })
      b.vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
    }
    let pane = 1
    if (options.rsi) {
      const r = chart.addSeries(LineSeries, { color: C.sma50, lineWidth: 2, priceLineVisible: false, title: 'RSI14' }, pane)
      for (const level of [30, 70]) r.createPriceLine({ price: level, color: C.text, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' })
      b.lines.push({ api: r, get: c => series(c, 'rsi', { period: 14 }) })
      pane++
    }
    if (options.macd) {
      b.hist = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false, title: 'MACD' }, pane)
      b.lines.push({ api: chart.addSeries(LineSeries, { color: C.sma50, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, pane), get: c => series(c, 'macd') })
      b.lines.push({ api: chart.addSeries(LineSeries, { color: C.sma20, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, pane), get: c => series(c, 'macdSignal') })
    }
    try {
      const panes = chart.panes()
      panes[0]?.setStretchFactor(3)
      for (let i = 1; i < panes.length; i++) panes[i].setStretchFactor(1)
    } catch { /* pane sizing is cosmetic */ }

    candles.setData(data.candles.map((c, i) => ({ time: time(data, i), open: c.o, high: c.h, low: c.l, close: c.c })))
    b.vol?.setData(data.candles.map((_, i) => volPoint(data, i)))
    const hist = b.hist ? series(ctx, 'macdHist') : null
    if (b.hist && hist) b.hist.setData(data.candles.flatMap((_, i) => (hist[i] === null ? [] : [{ time: time(data, i), value: hist[i] as number, color: histColor(hist[i] as number) }])))
    for (const l of b.lines) l.api.setData(lineData(data, l.get(ctx)))

    const n = data.candles.length
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 130), to: n + 6 })
    built.current = b
    return () => { built.current = null; chart.remove() }
  }, [set.instrument.id, set.timeframe, options])

  // Live data: update only the latest bar (and a new bar when the day rolls over).
  useEffect(() => {
    const b = built.current
    if (!b || b.id !== keyOf(set)) return
    const n = set.candles.length
    const last = set.candles[n - 1]
    const ctx = makeContext(set, null)
    if (n < b.count || n > b.count + 1) {
      // History was replaced (a refresh after a gap), not just extended by a tick: refill everything once.
      b.candles.setData(set.candles.map((c, i) => ({ time: time(set, i), open: c.o, high: c.h, low: c.l, close: c.c })))
      b.vol?.setData(set.candles.map((_, i) => volPoint(set, i)))
      const h = b.hist ? series(ctx, 'macdHist') : null
      if (b.hist && h) b.hist.setData(set.candles.flatMap((_, i) => (h[i] === null ? [] : [{ time: time(set, i), value: h[i] as number, color: histColor(h[i] as number) }])))
      for (const l of b.lines) l.api.setData(lineData(set, l.get(ctx)))
      b.count = n
      return
    }
    b.candles.update({ time: time(set, n - 1), open: last.o, high: last.h, low: last.l, close: last.c })
    b.vol?.update(volPoint(set, n - 1))
    if (b.hist) {
      const v = series(ctx, 'macdHist')[n - 1]
      if (v !== null && v !== undefined) b.hist.update({ time: time(set, n - 1), value: v, color: histColor(v) })
    }
    for (const l of b.lines) {
      const v = l.get(ctx)[n - 1]
      if (v !== null && v !== undefined) l.api.update({ time: time(set, n - 1), value: v })
    }
    b.count = n
  }, [set])

  // Trade-plan lines. Keyed on the rounded numbers so a tick that does not move the plan does not redraw them.
  const planKey = useMemo(() => (plan ? JSON.stringify([plan.state, plan.level, plan.entryZone, plan.entry, plan.stop, plan.targets].flat(2).map(v => (typeof v === 'number' ? Math.round(v * 100) / 100 : v))) : ''), [plan])
  useEffect(() => {
    const b = built.current
    if (!b || !plan || plan.state === 'data_insufficient' || plan.riskPerShare <= 0) return
    const active = plan.state === 'entry_eligible' || plan.state === 'setup_forming'
    const style = (solid: boolean) => (active ? (solid ? LineStyle.Solid : LineStyle.Dashed) : LineStyle.Dotted)
    const lines: IPriceLine[] = []
    const add = (price: number, color: string, title: string, solid = false) =>
      lines.push(b.candles.createPriceLine({ price, color, lineWidth: 1, lineStyle: style(solid), axisLabelVisible: true, title }))
    const tag = active ? '' : '? '
    if (plan.level !== null) lines.push(b.candles.createPriceLine({ price: plan.level, color: C.text, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: 'Level' }))
    add(plan.entryZone[0], '#4cc2ff', `${tag}Entry zone`)
    add(plan.entryZone[1], '#4cc2ff', '')
    add(plan.entry, '#4cc2ff', `${tag}Entry`, true)
    add(plan.stop, C.down, `${tag}Stop`, true)
    plan.targets.forEach(t => add(t.price, C.up, `${tag}T${t.rr}R`))
    return () => {
      // Effects clean up in order, so a rebuilt or unmounted chart is already gone here. Touching it again makes the library
      // schedule a repaint of a disposed chart, which throws asynchronously.
      if (built.current !== b) return
      for (const l of lines) { try { b.candles.removePriceLine(l) } catch { /* removed meanwhile */ } }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey, set.instrument.id, set.timeframe, options])

  return <div ref={ref} style={{ height }} className="w-full" />
}
