# 4. Scanner and strategies

Source: `src/domain/scanner.ts`, `presets.ts`, `trade.ts`, `indicators.ts`. All deterministic and independent of React and providers.

## 4.1 Scanner config

Zod-validated (`scannerSchema`), stored as JSON, importable and exportable.

| Field | Meaning |
|---|---|
| `id` | `preset:<name>` for built-ins, `user:<uid>` for user scanners |
| `name`, `description` | Free text; name required |
| `timeframe` | `1D` or `15m`. Only `1D` can run today. |
| `universe` | `minPrice`, `maxPrice`, `minAvgTradedValueCr` (20-bar average, Rs crore), `sectors[]`; each nullable or empty to disable |
| `root` | Group tree (below) |
| `ranking` | Weights `trend`, `relStrength`, `volume`, `momentum` |
| `version` | Integer from 1. Editing a user scanner increments it; results record the version they ran. |
| `requires` | `intraday`, `fundamentals` or null. A non-null value blocks running and shows why. |

## 4.2 Rule tree

A **group** is `ALL` or `ANY` over children, each a rule or a nested group; any node can be disabled (ignored). An empty group passes. A **rule** is `left operator right` where the left is always a field and the right is a field or a number.

**Operators**: is above, is at least, is below, is at most, crosses above, crosses below, is within % of (needs a tolerance and a field on the right).

Evaluation is on the **latest bar**. Crossing compares the previous bar too. If any input is unavailable (not enough history) the rule is `missing` and **does not pass**; the result carries a warning.

**Typed validation** (`validateRule`) blocks saving when: a field is unknown; a parameter is out of range; the left is a number; two fields have different units (price vs volume vs percent vs oscillator vs ratio vs money vs MACD); an intraday-only field is used on `1D`; `withinPct` lacks a tolerance or a field on the right.

## 4.3 Fields (23)

| Group | Fields (parameters) |
|---|---|
| Price and volume | close, open, high, low, volume, traded value, avg traded value (period 20), % change over N bars (1), gap % vs prior close, relative volume (20) |
| Trend | SMA (50), EMA (20), VWAP (session; intraday only) |
| Momentum | RSI (14), MACD line, MACD signal, MACD histogram |
| Volatility | ATR (14), ATR % of close (14) |
| Lookback | highest high of prior N bars (20), lowest low of prior N bars (20), prior close |
| Relative | return vs benchmark in percentage points (63) |

Series are memoised per field and parameters within one evaluation. Indicators: SMA, EMA, RSI, MACD (12, 26, 9), ATR, VWAP, relative volume, prior-window highest and lowest, percent return.

## 4.4 Built-in presets (all `1D`, version 1)

| Preset | Logic (all conditions unless noted) | Min price / min avg traded value |
|---|---|---|
| Breakout hunter | close above 20-day prior high; rel. volume at least 1.5; close above SMA50; SMA50 above SMA200 | Rs 50 / Rs 5 Cr |
| Trend pullback | SMA50 above SMA200; close above SMA50; close within 2.5% of EMA20; (RSI crosses above 40 **or** MACD histogram above 0); RSI below 65 | Rs 50 / Rs 5 Cr |
| Momentum leaders | return vs benchmark at least 8 pp over 63 bars; close above SMA50; RSI at least 55; MACD histogram above 0; rel. volume at least 0.8 | Rs 50 / Rs 5 Cr |
| Reversal candidates | close below SMA50; RSI crosses above 35; close above prior close; rel. volume at least 1.1 | Rs 50 / Rs 5 Cr |
| Positional trend | close above SMA50; SMA50 above SMA200; EMA20 above SMA50; rel. strength at least 0; ATR % at most 3.5 | Rs 50 / Rs 10 Cr |
| Intraday VWAP momentum | **Blocked** (`15m`, needs intraday): close above VWAP; rel. volume at least 1.3; RSI at least 55 | |
| Quality at a reasonable price | **Blocked** (needs fundamentals); empty rule tree | |

Presets keep stable ids and are never edited. **Duplicate** deep-copies a preset or user scanner into `user:<uid>` with fresh node ids and version 1. A blank scanner starts with one default rule (`close above SMA50`) and equal ranking weights.

## 4.5 Universe filters and results

Filters run before rules; the first that fails sets `excludedBy` (price below or above, sector not selected, or liquidity below minimum or unknown). A stock with fewer than 2 bars is skipped. Each `ScanResult` holds symbol, name, sector, close, day change, `matched`, `excludedBy`, `score`, `factors`, the evaluated `tree`, `warnings`, `asOf`. Warnings: missing history, latest candle still forming, no benchmark.

Results sort matched first, then score descending. A `ScanRun` records scanner id, name and version, time, universe label, universe size, data source, and `matchesOnly`. The lazy runner processes 120 stocks per chunk, reports progress, supports cancellation (not yet wired to a UI control), and keeps non-matches only for small universes.

## 4.6 Ranking (setup-quality score, 0 to 100, **not a probability**)

Four factors, each 0 to 100 with a one-line explanation, combined by the scanner's weights. Factors without data (and zero-weight factors) are excluded from the weighted mean; if none are usable the score is null.

| Factor | Computation |
|---|---|
| Trend alignment | Points: close above SMA50 (25), SMA50 above SMA200 (25), close above SMA200 (15), SMA20 above SMA50 (20), SMA50 rising vs 10 bars ago (15). Needs 200 bars. |
| Relative strength | Return vs benchmark over 63 bars, scaled so -10 pp maps to 0 and +30 pp to 100. Needs a benchmark. |
| Volume confirmation | Relative volume (20), scaled so 0.5x maps to 0 and 3x to 100. |
| Momentum | 60% from RSI(14) scaled 40 to 70, plus 40% if the MACD histogram is positive. |

The benchmark is aligned to the stock's own bar dates, carrying the last value across gaps.

## 4.7 Strategies and trade plans

Two strategies, both `1D`, version 1, minimum 210 bars (otherwise state `data_insufficient`). `evaluate` returns a `TradePlan`.

**Signal states**: `watching`, `setup_forming`, `entry_eligible`, `missed_entry`, `data_insufficient`. These are **snapshots** of the latest bar; no state is persisted and target-hit, stop-hit and expired are not tracked.

| | Swing breakout | Trend pullback |
|---|---|---|
| Idea | Close above prior 20-day high on volume inside an uptrend | Uptrend, pullback to EMA20, bullish bar |
| Holding / validity | 5 to 20 trading days / 3 bars | 3 to 10 trading days / 2 bars |
| Entry zone | Broken level to level + 1 ATR | Between close and EMA20 (to EMA20 x 1.01) |
| Stop | Level minus 1 ATR | Lowest low of the last 5 bars minus 0.25 ATR |
| Eligible when | Uptrend (close above SMA50 above SMA200), close above level, relative volume at least 1.5, not more than 1 ATR above level | SMA50 above SMA200 and close above SMA50, within 2.5% of EMA20, close above open and prior close, RSI at least 40 and rising |
| Forming when | Broke out without volume, or within 3% of the level in an uptrend | Uptrend and near EMA20 but no confirmation |
| Missed entry | Uptrend and broke out but more than 1 ATR above the level | n/a |
| Weighted checks | Uptrend 2, breakout 3, volume 2, not extended 1 | Uptrend 3, prior push 1, pulled back 2, bullish bar 2, RSI 1 |

Plan score is the share of weighted checks met (0 to 100). Targets are `entry + risk x multiple` for the configured reward/risk multiples (default 2 and 3); `rewardRisk` reports the first. `validUntil` advances the entry bar by `validBars` trading days, skipping weekends but **not exchange holidays**. A plan is `provisional` while the last candle is still forming. Each plan lists its checks with details, so every state is explainable.

## 4.8 Position sizing

`sizePosition` from capital, risk %, entry, stop, max position % and round-trip cost %:

- risk budget = capital x risk %
- by risk = floor(risk budget / (entry - stop))
- by capital = floor(capital x max position % / entry)
- shares = max(0, min(by risk, by capital)); `limitedBy` reports `risk`, `capital`, or `invalid` (stop not below entry)
- also returns planned risk (excludes costs and gaps), capital needed, and estimated costs

Defaults come from Settings: capital Rs 5,00,000, risk 1%, max position 25%, costs 0.3%, targets 2R and 3R.
