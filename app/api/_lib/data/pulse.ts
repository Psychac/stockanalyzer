import type { Exchange, History } from './history.js'

/**
 * A tiny market summary computed once per day from the full history, so the dashboard can show whole-market breadth and the
 * biggest movers without downloading any price data. Prices are integer paise, changes are percent.
 */
export interface PulseMover { id: string; sym: string; name: string; c: number; chg: number }
export interface ExchangePulse {
  /** Stocks that traded on the latest session. */
  total: number
  adv: number
  dec: number
  unch: number
  /** Closing at a new high / low for the window we hold (about a year), among stocks with at least ~6 months of history. */
  highs: number
  lows: number
  gainers: PulseMover[]
  losers: PulseMover[]
}
export interface Pulse { date: string; NSE?: ExchangePulse; BSE?: ExchangePulse }

export interface PulseOptions {
  /** Movers must trade at least this much a day on average (rupees). Keeps illiquid one-lot jumps off the list. */
  minAvgTurnover?: number
  top?: number
}

const EXCHANGES: Exchange[] = ['NSE', 'BSE']

export function buildPulse(h: History, opts: PulseOptions = {}): Pulse {
  const minAvg = opts.minAvgTurnover ?? 50_000_000 // Rs 5 crore
  const top = opts.top ?? 8
  const n = h.dates.length
  const pulse: Pulse = { date: h.dates[n - 1] ?? '' }
  if (!n) return pulse
  const acc: Record<Exchange, { p: ExchangePulse; movers: PulseMover[] }> = {
    NSE: { p: { total: 0, adv: 0, dec: 0, unch: 0, highs: 0, lows: 0, gainers: [], losers: [] }, movers: [] },
    BSE: { p: { total: 0, adv: 0, dec: 0, unch: 0, highs: 0, lows: 0, gainers: [], losers: [] }, movers: [] },
  }
  for (const s of Object.values(h.stocks)) {
    if (!(s.c[n - 1] > 0)) continue // did not trade on the latest session
    let prev = 0
    for (let i = n - 2; i >= 0; i--) if (s.c[i] > 0) { prev = s.c[i]; break }
    if (!prev) continue
    const a = acc[s.ex]
    const last = s.c[n - 1]
    a.p.total++
    if (last > prev) a.p.adv++
    else if (last < prev) a.p.dec++
    else a.p.unch++
    const closes = s.c.filter(x => x > 0)
    if (closes.length >= 120) {
      if (last >= Math.max(...closes)) a.p.highs++
      if (last <= Math.min(...closes)) a.p.lows++
    }
    // Average daily turnover over the last 20 sessions the stock traded.
    let t = 0
    let k = 0
    for (let i = n - 1; i >= 0 && k < 20; i--) if (s.c[i] > 0) { t += (s.c[i] / 100) * s.v[i]; k++ }
    if (k && t / k >= minAvg) a.movers.push({ id: s.id, sym: s.sym, name: s.name ?? s.sym, c: last, chg: Math.round((last / prev - 1) * 10_000) / 100 })
  }
  for (const ex of EXCHANGES) {
    const { p, movers } = acc[ex]
    if (!p.total) continue
    movers.sort((x, y) => y.chg - x.chg)
    p.gainers = movers.filter(m => m.chg > 0).slice(0, top)
    p.losers = movers.filter(m => m.chg < 0).slice(-top).reverse()
    pulse[ex] = p
  }
  return pulse
}
