import type { Candle } from '../../domain/types'
import { isDailyBarClosed, istDate, sessionOpen } from '../../domain/time'

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/**
 * FYERS rows are [epoch seconds, o, h, l, c, volume]. The timestamp convention for daily bars is not documented
 * precisely, so only its IST calendar date is trusted and the bar is re-stamped at that day's 09:15 IST open.
 */
export function parseDailyCandles(raw: unknown, now: number): Candle[] {
  if (!Array.isArray(raw)) return []
  const byDate = new Map<string, Candle>()
  for (const row of raw) {
    if (!Array.isArray(row)) continue
    const [ts, o, h, l, c, v] = row.map(num)
    if (ts === null || o === null || h === null || l === null || c === null) continue
    if (o <= 0 || h <= 0 || l <= 0 || c <= 0 || h < l) continue
    const date = istDate(ts > 1e12 ? ts : ts * 1000)
    byDate.set(date, { t: sessionOpen(date), o, h, l, c, v: v ?? 0, closed: isDailyBarClosed(date, now) })
  }
  return [...byDate.values()].sort((a, b) => a.t - b.t)
}

export { applyQuote, finalizeCandles, mergeCandles } from '../candles'
