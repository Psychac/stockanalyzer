import type { Candle, Instrument, Timeframe } from '../domain/types'
import { STEP_MS, isIntraday } from '../domain/timeframes'
import { istDate } from '../domain/time'

/**
 * Intraday candles come from Upstox's public history endpoint, which serves every interval for NSE and BSE stocks and for
 * indices without a login. Upstox's docs describe the call as authenticated, so this works only while they do not enforce
 * that; the chart says where the data is from, and failure leaves the daily chart untouched.
 */
const BASE = 'https://api.upstox.com/v3/historical-candle'

type Intra = '1m' | '5m' | '15m' | '30m' | '1h'

/** How far back each interval goes. Upstox limits a request to a month for 1-15 minute bars and a quarter above that. */
const PLAN: Record<Intra, { unit: 'minutes' | 'hours'; n: number; days: number }> = {
  '1m': { unit: 'minutes', n: 1, days: 6 },
  '5m': { unit: 'minutes', n: 5, days: 30 },
  '15m': { unit: 'minutes', n: 15, days: 30 },
  '30m': { unit: 'minutes', n: 30, days: 90 },
  '1h': { unit: 'hours', n: 1, days: 90 },
}

/** Upstox instrument keys for the indices the dashboard shows. */
export const INDEX_KEYS: Record<string, string> = {
  'NSE:NIFTY50': 'NSE_INDEX|Nifty 50', 'NSE:NIFTYBANK': 'NSE_INDEX|Nifty Bank', 'NSE:NIFTYIT': 'NSE_INDEX|Nifty IT',
  'NSE:NIFTYFIN': 'NSE_INDEX|Nifty Fin Service', 'NSE:NIFTYMID': 'NSE_INDEX|NIFTY MID SELECT', 'NSE:NIFTY500': 'NSE_INDEX|Nifty 500',
  'NSE:INDIAVIX': 'NSE_INDEX|India VIX', 'BSE:SENSEX': 'BSE_INDEX|SENSEX', 'BSE:BSE500': 'BSE_INDEX|BSE500', 'BSE:BANKEX': 'BSE_INDEX|BANKEX',
}

/** `NSE_EQ|<ISIN>` for a stock, or the index key. Null when the ISIN is unknown, in which case intraday is unavailable. */
export function upstoxKey(inst: Pick<Instrument, 'id' | 'exchange' | 'kind'>, isin: string | undefined): string | null {
  if (inst.kind === 'index') return INDEX_KEYS[inst.id] ?? null
  return isin ? `${inst.exchange}_EQ|${isin}` : null
}

export const intradayAvailable = (tf: Timeframe): tf is Intra => isIntraday(tf) && tf in PLAN

/** Upstox sends newest first, with ISO times carrying +05:30. Returns oldest first, de-duplicated, flagging bars still forming. */
export function parseUpstoxCandles(json: unknown, tf: Intra, now: number): Candle[] {
  const rows = (json as { data?: { candles?: unknown[] } } | null)?.data?.candles
  if (!Array.isArray(rows)) return []
  const step = STEP_MS[tf]
  const byT = new Map<number, Candle>()
  for (const r of rows) {
    if (!Array.isArray(r)) continue
    const t = Date.parse(String(r[0]))
    const [o, h, l, c] = [r[1], r[2], r[3], r[4]].map(Number)
    const v = Number(r[5] ?? 0)
    if (!Number.isFinite(t) || ![o, h, l, c].every(x => Number.isFinite(x) && x > 0) || h < l) continue
    byT.set(t, { t, o, h, l, c, v: Number.isFinite(v) ? v : 0, closed: t + step <= now })
  }
  return [...byT.values()].sort((a, b) => a.t - b.t)
}

/** Combine two oldest-first lists; the second wins where they overlap (it is newer). */
export function mergeBars(a: Candle[], b: Candle[]): Candle[] {
  const m = new Map<number, Candle>()
  for (const c of a) m.set(c.t, c)
  for (const c of b) m.set(c.t, c)
  return [...m.values()].sort((x, y) => x.t - y.t)
}

export const historyUrl = (key: string, tf: Intra, now: number) => {
  const p = PLAN[tf]
  return `${BASE}/${encodeURIComponent(key)}/${p.unit}/${p.n}/${istDate(now)}/${istDate(now - p.days * 86_400_000)}`
}
export const todayUrl = (key: string, tf: Intra) => `${BASE}/intraday/${encodeURIComponent(key)}/${PLAN[tf].unit}/${PLAN[tf].n}`

export type FetchJson = (url: string) => Promise<{ status: number; json: unknown }>
export const browserJson: FetchJson = async url => {
  const r = await fetch(url, { headers: { accept: 'application/json' } })
  return { status: r.status, json: await r.json().catch(() => null) }
}

export class IntradayError extends Error {}

/**
 * Candles for one instrument and interval: the recent history plus today's session so far, in two requests. With
 * `onlyToday` just the session so far is fetched, which is what a refresh needs.
 */
export async function fetchIntraday(key: string, tf: Intra, now: number, get: FetchJson = browserJson, onlyToday = false): Promise<Candle[]> {
  const calls = [get(todayUrl(key, tf)), ...(onlyToday ? [] : [get(historyUrl(key, tf, now))])]
  const settled = await Promise.allSettled(calls)
  const bars: Candle[][] = []
  let failure: string | null = null
  for (const s of settled) {
    if (s.status === 'rejected') { failure = 'Could not reach the intraday data service.'; continue }
    if (s.value.status !== 200) { failure = `The intraday data service answered HTTP ${s.value.status}.`; continue }
    bars.push(parseUpstoxCandles(s.value.json, tf, now))
  }
  const merged = bars.reduce<Candle[]>((acc, b) => mergeBars(acc, b), [])
  if (!merged.length) throw new IntradayError(failure ?? 'No intraday candles were returned (the market may not have traded yet).')
  return merged
}
