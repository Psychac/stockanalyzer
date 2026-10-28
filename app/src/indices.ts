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
