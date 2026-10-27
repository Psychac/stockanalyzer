import type { Candle, Series } from './types'
import { istDate } from './time'

const nulls = (n: number): Series => new Array(n).fill(null)

export function sma(values: Series, period: number): Series {
  const out = nulls(values.length)
  let sum = 0
  let count = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v === null) { sum = 0; count = 0; continue }
    sum += v
    count++
    if (count > period) { sum -= values[i - period] as number; count = period }
    if (count === period) out[i] = sum / period
  }
  return out
}

/** EMA seeded with the SMA of the first `period` values (warm-up = period-1 nulls). */
export function ema(values: Series, period: number): Series {
  const out = nulls(values.length)
  const k = 2 / (period + 1)
  let prev: number | null = null
  let seed = 0
  let seedN = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v === null) continue
    if (prev === null) {
      seed += v
      seedN++
      if (seedN === period) { prev = seed / period; out[i] = prev }
    } else {
      prev = v * k + prev * (1 - k)
      out[i] = prev
    }
  }
  return out
}

/** Wilder's RSI. First value at index `period`. */
export function rsi(closes: number[], period = 14): Series {
  const out = nulls(closes.length)
  if (closes.length <= period) return out
  let gain = 0
  let loss = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    if (d >= 0) gain += d; else loss -= d
  }
  gain /= period
  loss /= period
  const val = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss))
  out[period] = val()
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    gain = (gain * (period - 1) + Math.max(d, 0)) / period
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period
    out[i] = val()
  }
  return out
}

export interface MacdResult { macd: Series; signal: Series; hist: Series }

export function macd(closes: number[], fast = 12, slow = 26, signalP = 9): MacdResult {
  const f = ema(closes, fast)
  const s = ema(closes, slow)
  const line: Series = closes.map((_, i) => (f[i] !== null && s[i] !== null ? (f[i] as number) - (s[i] as number) : null))
  const signal = ema(line, signalP)
  const hist: Series = line.map((m, i) => (m !== null && signal[i] !== null ? m - (signal[i] as number) : null))
  return { macd: line, signal, hist }
}

/** Wilder's ATR. First value at index `period`. */
export function atr(candles: Candle[], period = 14): Series {
  const out = nulls(candles.length)
  if (candles.length <= period) return out
  const tr = (i: number) => {
    const c = candles[i]
    const pc = candles[i - 1].c
    return Math.max(c.h - c.l, Math.abs(c.h - pc), Math.abs(c.l - pc))
  }
  let a = 0
  for (let i = 1; i <= period; i++) a += tr(i)
  a /= period
  out[period] = a
  for (let i = period + 1; i < candles.length; i++) {
    a = (a * (period - 1) + tr(i)) / period
    out[i] = a
  }
  return out
}

/** Session VWAP: resets each IST trading day. Only meaningful for intraday candles. */
export function vwap(candles: Candle[]): Series {
  const out = nulls(candles.length)
  let day = ''
  let pv = 0
  let vol = 0
  for (let i = 0; i < candles.length; i++) {
    const d = istDate(candles[i].t)
    if (d !== day) { day = d; pv = 0; vol = 0 }
    const typical = (candles[i].h + candles[i].l + candles[i].c) / 3
    pv += typical * candles[i].v
    vol += candles[i].v
    out[i] = vol > 0 ? pv / vol : null
  }
  return out
}

/** Volume relative to the average of the previous `period` bars (excludes the current bar). */
export function relVolume(candles: Candle[], period = 20): Series {
  const vols: Series = candles.map(c => c.v)
  const avg = sma(vols, period)
  return candles.map((c, i) => (i > 0 && avg[i - 1] ? c.v / (avg[i - 1] as number) : null))
}

/** Highest value of `values` over the previous `period` bars, excluding the current bar. */
export function highestPrior(values: number[], period: number): Series {
  const out = nulls(values.length)
  for (let i = period; i < values.length; i++) {
    let m = -Infinity
    for (let j = i - period; j < i; j++) m = Math.max(m, values[j])
    out[i] = m
  }
  return out
}

export function lowestPrior(values: number[], period: number): Series {
  const out = nulls(values.length)
  for (let i = period; i < values.length; i++) {
    let m = Infinity
    for (let j = i - period; j < i; j++) m = Math.min(m, values[j])
    out[i] = m
  }
  return out
}

/** Percentage return over `period` bars. */
export function pctReturn(closes: number[], period: number): Series {
  return closes.map((c, i) => (i >= period && closes[i - period] > 0 ? (c / closes[i - period] - 1) * 100 : null))
}
