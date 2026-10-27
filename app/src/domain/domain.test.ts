import { describe, expect, it } from 'vitest'
import { atr, ema, highestPrior, macd, relVolume, rsi, sma } from './indicators'
import { newGroup, newRule, fieldOperand as f, valueOperand as val, makeContext, evalNode, validateRule, runScanner, type GroupResult } from './scanner'
import { PRESETS } from './presets'
import { sizePosition, swingBreakout, buildTargets } from './trade'
import { demoProvider } from '../providers/demo'
import { BENCHMARK } from '../providers/universe'
import type { Candle, CandleSet } from './types'

const mk = (closes: number[], vol = 1000): Candle[] =>
  closes.map((c, i) => ({ t: Date.UTC(2025, 0, 1 + i), o: c, h: c + 1, l: c - 1, c, v: vol, closed: true }))
const inst = { id: 'NSE:T', exchange: 'NSE' as const, symbol: 'T', name: 'T', sector: 'X', kind: 'equity' as const }
const set = (candles: Candle[]): CandleSet => ({ instrument: inst, timeframe: '1D', candles, source: 'demo', asOf: 0 })

describe('indicators', () => {
  it('SMA has period-1 warm-up nulls then correct averages', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4])
  })
  it('EMA seeds with SMA', () => {
    const e = ema([1, 2, 3, 4, 5], 3)
    expect(e.slice(0, 2)).toEqual([null, null])
    expect(e[2]).toBe(2)
    expect(e[3]).toBeCloseTo(3, 10) // k=0.5: 4*0.5+2*0.5
  })
  it('RSI is 100 for a monotonic rise and 0 for a monotonic fall', () => {
    const up = Array.from({ length: 30 }, (_, i) => 100 + i)
    expect(rsi(up, 14)[29]).toBe(100)
    expect(rsi(up.slice().reverse(), 14)[29]).toBe(0)
    expect(rsi(up, 14)[13]).toBeNull()
  })
  it('RSI matches the Wilder reference value', () => {
    // Classic Wilder worked example (first RSI ≈ 70.46)
    const c = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28]
    expect(rsi(c, 14)[14]).toBeCloseTo(70.46, 1)
  })
  it('ATR of constant 2-point range is 2', () => {
    const a = atr(mk(Array.from({ length: 30 }, () => 100)), 14)
    expect(a[14]).toBeCloseTo(2, 10)
    expect(a[13]).toBeNull()
  })
  it('MACD histogram = macd - signal', () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 5) * 5 + i * 0.1)
    const m = macd(closes)
    const i = 79
    expect(m.hist[i]).toBeCloseTo((m.macd[i] as number) - (m.signal[i] as number), 10)
    expect(m.macd[24]).toBeNull()
    expect(m.macd[25]).not.toBeNull()
  })
  it('highestPrior excludes the current bar', () => {
    expect(highestPrior([1, 5, 3, 9], 2)).toEqual([null, null, 5, 5])
  })
  it('relVolume excludes the current bar from the baseline', () => {
    const c = mk([1, 1, 1, 1], 100)
    c[3].v = 300
    expect(relVolume(c, 3)[3]).toBe(3)
  })
})

describe('rule engine', () => {
  const cs = mk([10, 11, 12, 13, 14, 15])
  const ctx = makeContext(set(cs), null)

  it('evaluates nested ALL/ANY groups', () => {
    const tree = newGroup('ALL', [
      newRule({ left: f('close'), op: 'above', right: val(14) }),
      newGroup('ANY', [newRule({ left: f('close'), op: 'below', right: val(5) }), newRule({ left: f('close'), op: 'atLeast', right: val(15) })]),
    ])
    expect((evalNode(ctx, tree) as GroupResult).pass).toBe(true)
  })
  it('missing data never passes', () => {
    const r = evalNode(ctx, newGroup('ALL', [newRule({ left: f('sma', { period: 200 }), op: 'above', right: val(0) })])) as GroupResult
    expect(r.pass).toBe(false)
    expect(r.children[0]).toMatchObject({ missing: true, pass: false })
  })
  it('detects crosses on the latest bar only', () => {
    const c = makeContext(set(mk([5, 5, 5, 9])), null)
    const up = newRule({ left: f('close'), op: 'crossesAbove', right: val(6) })
    expect((evalNode(c, newGroup('ALL', [up])) as GroupResult).pass).toBe(true)
    const c2 = makeContext(set(mk([5, 9, 9, 9])), null)
    expect((evalNode(c2, newGroup('ALL', [up])) as GroupResult).pass).toBe(false)
  })
  it('ignores disabled conditions', () => {
    const t = newGroup('ALL', [newRule({ enabled: false, left: f('close'), op: 'below', right: val(0) })])
    expect((evalNode(ctx, t) as GroupResult).pass).toBe(true)
  })
  it('rejects incompatible comparisons', () => {
    expect(validateRule(newRule({ left: f('close'), op: 'above', right: f('rsi') }), '1D')).toMatch(/Cannot compare/)
    expect(validateRule(newRule({ left: f('close'), op: 'above', right: f('sma', { period: 20 }) }), '1D')).toBeNull()
    expect(validateRule(newRule({ left: f('vwap'), op: 'above', right: val(1) }), '1D')).toMatch(/intraday/)
    expect(validateRule(newRule({ left: f('sma', { period: 1 }), op: 'above', right: val(1) }), '1D')).toMatch(/Period/)
  })
})

describe('trade plan maths', () => {
  it('targets are entry + risk × multiple', () => {
    expect(buildTargets(100, 95, [2, 3])).toEqual([{ rr: 2, price: 110 }, { rr: 3, price: 115 }])
  })
  it('sizes by risk budget, floored, and caps by capital', () => {
    const base = { capital: 500_000, riskPct: 1, entry: 100, stop: 95, maxPositionPct: 100, roundTripCostPct: 0.3 }
    const a = sizePosition(base)
    expect(a).toMatchObject({ shares: 1000, plannedRisk: 5000, limitedBy: 'risk' })
    const b = sizePosition({ ...base, maxPositionPct: 10 })
    expect(b).toMatchObject({ shares: 500, limitedBy: 'capital' })
    expect(sizePosition({ ...base, stop: 100 }).limitedBy).toBe('invalid')
  })
})

describe('demo data + presets', () => {
  it('is deterministic and flagged as not live', async () => {
    expect(demoProvider.isLive).toBe(false)
    const [i] = await demoProvider.getInstruments()
    const a = await demoProvider.getHistoricalCandles(i, '1D', 300)
    const b = await demoProvider.getHistoricalCandles(i, '1D', 300)
    expect(a.candles).toEqual(b.candles)
    expect(a.candles.every(c => c.h >= Math.max(c.o, c.c) && c.l <= Math.min(c.o, c.c) && c.l > 0)).toBe(true)
  })
  it('presets are valid and produce matches across the demo universe', async () => {
    const insts = await demoProvider.getInstruments()
    const sets = await Promise.all(insts.map(i => demoProvider.getHistoricalCandles(i, '1D', 400)))
    const bench = await demoProvider.getHistoricalCandles(BENCHMARK, '1D', 400)
    const counts: Record<string, number> = {}
    for (const p of PRESETS.filter(p => !p.requires)) {
      const run = runScanner(p, sets, bench)
      counts[p.name] = run.results.filter(r => r.matched).length
    }
    console.log(counts)
    expect(Object.values(counts).some(n => n > 0)).toBe(true)
    const plans = sets.map(s => swingBreakout.evaluate(s))
    expect(plans.some(p => p.state === 'entry_eligible')).toBe(true)
    for (const p of plans.filter(p => p.state === 'entry_eligible')) expect(p.stop).toBeLessThan(p.entry)
  })
})
