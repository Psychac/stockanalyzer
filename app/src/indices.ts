import type { Candle } from './domain/types'
import { istDate } from './domain/time'

export interface IndexLevel {
  id: string
  name: string
  ltp: number
  /** Null when no reliable previous close is known, so no change is shown. */
  prevClose: number | null
  /** Where the number comes from: a live tick, or the last daily close. */
  live: boolean
  at: number
}

/**
 * Dashboard order: the two headline indices first (one per exchange), then sector and size indices, then the broad market
 * indices, and the volatility gauge last since it is not a price index. Anything unknown goes at the end.
 */
export const INDEX_ORDER = [
  'NSE:NIFTY50', 'BSE:SENSEX',
  'NSE:NIFTYBANK', 'NSE:NIFTYIT', 'NSE:NIFTYFIN', 'BSE:BANKEX', 'NSE:NIFTYMID',
  'NSE:NIFTY500', 'BSE:BSE500',
  'NSE:INDIAVIX',
]
export const sortLevels = <T extends { id: string }>(levels: T[]): T[] => {
  const rank = (id: string) => { const i = INDEX_ORDER.indexOf(id); return i < 0 ? INDEX_ORDER.length : i }
  return [...levels].sort((a, b) => rank(a.id) - rank(b.id))
}

export interface IndexStats {
  last: number
  prev: number | null
  changePct: number | null
  /** Highest and lowest close over up to the last 252 sessions (about a year). */
  high: number
  low: number
  fromHighPct: number
  /** Percent return over about 1, 3, 6 and 12 months of sessions; null when there is not that much history. */
  returns: { label: string; pct: number | null }[]
  sma50: number | null
  sma200: number | null
  bars: number
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length

/** What an index chart shows beside the picture. Closes only: indices have no volume, and no one buys an index directly. */
export function indexStats(candles: Candle[]): IndexStats | null {
  const n = candles.length
  if (n < 2) return null
  const closes = candles.map(c => c.c)
  const last = closes[n - 1]
  const year = closes.slice(-252)
  const ret = (k: number) => (n > k && closes[n - 1 - k] > 0 ? (last / closes[n - 1 - k] - 1) * 100 : null)
  const high = Math.max(...year)
  return {
    last, prev: closes[n - 2], changePct: closes[n - 2] > 0 ? (last / closes[n - 2] - 1) * 100 : null,
    high, low: Math.min(...year), fromHighPct: (last / high - 1) * 100,
    returns: [{ label: '1 month', pct: ret(21) }, { label: '3 months', pct: ret(63) }, { label: '6 months', pct: ret(126) }, { label: '1 year', pct: ret(251) }],
    sma50: n >= 50 ? mean(closes.slice(-50)) : null,
    sma200: n >= 200 ? mean(closes.slice(-200)) : null,
    bars: n,
  }
}

/** A volatility gauge: a rise is not "good", so it is shown without up or down colouring. */
export const isGauge = (id: string) => id === 'NSE:INDIAVIX'

export interface LiveIndexTick { ltp: number; prevClose: number | null; at: number }

/**
 * Combine the last daily bars with an optional live tick. A live tick wins for the level; its own previous close is used
 * when present, otherwise the last bar that is dated before today. A bar dated today is still forming, so the close
 * before it is the reference.
 */
export function indexLevel(id: string, name: string, eod: Candle[] | undefined, live: LiveIndexTick | undefined, now: number): IndexLevel | null {
  const n = eod?.length ?? 0
  const today = istDate(now)
  const last = n ? eod![n - 1] : undefined
  const lastIsToday = !!last && istDate(last.t) === today
  const eodPrev = n >= 2 && lastIsToday ? eod![n - 2].c : last && !lastIsToday ? last.c : null
  if (live && istDate(live.at) === today) {
    return { id, name, ltp: live.ltp, prevClose: live.prevClose ?? eodPrev, live: true, at: live.at }
  }
  if (!last) return null
  const prev = n >= 2 ? eod![n - 2].c : null
  return { id, name, ltp: last.c, prevClose: prev, live: false, at: last.t }
}
