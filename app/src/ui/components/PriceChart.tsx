import { useEffect, useRef } from 'react'
import { CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries, LineStyle, createChart, type Time } from 'lightweight-charts'
import type { CandleSet, Series } from '../../domain/types'
import { istDate } from '../../domain/time'
import { makeContext, series } from '../../domain/scanner'
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

const toLine = (set: CandleSet, s: Series) =>
  set.candles.flatMap((c, i) => (s[i] === null ? [] : [{ time: istDate(c.t) as Time, value: s[i] as number }]))

export function PriceChart({ set, options, plan, height }: { set: CandleSet; options: ChartOptions; plan: TradePlan | null; height: number }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: C.text, fontFamily: 'Inter, system-ui, sans-serif', fontSize: 11, panes: { separatorColor: C.line } },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: C.line },
      timeScale: { borderColor: C.line, timeVisible: false, rightOffset: 6 },
      localization: { locale: 'en-IN' },
    })
    const ctx = makeContext(set, null)
    const time = (i: number) => istDate(set.candles[i].t) as Time

    const candles = chart.addSeries(CandlestickSeries, { upColor: C.up, downColor: C.down, borderUpColor: C.up, borderDownColor: C.down, wickUpColor: C.up, wickDownColor: C.down })
    candles.setData(set.candles.map((c, i) => ({ time: time(i), open: c.o, high: c.h, low: c.l, close: c.c })))

    const overlay = (on: boolean, s: Series, color: string, title: string) => {
      if (!on) return
      chart.addSeries(LineSeries, { color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title }).setData(toLine(set, s))
    }
    overlay(options.sma20, series(ctx, 'sma', { period: 20 }), C.sma20, 'SMA20')
    overlay(options.sma50, series(ctx, 'sma', { period: 50 }), C.sma50, 'SMA50')
    overlay(options.sma200, series(ctx, 'sma', { period: 200 }), C.sma200, 'SMA200')
    overlay(options.ema20, series(ctx, 'ema', { period: 20 }), C.ema20, 'EMA20')

    if (options.volume) {
      const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol', priceLineVisible: false, lastValueVisible: false })
      vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
      vol.setData(set.candles.map((c, i) => ({ time: time(i), value: c.v, color: c.c >= c.o ? 'rgba(45,212,138,0.35)' : 'rgba(255,92,122,0.35)' })))
    }

    let pane = 1
    if (options.rsi) {
      const r = chart.addSeries(LineSeries, { color: C.sma50, lineWidth: 2, priceLineVisible: false, title: 'RSI14' }, pane)
      r.setData(toLine(set, series(ctx, 'rsi', { period: 14 })))
      for (const level of [30, 70]) r.createPriceLine({ price: level, color: C.text, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' })
      pane++
    }
    if (options.macd) {
      const m = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false, title: 'MACD' }, pane)
      const hist = series(ctx, 'macdHist')
      m.setData(set.candles.flatMap((_, i) => (hist[i] === null ? [] : [{ time: time(i), value: hist[i] as number, color: (hist[i] as number) >= 0 ? 'rgba(45,212,138,0.7)' : 'rgba(255,92,122,0.7)' }])))
      chart.addSeries(LineSeries, { color: C.sma50, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, pane).setData(toLine(set, series(ctx, 'macd')))
      chart.addSeries(LineSeries, { color: C.sma20, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, pane).setData(toLine(set, series(ctx, 'macdSignal')))
    }
    try {
      const panes = chart.panes()
      panes[0]?.setStretchFactor(3)
      for (let i = 1; i < panes.length; i++) panes[i].setStretchFactor(1)
    } catch { /* pane sizing is cosmetic */ }

    if (plan && plan.state !== 'data_insufficient' && plan.riskPerShare > 0) {
      const line = (price: number, color: string, title: string, style = LineStyle.Dashed) =>
        candles.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title })
      if (plan.level !== null) line(plan.level, C.text, 'Level', LineStyle.Dotted)
      line(plan.entryZone[0], '#4cc2ff', 'Entry zone', LineStyle.Dotted)
      line(plan.entryZone[1], '#4cc2ff', '', LineStyle.Dotted)
      line(plan.entry, '#4cc2ff', 'Entry', LineStyle.Solid)
      line(plan.stop, C.down, 'Stop', LineStyle.Solid)
      plan.targets.forEach(t => line(t.price, C.up, `T${t.rr}R`))
    }

    const n = set.candles.length
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 130), to: n + 6 })
    return () => chart.remove()
  }, [set, options, plan])

  return <div ref={ref} style={{ height }} className="w-full" />
}
