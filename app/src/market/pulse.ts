import type { CandleSet } from '../domain/types'
import type { ExchangePulse, PulseMover } from './client'

/**
 * The same summary the backend publishes, computed from candle sets already in memory. Used for demo mode, whose synthetic stocks
 * are not in the backend's files. Prices are returned in paise, matching the published shape.
 */
export function pulseFromSets(sets: Iterable<CandleSet>, top = 8): ExchangePulse | null {
  const p: ExchangePulse = { total: 0, adv: 0, dec: 0, unch: 0, highs: 0, lows: 0, gainers: [], losers: [] }
  const movers: PulseMover[] = []
  for (const s of sets) {
    const c = s.candles
    if (c.length < 2) continue
    const last = c[c.length - 1].c
    const prev = c[c.length - 2].c
    p.total++
    if (last > prev) p.adv++
    else if (last < prev) p.dec++
    else p.unch++
    if (c.length >= 120) {
      const closes = c.map(x => x.c)
      if (last >= Math.max(...closes)) p.highs++
      if (last <= Math.min(...closes)) p.lows++
    }
    movers.push({ id: s.instrument.id, sym: s.instrument.symbol, name: s.instrument.name, c: Math.round(last * 100), chg: Math.round((last / prev - 1) * 10_000) / 100 })
  }
  if (!p.total) return null
  movers.sort((a, b) => b.chg - a.chg)
  p.gainers = movers.filter(m => m.chg > 0).slice(0, top)
  p.losers = movers.filter(m => m.chg < 0).slice(-top).reverse()
  return p
}
