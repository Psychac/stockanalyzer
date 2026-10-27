import type { Candle } from '../domain/types'
import { isDailyBarClosed, istDate, sessionOpen } from '../domain/time'
import type { Quote } from './types'

/** Union by bar start; `fresh` wins on overlap. */
export function mergeCandles(base: Candle[], fresh: Candle[]): Candle[] {
  const byT = new Map<number, Candle>()
  for (const c of base) byT.set(c.t, c)
  for (const c of fresh) byT.set(c.t, c)
  return [...byT.values()].sort((a, b) => a.t - b.t)
}

/** Closed/forming depends on the clock, so it is recomputed whenever data is read rather than trusted from storage. */
export function finalizeCandles(candles: Candle[], now: number): Candle[] {
  return candles.map(c => {
    const closed = isDailyBarClosed(istDate(c.t), now)
    return c.closed === closed ? c : { ...c, closed }
  })
}

/** Fold a live quote into today's daily bar, or open a new forming bar. Quotes older than the last bar are ignored. */
export function applyQuote(candles: Candle[], q: Quote, now: number): Candle[] {
  const last = candles[candles.length - 1]
  if (!last) return candles
  const date = istDate(q.at)
  const lastDate = istDate(last.t)
  if (date < lastDate) return candles
  const closed = isDailyBarClosed(date, now)
  if (date === lastDate) {
    const next: Candle = {
      ...last,
      c: q.ltp,
      h: Math.max(last.h, q.high ?? q.ltp, q.ltp),
      l: Math.min(last.l, q.low ?? q.ltp, q.ltp),
      v: q.volume && q.volume > 0 ? q.volume : last.v,
      closed,
    }
    return [...candles.slice(0, -1), next]
  }
  return [...candles, { t: sessionOpen(date), o: q.open ?? q.ltp, h: q.high ?? q.ltp, l: q.low ?? q.ltp, c: q.ltp, v: q.volume ?? 0, closed }]
}
