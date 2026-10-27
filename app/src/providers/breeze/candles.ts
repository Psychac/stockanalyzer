import type { Candle } from '../../domain/types'
import { isDailyBarClosed, sessionOpen } from '../../domain/time'
import type { BreezeRow } from './client'

const DATE = /^(\d{4}-\d{2}-\d{2})/

/**
 * Breeze rows carry string prices and a naive IST `datetime` such as "2026-10-23 07:00:00". The time of day varies by
 * feed, so only the date is trusted and the bar is re-stamped at that day's 09:15 IST open.
 */
export function parseBreezeCandles(rows: unknown, now: number): Candle[] {
  if (!Array.isArray(rows)) return []
  const byDate = new Map<string, Candle>()
  for (const r of rows as (Partial<BreezeRow> | null)[]) {
    if (!r || typeof r !== 'object') continue
    const date = typeof r.datetime === 'string' ? DATE.exec(r.datetime)?.[1] : undefined
    const [o, h, l, c] = [r.open, r.high, r.low, r.close].map(Number)
    const v = Number(r.volume ?? 0)
    if (!date || ![o, h, l, c].every(n => Number.isFinite(n) && n > 0) || h < l) continue
    byDate.set(date, { t: sessionOpen(date), o, h, l, c, v: Number.isFinite(v) ? v : 0, closed: isDailyBarClosed(date, now) })
  }
  return [...byDate.values()].sort((a, b) => a.t - b.t)
}
