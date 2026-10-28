/**
 * Compact market-wide daily history, shared by the server ingest and the browser client so both apply days identically.
 * Pure TypeScript: no Node or browser APIs.
 *
 * Prices are integer paise, volume is a raw integer, and every stock's arrays line up with `dates` (0 = no trade that day).
 * Exchange files carry unadjusted prices, so each day's previous close is used to detect splits, bonuses and similar actions
 * and back-adjust older bars; otherwise an event looks like a crash.
 */
export type Exchange = 'NSE' | 'BSE'

export interface DayRow {
  id: string
  ex: Exchange
  sym: string
  isin?: string
  name?: string
  /** Industry, when a free list knows it (about a third of liquid stocks). */
  sector?: string
  o: number; h: number; l: number; c: number
  /** Previous close, paise, as reported by the exchange for that day. */
  pc: number
  v: number
}

export interface Stock {
  id: string
  ex: Exchange
  sym: string
  isin?: string
  name?: string
  sector?: string
  o: number[]; h: number[]; l: number[]; c: number[]; v: number[]
}

export interface History {
  version: 1
  dates: string[]
  stocks: Record<string, Stock>
}

export const MAX_SESSIONS = 260
/** Ignore previous-close differences smaller than this ratio; rounding to paise is not an action. */
const ADJUST_EPS = 0.0005

/**
 * Liquidity rule. About 9,700 NSE and BSE stocks trade, but thousands barely do, and shipping them all would cost ~28 MB per
 * device for rows no sensible scan would use. A stock is admitted only on a day its turnover reaches ADMIT_TURNOVER, and
 * `prune` later drops those whose average falls below KEEP_TURNOVER (lower, to avoid churn). Applied identically by server and
 * client, so deltas reproduce the server's history exactly.
 */
export const ADMIT_TURNOVER = 5_000_000
export const KEEP_TURNOVER = 2_500_000
const turnover = (c: number, v: number) => (c / 100) * v

/** Rows the history would accept: any known stock, or a new one liquid enough on this day. */
export const admissible = (h: History, rows: DayRow[]) => rows.filter(r => r.id in h.stocks || turnover(r.c, r.v) >= ADMIT_TURNOVER)

/** Drop stocks whose average turnover over the days they traded is below KEEP_TURNOVER. Returns how many were dropped. */
export function prune(h: History): number {
  let dropped = 0
  for (const [id, s] of Object.entries(h.stocks)) {
    let t = 0, k = 0
    for (let i = 0; i < s.c.length; i++) if (s.c[i] > 0) { t += turnover(s.c[i], s.v[i]); k++ }
    if (!k || t / k < KEEP_TURNOVER) { delete h.stocks[id]; dropped++ }
  }
  return dropped
}

/** One exchange's slice, so a device that only wants NSE does not download BSE. */
export const sliceOf = (h: History, ex: Exchange): History => ({ version: 1, dates: h.dates, stocks: Object.fromEntries(Object.entries(h.stocks).filter(([, s]) => s.ex === ex)) })

export function mergeHistories(parts: History[]): History {
  const out = emptyHistory()
  const longest = parts.reduce((a, b) => (b.dates.length > a.length ? b.dates : a), [] as string[])
  out.dates = [...longest]
  for (const p of parts) Object.assign(out.stocks, p.stocks)
  return out
}

export const emptyHistory = (): History => ({ version: 1, dates: [], stocks: {} })

const lastNonZero = (a: number[]) => { for (let i = a.length - 1; i >= 0; i--) if (a[i] > 0) return a[i]; return 0 }

function adjustPast(s: Stock, ratio: number) {
  for (let i = 0; i < s.c.length; i++) {
    if (s.c[i] <= 0) continue
    s.o[i] = Math.round(s.o[i] * ratio); s.h[i] = Math.round(s.h[i] * ratio)
    s.l[i] = Math.round(s.l[i] * ratio); s.c[i] = Math.round(s.c[i] * ratio)
    s.v[i] = Math.round(s.v[i] / ratio)
  }
}

/** Append one trading day. Days must arrive in order; a repeat or older date is ignored and reported as false. */
export function applyDay(h: History, date: string, rows: DayRow[]): boolean {
  if (h.dates.length && date <= h.dates[h.dates.length - 1]) return false
  const n = h.dates.length
  h.dates.push(date)
  const seen = new Set<string>()
  for (const r of rows) {
    if (seen.has(r.id)) continue
    seen.add(r.id)
    let s = h.stocks[r.id]
    if (!s && turnover(r.c, r.v) < ADMIT_TURNOVER) continue
    if (!s) {
      s = h.stocks[r.id] = { id: r.id, ex: r.ex, sym: r.sym, isin: r.isin, name: r.name, sector: r.sector, o: new Array(n).fill(0), h: new Array(n).fill(0), l: new Array(n).fill(0), c: new Array(n).fill(0), v: new Array(n).fill(0) }
    } else {
      s.sym = r.sym
      if (r.isin) s.isin = r.isin
      if (r.name) s.name = r.name
      if (r.sector) s.sector = r.sector
      const last = lastNonZero(s.c)
      if (last > 0 && r.pc > 0) {
        const ratio = r.pc / last
        if (Math.abs(ratio - 1) > ADJUST_EPS && ratio > 0.01 && ratio < 100) adjustPast(s, ratio)
      }
    }
    s.o.push(r.o); s.h.push(r.h); s.l.push(r.l); s.c.push(r.c); s.v.push(r.v)
  }
  for (const s of Object.values(h.stocks)) {
    if (s.c.length === n) { s.o.push(0); s.h.push(0); s.l.push(0); s.c.push(0); s.v.push(0) }
  }
  if (h.dates.length > MAX_SESSIONS) trim(h, h.dates.length - MAX_SESSIONS)
  return true
}

function trim(h: History, drop: number) {
  h.dates.splice(0, drop)
  for (const [id, s] of Object.entries(h.stocks)) {
    s.o.splice(0, drop); s.h.splice(0, drop); s.l.splice(0, drop); s.c.splice(0, drop); s.v.splice(0, drop)
    if (!s.c.some(x => x > 0)) delete h.stocks[id]
  }
}

/** A stock's bars as the app's Candle shape (rupees, caller-supplied timestamp), skipping non-trading days. */
export function candlesOf(h: History, id: string, openMs: (date: string) => number): { t: number; o: number; h: number; l: number; c: number; v: number }[] {
  const s = h.stocks[id]
  if (!s) return []
  const out = []
  for (let i = 0; i < h.dates.length; i++) if (s.c[i] > 0) out.push({ t: openMs(h.dates[i]), o: s.o[i] / 100, h: s.h[i] / 100, l: s.l[i] / 100, c: s.c[i] / 100, v: s.v[i] })
  return out
}
