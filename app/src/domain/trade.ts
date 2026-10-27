import type { CandleSet } from './types'
import { makeContext, series, type EvalContext } from './scanner'

/** Snapshot states. Persistent lifecycle tracking (target/stop/expired) arrives with the signals table. */
export type SignalState = 'watching' | 'setup_forming' | 'entry_eligible' | 'missed_entry' | 'data_insufficient'

export const STATE_LABEL: Record<SignalState, string> = {
  watching: 'Watching',
  setup_forming: 'Setup forming',
  entry_eligible: 'Entry eligible',
  missed_entry: 'Missed entry',
  data_insufficient: 'Not enough data',
}

export interface Check { label: string; pass: boolean; detail: string; weight: number }

export interface TradePlan {
  strategyId: string
  strategyVersion: number
  state: SignalState
  /** Entry reference price for sizing. For forming setups this is the trigger level. */
  entry: number
  entryZone: [number, number]
  stop: number
  targets: { rr: number; price: number }[]
  riskPerShare: number
  /** Reward/risk of the first target. */
  rewardRisk: number
  /** Share of weighted criteria met, 0–100. A setup score, not a probability. */
  score: number
  checks: Check[]
  summary: string
  /** Horizontal level the setup is built around, when applicable. */
  level: number | null
  /** The signal comes from a candle that has closed. */
  provisional: boolean
  asOf: number
}

export interface StrategyParams { rr: [number, number] }
export const DEFAULT_PARAMS: StrategyParams = { rr: [2, 3] }

export interface Strategy {
  id: string
  version: number
  name: string
  description: string
  timeframe: '1D'
  minBars: number
  evaluate: (set: CandleSet, params?: StrategyParams, ctx?: EvalContext) => TradePlan
}

const lastOf = (s: (number | null)[]) => s[s.length - 1]

export function buildTargets(entry: number, stop: number, rr: number[]) {
  const risk = entry - stop
  return rr.map(m => ({ rr: m, price: entry + risk * m }))
}

function finish(
  id: string, version: number, set: CandleSet, params: StrategyParams,
  checks: Check[], state: SignalState, entry: number, zone: [number, number], stop: number, level: number | null, summary: string,
): TradePlan {
  const totalW = checks.reduce((a, c) => a + c.weight, 0)
  const score = totalW ? (checks.filter(c => c.pass).reduce((a, c) => a + c.weight, 0) / totalW) * 100 : 0
  const risk = entry - stop
  const targets = risk > 0 ? buildTargets(entry, stop, params.rr) : []
  const lastCandle = set.candles[set.candles.length - 1]
  return {
    strategyId: id, strategyVersion: version, state, entry, entryZone: zone, stop, targets,
    riskPerShare: Math.max(risk, 0), rewardRisk: risk > 0 ? params.rr[0] : 0, score, checks, summary, level,
    provisional: !lastCandle.closed, asOf: lastCandle.t,
  }
}

function insufficient(id: string, version: number, set: CandleSet, params: StrategyParams, need: number): TradePlan {
  const c = set.candles[set.candles.length - 1]?.c ?? 0
  return finish(id, version, set, params, [{ label: 'History', pass: false, detail: `Needs ${need} bars, have ${set.candles.length}`, weight: 1 }], 'data_insufficient', c, [c, c], c, null, 'Not enough history to evaluate this strategy.')
}

const pct = (a: number, b: number) => ((a / b - 1) * 100).toFixed(1)

/* ── Swing breakout ─────────────────────────────────────────────── */

export const swingBreakout: Strategy = {
  id: 'swing-breakout', version: 1, name: 'Swing breakout', timeframe: '1D', minBars: 210,
  description: 'Close above the prior 20-day high with volume confirmation inside an uptrend. Stop sits one ATR below the broken level.',
  evaluate(set, params = DEFAULT_PARAMS, ctx = makeContext(set, null)) {
    if (set.candles.length < this.minBars) return insufficient(this.id, this.version, set, params, this.minBars)
    const n = set.candles.length - 1
    const close = ctx.closes[n]
    const level = lastOf(series(ctx, 'highest', { period: 20 })) as number
    const atr = lastOf(series(ctx, 'atr', { period: 14 })) as number
    const s50 = lastOf(series(ctx, 'sma', { period: 50 })) as number
    const s200 = lastOf(series(ctx, 'sma', { period: 200 })) as number
    const rv = lastOf(series(ctx, 'relVolume', { period: 20 })) as number

    const zone: [number, number] = [level, level + 1 * atr]
    const stop = level - atr
    const trend = close > s50 && s50 > s200
    const broke = close > level
    const volOk = rv >= 1.5
    const notExtended = close <= zone[1]
    const near = !broke && close >= level * 0.97
    const checks: Check[] = [
      { label: 'Uptrend', pass: trend, detail: `Close ${close.toFixed(2)} vs SMA50 ${s50.toFixed(2)} vs SMA200 ${s200.toFixed(2)}`, weight: 2 },
      { label: 'Closes above 20-day high', pass: broke, detail: `Resistance ${level.toFixed(2)}; close is ${pct(close, level)}% from it`, weight: 3 },
      { label: 'Volume ≥ 1.5× average', pass: volOk, detail: `Relative volume ${rv.toFixed(2)}×`, weight: 2 },
      { label: 'Not extended (≤ 1 ATR above level)', pass: !broke || notExtended, detail: `Entry zone tops out at ${zone[1].toFixed(2)}`, weight: 1 },
    ]

    let state: SignalState = 'watching'
    let summary = 'No breakout setup: trend or proximity to resistance is not met.'
    let entry = level
    if (trend && broke && volOk && notExtended) { state = 'entry_eligible'; entry = close; summary = `Closed above ${level.toFixed(2)} on ${rv.toFixed(1)}× volume. Entry zone ${zone[0].toFixed(2)}–${zone[1].toFixed(2)}.` }
    else if (trend && broke && !notExtended) { state = 'missed_entry'; entry = close; summary = `Broke out but price is more than 1 ATR above the level. Chasing here widens risk.` }
    else if (trend && broke && !volOk) { state = 'setup_forming'; entry = close; summary = 'Price cleared resistance but volume did not confirm. Wait for confirmation.' }
    else if (trend && near) { state = 'setup_forming'; summary = `Within 3% of resistance ${level.toFixed(2)}. Trigger is a close above it with volume.` }
    return finish(this.id, this.version, set, params, checks, state, entry, zone, stop, level, summary)
  },
}

/* ── Trend pullback ─────────────────────────────────────────────── */

export const trendPullback: Strategy = {
  id: 'trend-pullback', version: 1, name: 'Trend pullback', timeframe: '1D', minBars: 210,
  description: 'Uptrend with a pullback to the 20 EMA and a bullish confirmation bar. Stop sits below the recent 5-day low.',
  evaluate(set, params = DEFAULT_PARAMS, ctx = makeContext(set, null)) {
    if (set.candles.length < this.minBars) return insufficient(this.id, this.version, set, params, this.minBars)
    const n = set.candles.length - 1
    const c = set.candles
    const close = c[n].c
    const ema20 = lastOf(series(ctx, 'ema', { period: 20 })) as number
    const s50 = lastOf(series(ctx, 'sma', { period: 50 })) as number
    const s200 = lastOf(series(ctx, 'sma', { period: 200 })) as number
    const atr = lastOf(series(ctx, 'atr', { period: 14 })) as number
    const rsiS = series(ctx, 'rsi', { period: 14 })
    const rsi = rsiS[n] as number
    const rsiPrev = rsiS[n - 1] as number
    const emaS = series(ctx, 'ema', { period: 20 })

    let ran = false
    for (let i = n - 10; i < n; i++) if (c[i].c >= (emaS[i] as number) * 1.04) ran = true

    const dist = (close / ema20 - 1) * 100
    const trend = s50 > s200 && close > s50
    const near = Math.abs(dist) <= 2.5
    const bullish = close > c[n].o && close > c[n - 1].c
    const rsiOk = rsi >= 40 && rsi > rsiPrev
    const stop = Math.min(...c.slice(n - 4).map(x => x.l)) - 0.25 * atr
    const checks: Check[] = [
      { label: 'Uptrend (SMA50 > SMA200, close > SMA50)', pass: trend, detail: `SMA50 ${s50.toFixed(2)} · SMA200 ${s200.toFixed(2)}`, weight: 3 },
      { label: 'Prior push above EMA20', pass: ran, detail: ran ? 'Closed ≥ 4% above EMA20 in the last 10 bars' : 'No recent extension above EMA20', weight: 1 },
      { label: 'Pulled back to EMA20 (±2.5%)', pass: near, detail: `Close is ${dist.toFixed(1)}% from EMA20 (${ema20.toFixed(2)})`, weight: 2 },
      { label: 'Bullish confirmation bar', pass: bullish, detail: bullish ? 'Close above open and prior close' : 'Last bar is not a bullish close', weight: 2 },
      { label: 'RSI ≥ 40 and rising', pass: rsiOk, detail: `RSI ${rsi.toFixed(0)} (prev ${rsiPrev.toFixed(0)})`, weight: 1 },
    ]
    let state: SignalState = 'watching'
    let summary = 'Not a pullback in an uptrend right now.'
    if (trend && near && bullish && rsiOk) { state = 'entry_eligible'; summary = `Bounced from EMA20 (${ema20.toFixed(2)}) with RSI turning up.` }
    else if (trend && near) { state = 'setup_forming'; summary = 'Resting near EMA20. Waiting for a bullish close with RSI turning up.' }
    const entry = close
    const zone: [number, number] = [Math.min(close, ema20), Math.max(close, ema20 * 1.01)]
    return finish(this.id, this.version, set, params, checks, state, entry, zone, stop, ema20, summary)
  },
}

export const STRATEGIES: Strategy[] = [swingBreakout, trendPullback]

/* ── Position sizing & costs ────────────────────────────────────── */

export interface SizingInput {
  capital: number
  riskPct: number
  entry: number
  stop: number
  /** Cap a single position at this % of capital. */
  maxPositionPct: number
  /** Estimated round-trip charges + slippage as % of traded value. */
  roundTripCostPct: number
}

export interface Sizing {
  shares: number
  /** Theoretical loss if stopped out at the stop price, excluding costs and gaps. */
  plannedRisk: number
  riskBudget: number
  capitalNeeded: number
  estCosts: number
  limitedBy: 'risk' | 'capital' | 'invalid'
}

/** shares = floor(risk budget / risk per share), capped by position size and capital. */
export function sizePosition(i: SizingInput): Sizing {
  const riskPerShare = i.entry - i.stop
  const riskBudget = (i.capital * i.riskPct) / 100
  if (!(riskPerShare > 0) || !(i.entry > 0)) return { shares: 0, plannedRisk: 0, riskBudget, capitalNeeded: 0, estCosts: 0, limitedBy: 'invalid' }
  const byRisk = Math.floor(riskBudget / riskPerShare)
  const byCapital = Math.floor((i.capital * i.maxPositionPct) / 100 / i.entry)
  const shares = Math.max(0, Math.min(byRisk, byCapital))
  const capitalNeeded = shares * i.entry
  return {
    shares, riskBudget, plannedRisk: shares * riskPerShare, capitalNeeded,
    estCosts: capitalNeeded * (i.roundTripCostPct / 100), limitedBy: byCapital < byRisk ? 'capital' : 'risk',
  }
}
