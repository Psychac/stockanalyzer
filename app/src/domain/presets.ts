import { fieldOperand as f, newGroup, newRule, valueOperand as v, type Node, type ScannerConfig } from './scanner'

const universe = { minPrice: 50, maxPrice: null, minAvgTradedValueCr: 5, sectors: [] as string[] }
const W = { trend: 3, relStrength: 2, volume: 2, momentum: 1 }

const r = (partial: Parameters<typeof newRule>[0]) => newRule(partial)
const root = (children: Node[]) => newGroup('ALL', children)

/** Stable IDs so presets can be referenced; user copies get fresh IDs. */
export const PRESETS: ScannerConfig[] = [
  {
    id: 'preset:breakout', name: 'Breakout hunter', version: 1, timeframe: '1D', universe, ranking: { trend: 2, relStrength: 2, volume: 3, momentum: 1 }, requires: null,
    description: 'Close above the prior 20-day high on strong volume, inside an established uptrend.',
    root: root([
      r({ left: f('close'), op: 'above', right: f('highest', { period: 20 }) }),
      r({ left: f('relVolume', { period: 20 }), op: 'atLeast', right: v(1.5) }),
      r({ left: f('close'), op: 'above', right: f('sma', { period: 50 }) }),
      r({ left: f('sma', { period: 50 }), op: 'above', right: f('sma', { period: 200 }) }),
    ]),
  },
  {
    id: 'preset:pullback', name: 'Trend pullback', version: 1, timeframe: '1D', universe, ranking: { trend: 3, relStrength: 1, volume: 1, momentum: 2 }, requires: null,
    description: 'Uptrend intact, price resting near the 20 EMA with momentum turning back up.',
    root: root([
      r({ left: f('sma', { period: 50 }), op: 'above', right: f('sma', { period: 200 }) }),
      r({ left: f('close'), op: 'above', right: f('sma', { period: 50 }) }),
      r({ left: f('close'), op: 'withinPct', pct: 2.5, right: f('ema', { period: 20 }) }),
      newGroup('ANY', [
        r({ left: f('rsi', { period: 14 }), op: 'crossesAbove', right: v(40) }),
        r({ left: f('macdHist'), op: 'above', right: v(0) }),
      ]),
      r({ left: f('rsi', { period: 14 }), op: 'below', right: v(65) }),
    ]),
  },
  {
    id: 'preset:momentum', name: 'Momentum leaders', version: 1, timeframe: '1D', universe, ranking: { trend: 2, relStrength: 4, volume: 1, momentum: 2 }, requires: null,
    description: 'Outperforming the benchmark over 3 months, positive trend and momentum.',
    root: root([
      r({ left: f('relStrength', { period: 63 }), op: 'atLeast', right: v(8) }),
      r({ left: f('close'), op: 'above', right: f('sma', { period: 50 }) }),
      r({ left: f('rsi', { period: 14 }), op: 'atLeast', right: v(55) }),
      r({ left: f('macdHist'), op: 'above', right: v(0) }),
      r({ left: f('relVolume', { period: 20 }), op: 'atLeast', right: v(0.8) }),
    ]),
  },
  {
    id: 'preset:reversal', name: 'Reversal candidates', version: 1, timeframe: '1D', universe, ranking: { trend: 1, relStrength: 1, volume: 2, momentum: 3 }, requires: null,
    description: 'Oversold, then a confirmed turn. Early and lower-conviction: treat as a watchlist, not a setup.',
    root: root([
      r({ left: f('close'), op: 'below', right: f('sma', { period: 50 }) }),
      r({ left: f('rsi', { period: 14 }), op: 'crossesAbove', right: v(35) }),
      r({ left: f('close'), op: 'above', right: f('prevClose') }),
      r({ left: f('relVolume', { period: 20 }), op: 'atLeast', right: v(1.1) }),
    ]),
  },
  {
    id: 'preset:positional', name: 'Positional trend', version: 1, timeframe: '1D', universe: { ...universe, minAvgTradedValueCr: 10 }, ranking: W, requires: null,
    description: 'Full moving-average alignment with controlled volatility and strong liquidity.',
    root: root([
      r({ left: f('close'), op: 'above', right: f('sma', { period: 50 }) }),
      r({ left: f('sma', { period: 50 }), op: 'above', right: f('sma', { period: 200 }) }),
      r({ left: f('ema', { period: 20 }), op: 'above', right: f('sma', { period: 50 }) }),
      r({ left: f('relStrength', { period: 63 }), op: 'atLeast', right: v(0) }),
      r({ left: f('atrPct', { period: 14 }), op: 'atMost', right: v(3.5) }),
    ]),
  },
  {
    id: 'preset:vwap', name: 'Intraday VWAP momentum', version: 1, timeframe: '15m', universe, ranking: W, requires: 'intraday',
    description: 'Reclaims or holds above session VWAP with volume. Needs intraday candles (Breeze milestone).',
    root: root([
      r({ left: f('close'), op: 'above', right: f('vwap') }),
      r({ left: f('relVolume', { period: 20 }), op: 'atLeast', right: v(1.3) }),
      r({ left: f('rsi', { period: 14 }), op: 'atLeast', right: v(55) }),
    ]),
  },
  {
    id: 'preset:quality', name: 'Quality at a reasonable price', version: 1, timeframe: '1D', universe, ranking: W, requires: 'fundamentals',
    description: 'Profitability, debt and valuation filters. Needs a fundamentals source and is not simulated from prices.',
    root: root([]),
  },
]

export const isPreset = (id: string) => id.startsWith('preset:')

export const REQUIRES_LABEL = { intraday: 'Needs intraday data', fundamentals: 'Needs fundamentals data' } as const

/** Deep-copy a config into a personal, editable scanner. */
export function duplicateScanner(src: ScannerConfig, name = `${src.name} (copy)`): ScannerConfig {
  const reId = (n: Node): Node => (n.type === 'rule' ? { ...JSON.parse(JSON.stringify(n)), id: newRule().id } : { ...n, id: newGroup().id, children: n.children.map(reId) })
  return {
    ...JSON.parse(JSON.stringify(src)), id: `user:${newGroup().id}`, name, version: 1,
    root: reId(src.root) as ScannerConfig['root'], requires: src.requires,
  }
}

export function blankScanner(): ScannerConfig {
  return {
    id: `user:${newGroup().id}`, name: 'My scanner', description: '', version: 1, timeframe: '1D', requires: null,
    universe: { minPrice: null, maxPrice: null, minAvgTradedValueCr: null, sectors: [] },
    ranking: { trend: 2, relStrength: 2, volume: 2, momentum: 2 },
    root: newGroup('ALL', [newRule()]),
  }
}
