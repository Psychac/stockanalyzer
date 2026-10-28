import type { Candle, Timeframe } from './types'
import { IST_OFFSET_MS, istDate, sessionOpen } from './time'

/** The timeframes a chart can show, in the order the buttons appear. */
export const CHART_TFS: { key: Timeframe; label: string; intraday: boolean }[] = [
  { key: '1m', label: '1m', intraday: true },
  { key: '5m', label: '5m', intraday: true },
  { key: '15m', label: '15m', intraday: true },
  { key: '30m', label: '30m', intraday: true },
  { key: '1h', label: '1h', intraday: true },
  { key: '1D', label: '1D', intraday: false },
  { key: '1W', label: '1W', intraday: false },
  { key: '1M', label: '1M', intraday: false },
]

export const isIntraday = (tf: Timeframe) => tf !== '1D' && tf !== '1W' && tf !== '1M'

/** Length of one bar in milliseconds, for intraday timeframes. */
export const STEP_MS: Record<'1m' | '5m' | '15m' | '30m' | '1h', number> = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000, '1h': 3_600_000 }

const DAY = 86_400_000
const dowOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() // 0 = Sunday
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)

/** Monday of the week containing `date` (weeks run Monday to Friday for trading). */
export const weekStart = (date: string) => addDays(date, -((dowOf(date) + 6) % 7))
const monthStart = (date: string) => `${date.slice(0, 7)}-01`

/**
 * Roll daily bars up into weekly or monthly bars. Each bar opens at the first session of its period, so it lines up with
 * the daily chart. The last bar is marked forming until its period is over (a week ends with Friday's session, a month at
 * month end), because a half-finished weekly bar must not be read as a completed one.
 */
export function aggregate(daily: Candle[], tf: '1W' | '1M', now: number): Candle[] {
  const out: Candle[] = []
  let key = ''
  let firstDate = ''
  let lastDate = ''
  let cur: Candle | null = null
  const finish = () => {
    if (!cur) return
    const complete = tf === '1W' ? dowOf(lastDate) === 5 || istDate(now) > addDays(weekStart(firstDate), 6) : istDate(now) >= nextMonth(monthStart(firstDate))
    out.push({ ...cur, closed: cur.closed && complete })
  }
  for (const c of daily) {
    const date = istDate(c.t)
    const k = tf === '1W' ? weekStart(date) : monthStart(date)
    if (k !== key || !cur) {
      finish()
      key = k
      firstDate = date
      cur = { t: sessionOpen(date), o: c.o, h: c.h, l: c.l, c: c.c, v: c.v, closed: c.closed }
    } else {
      cur.h = Math.max(cur.h, c.h)
      cur.l = Math.min(cur.l, c.l)
      cur.c = c.c
      cur.v += c.v
      cur.closed = c.closed
    }
    lastDate = date
  }
  finish()
  return out
}

function nextMonth(firstOfMonth: string): string {
  const d = new Date(`${firstOfMonth}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + 1)
  return d.toISOString().slice(0, 10)
}

/** IST wall-clock shift used to draw intraday bars at Indian times on a chart that only understands UTC. */
export const IST_SHIFT_S = IST_OFFSET_MS / 1000
