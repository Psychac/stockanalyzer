import { z } from 'zod'
import type { Candle, CandleSet, Series, Timeframe } from './types'
import * as ind from './indicators'
import { istDate } from './time'

/* ───────────────────────── Field registry ───────────────────────── */

export type Unit = 'price' | 'volume' | 'percent' | 'oscillator' | 'ratio' | 'money' | 'macd'

export interface ParamDef { name: string; label: string; default: number; min: number; max: number }

export interface FieldDef {
  key: string
  label: string
  group: 'Price & volume' | 'Trend' | 'Momentum' | 'Volatility' | 'Lookback' | 'Relative'
  unit: Unit
  params: ParamDef[]
  /** Only valid on intraday timeframes. */
  intradayOnly?: boolean
  compute: (ctx: EvalContext, p: Record<string, number>) => Series
}

const period = (def: number, min = 2, max = 400): ParamDef => ({ name: 'period', label: 'Period', default: def, min, max })

export const FIELDS: FieldDef[] = [
  { key: 'close', label: 'Close', group: 'Price & volume', unit: 'price', params: [], compute: c => c.closes },
  { key: 'open', label: 'Open', group: 'Price & volume', unit: 'price', params: [], compute: c => c.candles.map(x => x.o) },
  { key: 'high', label: 'High', group: 'Price & volume', unit: 'price', params: [], compute: c => c.candles.map(x => x.h) },
  { key: 'low', label: 'Low', group: 'Price & volume', unit: 'price', params: [], compute: c => c.candles.map(x => x.l) },
  { key: 'volume', label: 'Volume', group: 'Price & volume', unit: 'volume', params: [], compute: c => c.candles.map(x => x.v) },
  { key: 'tradedValue', label: 'Traded value (₹)', group: 'Price & volume', unit: 'money', params: [], compute: c => c.candles.map(x => x.c * x.v) },
  { key: 'avgTradedValue', label: 'Avg traded value (₹)', group: 'Price & volume', unit: 'money', params: [period(20)], compute: (c, p) => ind.sma(c.candles.map(x => x.c * x.v), p.period) },
  { key: 'pctChange', label: '% change over N bars', group: 'Price & volume', unit: 'percent', params: [period(1, 1)], compute: (c, p) => ind.pctReturn(c.closes, p.period) },
  { key: 'gap', label: 'Gap % vs prior close', group: 'Price & volume', unit: 'percent', params: [], compute: c => c.candles.map((x, i) => (i > 0 ? (x.o / c.candles[i - 1].c - 1) * 100 : null)) },
  { key: 'relVolume', label: 'Relative volume', group: 'Price & volume', unit: 'ratio', params: [period(20)], compute: (c, p) => ind.relVolume(c.candles, p.period) },
  { key: 'sma', label: 'SMA', group: 'Trend', unit: 'price', params: [period(50)], compute: (c, p) => ind.sma(c.closes, p.period) },
  { key: 'ema', label: 'EMA', group: 'Trend', unit: 'price', params: [period(20)], compute: (c, p) => ind.ema(c.closes, p.period) },
  { key: 'vwap', label: 'VWAP (session)', group: 'Trend', unit: 'price', params: [], intradayOnly: true, compute: c => ind.vwap(c.candles) },
  { key: 'rsi', label: 'RSI', group: 'Momentum', unit: 'oscillator', params: [period(14)], compute: (c, p) => ind.rsi(c.closes, p.period) },
  { key: 'macd', label: 'MACD line', group: 'Momentum', unit: 'macd', params: [], compute: c => ind.macd(c.closes).macd },
  { key: 'macdSignal', label: 'MACD signal', group: 'Momentum', unit: 'macd', params: [], compute: c => ind.macd(c.closes).signal },
  { key: 'macdHist', label: 'MACD histogram', group: 'Momentum', unit: 'macd', params: [], compute: c => ind.macd(c.closes).hist },
  { key: 'atr', label: 'ATR', group: 'Volatility', unit: 'price', params: [period(14)], compute: (c, p) => ind.atr(c.candles, p.period) },
  { key: 'atrPct', label: 'ATR % of close', group: 'Volatility', unit: 'percent', params: [period(14)], compute: (c, p) => ind.atr(c.candles, p.period).map((a, i) => (a !== null ? (a / c.closes[i]) * 100 : null)) },
  { key: 'highest', label: 'Highest high (prior N bars)', group: 'Lookback', unit: 'price', params: [period(20)], compute: (c, p) => ind.highestPrior(c.candles.map(x => x.h), p.period) },
  { key: 'lowest', label: 'Lowest low (prior N bars)', group: 'Lookback', unit: 'price', params: [period(20)], compute: (c, p) => ind.lowestPrior(c.candles.map(x => x.l), p.period) },
  { key: 'prevClose', label: 'Prior close', group: 'Lookback', unit: 'price', params: [], compute: c => c.closes.map((_, i) => (i > 0 ? c.closes[i - 1] : null)) },
  {
    key: 'relStrength', label: 'Return vs benchmark (pp)', group: 'Relative', unit: 'percent', params: [period(63, 5)],
    // benchmarkCloses is already aligned to this stock's candles by date (see makeContext).
    compute: (c, p) => {
      if (!c.benchmarkCloses) return c.closes.map(() => null)
      const own = ind.pctReturn(c.closes, p.period)
      const bench = ind.pctReturn(c.benchmarkCloses, p.period)
      return own.map((v, i) => (v !== null && bench[i] !== null ? v - (bench[i] as number) : null))
    },
  },
]

export const FIELD_MAP: Record<string, FieldDef> = Object.fromEntries(FIELDS.map(f => [f.key, f]))

/* ───────────────────────── Rule model ───────────────────────── */

export const OPERATORS = [
  { key: 'above', label: 'is above' },
  { key: 'atLeast', label: 'is at least' },
  { key: 'below', label: 'is below' },
  { key: 'atMost', label: 'is at most' },
  { key: 'crossesAbove', label: 'crosses above' },
  { key: 'crossesBelow', label: 'crosses below' },
  { key: 'withinPct', label: 'is within % of' },
] as const
export type OperatorKey = (typeof OPERATORS)[number]['key']

const operandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('field'), field: z.string(), params: z.record(z.string(), z.number()).default({}) }),
  z.object({ kind: z.literal('value'), value: z.number() }),
])
export type Operand = z.infer<typeof operandSchema>

export const ruleSchema = z.object({
  type: z.literal('rule'),
  id: z.string(),
  enabled: z.boolean().default(true),
  left: operandSchema,
  op: z.enum(['above', 'atLeast', 'below', 'atMost', 'crossesAbove', 'crossesBelow', 'withinPct']),
  right: operandSchema,
  /** Tolerance for `withinPct`. */
  pct: z.number().optional(),
})
export type Rule = z.infer<typeof ruleSchema>

export interface Group { type: 'group'; id: string; enabled: boolean; mode: 'ALL' | 'ANY'; children: Node[] }
export type Node = Rule | Group

export const groupSchema: z.ZodType<Group> = z.lazy(() =>
  z.object({
    type: z.literal('group'),
    id: z.string(),
    enabled: z.boolean().default(true),
    mode: z.enum(['ALL', 'ANY']),
    children: z.array(z.union([ruleSchema, groupSchema])),
  }),
) as z.ZodType<Group>

export const scannerSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string().default(''),
  timeframe: z.enum(['1D', '15m']),
  universe: z.object({
    minPrice: z.number().nullable(),
    maxPrice: z.number().nullable(),
    /** Minimum 20-bar average traded value in ₹ crore. */
    minAvgTradedValueCr: z.number().nullable(),
    sectors: z.array(z.string()),
  }),
  root: groupSchema,
  ranking: z.object({ trend: z.number(), relStrength: z.number(), volume: z.number(), momentum: z.number() }),
  version: z.number().int().min(1),
  /** Presets that need data the app does not have yet. */
  requires: z.enum(['intraday', 'fundamentals']).nullable().default(null),
})
export type ScannerConfig = z.infer<typeof scannerSchema>

let counter = 0
export const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

export const fieldOperand = (field: string, params: Record<string, number> = {}): Operand => ({ kind: 'field', field, params })
export const valueOperand = (value: number): Operand => ({ kind: 'value', value })

export function newRule(partial: Partial<Rule> = {}): Rule {
  return { type: 'rule', id: uid(), enabled: true, left: fieldOperand('close'), op: 'above', right: fieldOperand('sma', { period: 50 }), ...partial }
}
export function newGroup(mode: 'ALL' | 'ANY' = 'ALL', children: Node[] = []): Group {
  return { type: 'group', id: uid(), enabled: true, mode, children }
}

/** Typed validation: operands must be comparable. Returns an error message or null. */
export function validateRule(rule: Rule, tf: Timeframe): string | null {
  for (const side of [rule.left, rule.right]) {
    if (side.kind === 'field') {
      const def = FIELD_MAP[side.field]
      if (!def) return `Unknown field "${side.field}"`
      if (def.intradayOnly && tf === '1D') return `${def.label} needs an intraday timeframe`
      for (const p of def.params) {
        const v = side.params[p.name] ?? p.default
        if (!Number.isFinite(v) || v < p.min || v > p.max) return `${def.label}: ${p.label} must be ${p.min}–${p.max}`
      }
    } else if (!Number.isFinite(side.value)) return 'Enter a number'
  }
  if (rule.left.kind === 'value') return 'Left side must be a field'
  if (rule.right.kind === 'field') {
    const l = FIELD_MAP[rule.left.field]
    const r = FIELD_MAP[rule.right.field]
    if (l && r && l.unit !== r.unit) return `Cannot compare ${l.unit} (${l.label}) with ${r.unit} (${r.label})`
  }
  if (rule.op === 'withinPct' && !(rule.pct !== undefined && rule.pct >= 0)) return 'Set a tolerance %'
  if (rule.op === 'withinPct' && rule.right.kind === 'value') return '"Within %" needs a field on the right'
  return null
}

export function validateTree(node: Node, tf: Timeframe): string | null {
  if (!node.enabled) return null
  if (node.type === 'rule') return validateRule(node, tf)
  for (const c of node.children) { const e = validateTree(c, tf); if (e) return e }
  return null
}

/* ───────────────────────── Evaluation ───────────────────────── */

export interface EvalContext {
  candles: Candle[]
  closes: number[]
  benchmarkCloses: number[] | null
  timeframe: Timeframe
  cache: Map<string, Series>
}

/** Benchmark closes sampled on each of the stock's own bar dates, carrying the last value over any gap. */
function alignToDates(own: Candle[], bench: Candle[]): number[] {
  const byDate = new Map(bench.map(c => [istDate(c.t), c.c]))
  let prev = bench[0]?.c ?? 0
  return own.map(c => { prev = byDate.get(istDate(c.t)) ?? prev; return prev })
}

export function makeContext(set: CandleSet, benchmark: CandleSet | null): EvalContext {
  return {
    candles: set.candles,
    closes: set.candles.map(c => c.c),
    benchmarkCloses: benchmark ? alignToDates(set.candles, benchmark.candles) : null,
    timeframe: set.timeframe,
    cache: new Map(),
  }
}

export function series(ctx: EvalContext, field: string, params: Record<string, number> = {}): Series {
  const def = FIELD_MAP[field]
  const full: Record<string, number> = {}
  for (const p of def.params) full[p.name] = params[p.name] ?? p.default
  const key = field + JSON.stringify(full)
  let s = ctx.cache.get(key)
  if (!s) { s = def.compute(ctx, full); ctx.cache.set(key, s) }
  return s
}

function operandSeries(ctx: EvalContext, o: Operand): { at: (i: number) => number | null } {
  if (o.kind === 'value') return { at: () => o.value }
  const s = series(ctx, o.field, o.params)
  return { at: i => (i >= 0 ? s[i] ?? null : null) }
}

export function operandLabel(o: Operand): string {
  if (o.kind === 'value') return fmtNum(o.value)
  const def = FIELD_MAP[o.field]
  if (!def) return o.field
  const ps = def.params.map(p => o.params[p.name] ?? p.default)
  return ps.length ? `${def.label.replace(/ \(.*\)| over N bars/, '')}(${ps.join(',')})` : def.label
}

export function ruleLabel(r: Rule): string {
  const op = OPERATORS.find(o => o.key === r.op)!.label
  const tol = r.op === 'withinPct' ? ` ${r.pct ?? 0}%` : ''
  return `${operandLabel(r.left)} ${op}${tol} ${operandLabel(r.right)}`
}

export const fmtNum = (n: number | null | undefined, digits = 2) =>
  n === null || n === undefined || !Number.isFinite(n)
    ? '—'
    : Math.abs(n) >= 1e7
      ? n.toExponential(2)
      : Number(n.toFixed(digits)).toLocaleString('en-IN', { maximumFractionDigits: digits })

export interface RuleResult {
  type: 'rule'; id: string; label: string; pass: boolean
  /** True when an input was unavailable (insufficient history). Missing never passes. */
  missing: boolean
  left: number | null; right: number | null
}
export interface GroupResult { type: 'group'; id: string; mode: 'ALL' | 'ANY'; pass: boolean; children: NodeResult[] }
export type NodeResult = RuleResult | GroupResult

export function evalRule(ctx: EvalContext, r: Rule): RuleResult {
  const i = ctx.candles.length - 1
  const L = operandSeries(ctx, r.left)
  const R = operandSeries(ctx, r.right)
  const l = L.at(i)
  const rr = R.at(i)
  const base = { type: 'rule' as const, id: r.id, label: ruleLabel(r), left: l, right: rr }
  const needsPrev = r.op === 'crossesAbove' || r.op === 'crossesBelow'
  const lp = needsPrev ? L.at(i - 1) : 0
  const rp = needsPrev ? R.at(i - 1) : 0
  if (l === null || rr === null || lp === null || rp === null) return { ...base, pass: false, missing: true }
  let pass = false
  switch (r.op) {
    case 'above': pass = l > rr; break
    case 'atLeast': pass = l >= rr; break
    case 'below': pass = l < rr; break
    case 'atMost': pass = l <= rr; break
    case 'crossesAbove': pass = lp <= rp && l > rr; break
    case 'crossesBelow': pass = lp >= rp && l < rr; break
    case 'withinPct': pass = rr !== 0 && (Math.abs(l - rr) / Math.abs(rr)) * 100 <= (r.pct ?? 0); break
  }
  return { ...base, pass, missing: false }
}

export function evalNode(ctx: EvalContext, n: Node): NodeResult | null {
  if (!n.enabled) return null
  if (n.type === 'rule') return evalRule(ctx, n)
  const children = n.children.map(c => evalNode(ctx, c)).filter((x): x is NodeResult => x !== null)
  const pass = children.length === 0 ? true : n.mode === 'ALL' ? children.every(c => c.pass) : children.some(c => c.pass)
  return { type: 'group', id: n.id, mode: n.mode, pass, children }
}

export function collectRules(n: NodeResult): RuleResult[] {
  return n.type === 'rule' ? [n] : n.children.flatMap(collectRules)
}

/* ───────────────────────── Ranking ───────────────────────── */

export interface Factor { key: 'trend' | 'relStrength' | 'volume' | 'momentum'; label: string; score: number | null; weight: number; note: string }

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const last = (s: Series) => s[s.length - 1] ?? null

/** Each factor is 0–100 and fully explained. This is a setup-quality score, not a probability. */
export function rankFactors(ctx: EvalContext, weights: ScannerConfig['ranking']): Factor[] {
  const i = ctx.closes.length - 1
  const close = ctx.closes[i]
  const s20 = last(series(ctx, 'sma', { period: 20 }))
  const s50s = series(ctx, 'sma', { period: 50 })
  const s50 = last(s50s)
  const s200 = last(series(ctx, 'sma', { period: 200 }))

  let trend: number | null = null
  let trendNote = 'Needs 200 bars of history'
  if (s20 !== null && s50 !== null && s200 !== null) {
    const prev50 = s50s[i - 10]
    const pts = [close > s50 ? 25 : 0, s50 > s200 ? 25 : 0, close > s200 ? 15 : 0, s20 > s50 ? 20 : 0, prev50 != null && s50 > prev50 ? 15 : 0]
    trend = pts.reduce((a, b) => a + b, 0)
    trendNote = `${close > s50 ? '✓' : '✗'} close>SMA50 · ${s50 > s200 ? '✓' : '✗'} SMA50>SMA200 · ${s20 > s50 ? '✓' : '✗'} SMA20>SMA50`
  }

  const rs = last(series(ctx, 'relStrength', { period: 63 }))
  const relStrength = rs === null ? null : clamp01((rs + 10) / 40) * 100
  const rsNote = rs === null ? 'Needs 63 bars + benchmark' : `${rs >= 0 ? '+' : ''}${rs.toFixed(1)}pp vs benchmark over 63 bars`

  const rv = last(series(ctx, 'relVolume', { period: 20 }))
  const volume = rv === null ? null : clamp01((rv - 0.5) / 2.5) * 100
  const rsi = last(series(ctx, 'rsi', { period: 14 }))
  const hist = last(series(ctx, 'macdHist'))
  const momentum = rsi === null ? null : (clamp01((rsi - 40) / 30) * 0.6 + (hist !== null && hist > 0 ? 0.4 : 0)) * 100

  return [
    { key: 'trend', label: 'Trend alignment', score: trend, weight: weights.trend, note: trendNote },
    { key: 'relStrength', label: 'Relative strength', score: relStrength, weight: weights.relStrength, note: rsNote },
    { key: 'volume', label: 'Volume confirmation', score: volume, weight: weights.volume, note: rv === null ? 'No volume baseline' : `Volume ${rv.toFixed(2)}× 20-bar average` },
    { key: 'momentum', label: 'Momentum', score: momentum, weight: weights.momentum, note: rsi === null ? 'Needs 15 bars' : `RSI ${rsi.toFixed(0)} · MACD hist ${hist !== null && hist > 0 ? 'positive' : 'not positive'}` },
  ]
}

export function combineScore(factors: Factor[]): number | null {
  const usable = factors.filter(f => f.score !== null && f.weight > 0)
  const w = usable.reduce((a, f) => a + f.weight, 0)
  if (w === 0) return null
  return usable.reduce((a, f) => a + (f.score as number) * f.weight, 0) / w
}

/* ───────────────────────── Running a scan ───────────────────────── */

export interface ScanResult {
  instrumentId: string
  symbol: string
  name: string
  sector: string
  close: number
  changePct: number
  matched: boolean
  excludedBy: string | null
  score: number | null
  factors: Factor[]
  tree: GroupResult | null
  warnings: string[]
  asOf: number
}

export interface ScanRun {
  scannerId: string
  scannerName: string
  scannerVersion: number
  ranAt: number
  universeSize: number
  source: CandleSet['source']
  results: ScanResult[]
}

export function runScanner(config: ScannerConfig, universe: CandleSet[], benchmark: CandleSet | null): ScanRun {
  const results: ScanResult[] = []
  for (const set of universe) {
    const inst = set.instrument
    const n = set.candles.length
    if (n < 2) continue
    const ctx = makeContext(set, benchmark)
    const close = ctx.closes[n - 1]
    const base = {
      instrumentId: inst.id, symbol: inst.symbol, name: inst.name, sector: inst.sector, close,
      changePct: (close / ctx.closes[n - 2] - 1) * 100, asOf: set.asOf,
    }
    const u = config.universe
    const avgTv = last(series(ctx, 'avgTradedValue', { period: 20 }))
    let excludedBy: string | null = null
    if (u.minPrice !== null && close < u.minPrice) excludedBy = `Price below ₹${u.minPrice}`
    else if (u.maxPrice !== null && close > u.maxPrice) excludedBy = `Price above ₹${u.maxPrice}`
    else if (u.sectors.length && !u.sectors.includes(inst.sector)) excludedBy = `Sector ${inst.sector} not selected`
    else if (u.minAvgTradedValueCr !== null && (avgTv === null || avgTv / 1e7 < u.minAvgTradedValueCr)) {
      excludedBy = avgTv === null ? 'Liquidity unknown' : `Avg traded value ₹${(avgTv / 1e7).toFixed(1)} Cr below minimum`
    }
    if (excludedBy) { results.push({ ...base, matched: false, excludedBy, score: null, factors: [], tree: null, warnings: [] }); continue }

    const tree = evalNode(ctx, config.root) as GroupResult
    const factors = rankFactors(ctx, config.ranking)
    const warnings: string[] = []
    if (collectRules(tree).some(r => r.missing)) warnings.push('Some conditions lacked enough history and were treated as not met')
    if (!set.candles[n - 1].closed) warnings.push('Latest candle is still forming')
    if (!benchmark) warnings.push('No benchmark data: relative strength unavailable')
    results.push({ ...base, matched: tree.pass, excludedBy: null, score: combineScore(factors), factors, tree, warnings })
  }
  results.sort((a, b) => Number(b.matched) - Number(a.matched) || (b.score ?? -1) - (a.score ?? -1))
  return {
    scannerId: config.id, scannerName: config.name, scannerVersion: config.version, ranAt: Date.now(),
    universeSize: universe.length, source: universe[0]?.source ?? 'demo', results,
  }
}
