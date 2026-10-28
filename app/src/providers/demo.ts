import type { Candle, CandleSet, Instrument, Timeframe } from '../domain/types'
import type { ConnectionStatus, MarketDataProvider, Quote } from './types'
import { BENCHMARK, DEMO_UNIVERSE } from './universe'

/** [base price, avg traded value ₹ Cr, beta, daily vol %] per NSE symbol. Synthetic. */
const PARAMS: Record<string, [number, number, number, number]> = {
  'RELIANCE': [2900, 1800, 1.0, 1.4],
  'TCS': [3900, 900, 0.7, 1.2],
  'HDFCBANK': [1650, 1700, 0.9, 1.2],
  'INFY': [1600, 800, 0.8, 1.4],
  'ICICIBANK': [1180, 1500, 1.0, 1.3],
  'SBIN': [780, 1200, 1.2, 1.6],
  'BHARTIARTL': [1450, 900, 0.8, 1.3],
  'ITC': [440, 800, 0.6, 1.1],
  'LT': [3500, 700, 1.1, 1.5],
  'KOTAKBANK': [1800, 500, 0.9, 1.3],
  'AXISBANK': [1150, 800, 1.2, 1.6],
  'HINDUNILVR': [2450, 450, 0.5, 1.1],
  'BAJFINANCE': [7100, 800, 1.3, 1.8],
  'MARUTI': [12500, 500, 0.9, 1.4],
  'SUNPHARMA': [1750, 500, 0.6, 1.3],
  'TMPV': [950, 1000, 1.4, 1.9],
  'TATASTEEL': [150, 700, 1.4, 1.9],
  'NTPC': [360, 600, 0.9, 1.5],
  'POWERGRID': [320, 400, 0.7, 1.3],
  'ONGC': [270, 450, 1.0, 1.6],
  'ADANIENT': [2500, 600, 1.6, 2.3],
  'ADANIPORTS': [1350, 550, 1.3, 1.9],
  'ASIANPAINT': [2400, 350, 0.7, 1.3],
  'TITAN': [3400, 450, 1.0, 1.6],
  'ULTRACEMCO': [11000, 300, 0.9, 1.4],
  'WIPRO': [520, 300, 0.8, 1.4],
  'HCLTECH': [1700, 450, 0.8, 1.4],
  'TECHM': [1550, 300, 0.9, 1.6],
  'M&M': [3000, 650, 1.1, 1.6],
  'DRREDDY': [1280, 300, 0.6, 1.3],
  'CIPLA': [1500, 300, 0.6, 1.3],
  'JSWSTEEL': [960, 450, 1.3, 1.8],
  'HINDALCO': [650, 500, 1.4, 1.8],
  'COALINDIA': [470, 450, 0.9, 1.5],
  'INDUSINDBK': [1050, 400, 1.4, 2.0],
  'BAJAJFINSV': [1800, 350, 1.2, 1.6],
  'NESTLEIND': [2400, 200, 0.4, 1.0],
  'BRITANNIA': [5200, 200, 0.5, 1.1],
  'EICHERMOT': [4800, 300, 1.0, 1.5],
  'HEROMOTOCO': [4500, 250, 0.9, 1.5],
  'DIVISLAB': [5200, 250, 0.7, 1.5],
  'GRASIM': [2600, 250, 1.0, 1.4],
  'TRENT': [6200, 450, 1.5, 2.2],
  'DLF': [800, 400, 1.5, 2.1],
  'PIDILITIND': [3000, 200, 0.7, 1.3],
  'SIEMENS': [6800, 250, 1.1, 1.8],
  'HAL': [4300, 500, 1.3, 2.0],
  'BEL': [300, 600, 1.3, 1.9],
  'ETERNAL': [240, 900, 1.6, 2.4],
  'IRCTC': [800, 200, 1.0, 1.7],
}

type Params = [number, number, number, number]

/* ── deterministic RNG ── */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const hash = (s: string) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) } return h >>> 0 }
function normal(rnd: () => number) { return Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd()) }

const BARS = 520
const OPEN_UTC_OFFSET_MS = (9 * 60 + 15 - 330) * 60 * 1000 // 09:15 IST expressed in UTC

/** Last weekday strictly before today, so every demo bar is a closed one. */
function tradingDays(n: number): number[] {
  const out: number[] = []
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  while (out.length < n) {
    d.setUTCDate(d.getUTCDate() - 1)
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) out.push(d.getTime() + OPEN_UTC_OFFSET_MS)
  }
  return out.reverse()
}

/** Shared market return series (drives beta and the benchmark). */
function marketReturns(): number[] {
  const rnd = mulberry32(20260101)
  const out: number[] = []
  let drift = 0.0004
  for (let i = 0; i < BARS; i++) {
    if (i % 45 === 0) drift = (rnd() - 0.35) * 0.0012
    out.push(drift + normal(rnd) * 0.0085)
  }
  return out
}

type Shape = 'breakout' | 'pullback' | 'bounce' | 'sideways' | 'random'
const SHAPES: Shape[] = ['breakout', 'pullback', 'random', 'bounce', 'random', 'sideways', 'pullback', 'random', 'breakout', 'random']

function build(inst: Instrument, row: Params | null, days: number[], mkt: number[], idx: number): Candle[] {
  const rnd = mulberry32(hash(inst.id))
  const [base, tvCr, beta, volPct] = row ?? [22000, 0, 1, 0.9]
  const shape: Shape = row ? SHAPES[idx % SHAPES.length] : 'random'
  const closes: number[] = []
  const rets: number[] = []
  let drift = 0.0006
  for (let i = 0; i < BARS; i++) {
    const fromEnd = BARS - 1 - i
    if (i % 40 === 0) drift = (rnd() - 0.3) * 0.0016
    let r = drift + beta * mkt[i] * 0.8 + normal(rnd) * (volPct / 100) * 0.7
    if (row && shape === 'breakout') {
      if (fromEnd > 22 && fromEnd <= 70) r = 0.004 + normal(rnd) * 0.009
      if (fromEnd <= 22 && fromEnd >= 1) r = normal(rnd) * 0.0045
      if (fromEnd === 0) r = 0.02
    } else if (row && shape === 'pullback') {
      if (fromEnd > 12 && fromEnd <= 90) r = 0.0045 + normal(rnd) * 0.008
      else if (fromEnd > 1 && fromEnd <= 12) r = -0.0045 + normal(rnd) * 0.004
      else if (fromEnd === 1) r = -0.002
      else if (fromEnd === 0) r = 0.009
    } else if (row && shape === 'bounce') {
      if (fromEnd > 8 && fromEnd <= 70) r = -0.0035 + normal(rnd) * 0.011
      else if (fromEnd > 0) r = -0.004 + normal(rnd) * 0.007
      else r = 0.022
    } else if (row && shape === 'sideways' && fromEnd < 80) r = normal(rnd) * (volPct / 100) * 0.55
    rets.push(r)
    closes.push(0)
  }
  // Walk back from the base price so the series ends near the nominal level.
  let acc = 1
  const rel: number[] = new Array(BARS)
  for (let i = BARS - 1; i >= 0; i--) { rel[i] = acc; acc /= 1 + rets[i] }
  const startScale = base / rel[BARS - 1]
  for (let i = 0; i < BARS; i++) closes[i] = rel[i] * startScale
  const baseShares = row ? (tvCr * 1e7) / base : 250_000_000

  const candles: Candle[] = []
  for (let i = 0; i < BARS; i++) {
    const c = closes[i]
    const prev = i > 0 ? closes[i - 1] : c / (1 + rets[0])
    const gap = normal(rnd) * 0.002
    const o = prev * (1 + gap)
    const range = Math.abs(rets[i]) + (volPct / 100) * 0.45 * rnd()
    const h = Math.max(o, c) * (1 + range * 0.35 * rnd())
    const l = Math.min(o, c) * (1 - range * 0.35 * rnd())
    const fromEnd = BARS - 1 - i
    let volMult = Math.exp(normal(rnd) * 0.3) * (1 + Math.min(Math.abs(rets[i]) / (volPct / 100 || 0.01), 4) * 0.25)
    if (row && shape === 'breakout' && fromEnd === 0) volMult = 2.4
    if (row && shape === 'breakout' && fromEnd > 0 && fromEnd <= 22) volMult *= 0.7
    candles.push({ t: days[i], o, h, l, c, v: Math.round(baseShares * volMult), closed: true })
  }
  return candles
}

let cache: { key: string; map: Map<string, Candle[]> } | null = null
function all(): Map<string, Candle[]> {
  const days = tradingDays(BARS)
  const key = String(days[days.length - 1])
  if (cache?.key === key) return cache.map
  const mkt = marketReturns()
  const map = new Map<string, Candle[]>()
  DEMO_UNIVERSE.forEach((inst, idx) => map.set(inst.id, build(inst, PARAMS[inst.symbol], days, mkt, idx)))
  // Benchmark: market series scaled to an index-like level.
  const bench: Candle[] = []
  let level = 22000
  const closes: number[] = []
  for (let i = BARS - 1; i >= 0; i--) { closes[i] = level; level /= 1 + mkt[i] }
  for (let i = 0; i < BARS; i++) {
    const c = closes[i]
    const prev = i > 0 ? closes[i - 1] : c
    bench.push({ t: days[i], o: prev, h: Math.max(prev, c) * 1.002, l: Math.min(prev, c) * 0.998, c, v: 0, closed: true })
  }
  map.set(BENCHMARK.id, bench)
  cache = { key, map }
  return map
}

/**
 * Synthetic data for building and testing the app. Deterministic per symbol, NOT market data.
 * `isLive` is always false so the UI can never present it as real.
 */
export class DemoProvider implements MarketDataProvider {
  readonly id = 'demo' as const
  readonly label = 'Demo data (synthetic)'
  readonly isLive = false

  async connect() {}
  async disconnect() {}
  getConnectionStatus(): ConnectionStatus { return { state: 'demo', note: 'Synthetic prices for development. Not real market data.' } }
  async getInstruments() { return DEMO_UNIVERSE }

  async getHistoricalCandles(instrument: Instrument, interval: Timeframe, bars: number): Promise<CandleSet> {
    if (interval !== '1D') throw new Error('Demo provider only supports daily candles')
    const candles = all().get(instrument.id)
    if (!candles) throw new Error(`Unknown instrument ${instrument.id}`)
    return { instrument, timeframe: interval, candles: candles.slice(-bars), source: 'demo', asOf: candles[candles.length - 1].t }
  }

  async getQuotes(instruments: Instrument[]): Promise<Quote[]> {
    return instruments.map(inst => {
      const c = all().get(inst.id)!
      const last = c[c.length - 1]
      return { instrumentId: inst.id, ltp: last.c, prevClose: c[c.length - 2].c, at: last.t, source: 'demo' as const }
    })
  }
}

export const demoProvider = new DemoProvider()
