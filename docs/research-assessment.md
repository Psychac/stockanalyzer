# Equity-research assessment of the app

Date: 2026-10-29. Commit reviewed: `6212473`. Role: institutional-grade equity research analyst.

Basis: judgment from the code and docs, not an empirical test. No signal has been backtested, and the app cannot backtest, which is the central finding. The standard is institutional, though the app is a one-user retail tool. See also [code-review.md](code-review.md) for engineering findings and [v2-proposal.md](v2-proposal.md) for the proposed redesign.

## Verdict

Fit for idea generation and trade planning by one disciplined retail trader. Not fit as evidence of an edge, and not fit for sizing or capacity beyond small retail. The mechanics are sound; nothing in the app tells you whether the signals make money.

## 1. Data and universe

| Aspect | Observation | Institutional concern |
|---|---|---|
| Source | Exchange bhavcopy end-of-day files for NSE and BSE, published after the close | Appropriate and auditable. No intraday scanning, so every signal is a next-day idea. |
| Coverage | About 2,400 liquid stocks per exchange; admitted at Rs 50 lakh daily turnover | Low floor for anything above retail size. A stock can pass on one active day. |
| Liquidity pruning | `prune` averages turnover only over days the stock traded | A thinly traded stock with a few heavy days survives. Liquidity is overstated. |
| Survivorship | History holds only stocks currently admitted; delisted, suspended and pruned names disappear | Fine for scanning today. Any future backtest on this data would be survivor-biased and overstated. |
| Series | NSE `EQ` and `BE` (trade-for-trade) and BSE small-cap and SME series are included with no flag | T2T stocks cannot be traded intraday and are often surveillance names, yet look like normal breakouts. |
| Adjustment | Splits and bonuses back-adjusted by previous-close ratio; dividends not adjusted | Price-return series. Fine for technicals, but relative strength against a price index ignores dividend yield differences. |
| Sector | Industry known for about a third of stocks; a sector filter silently drops the rest | Material coverage bias. |
| Dual listings | NSE listing preferred when ISIN matches | Sensible. |
| Provenance | Redistribution terms unreviewed; undocumented Upstox endpoints | Not defensible beyond personal use. |

## 2. Signal methodology

Good: standard, correct indicators (Wilder RSI, ATR, SMA, EMA, MACD); no lookahead (breakout levels use prior bars only); missing inputs fail instead of passing; every condition explained; presets are conventional trend, breakout, pullback and momentum screens.

Weaknesses:
1. **No evidence of edge.** No backtest, walk-forward test or outcome record. The score is a weighted checklist, not a probability, and the weights (3/2/2/1 and per-preset variants) are arbitrary.
2. **Arbitrary parameters.** 20-day breakout, 1.5x volume, 2.5% from EMA, 2R and 3R targets are untested and can be overfit as users tweak scanners. No out-of-sample guard or multiple-testing warning.
3. **Entry assumed at the close.** Real fills come at the next open or later, so gap-ups erode reward-to-risk. The "not extended" check only partly mitigates this.
4. **Targets are mechanical** (entry plus 2R or 3R), not tied to structure, prior highs or volatility regime.
5. **Relative strength** is one 63-day return against one broad index. No sector-relative measure, no multi-horizon view.
6. **Single timeframe.** Scans are daily only.
7. **Missing India-specific tradability filters:** circuit-limit detection (a stock locked at upper circuit on volume looks like a breakout but cannot be bought); surveillance flags (ASM, GSM), T2T status, F&O ban list; results and board-meeting dates; delivery percentage (present in the NSE file but dropped at ingest).
8. **No fundamentals.** The Quality preset is an empty placeholder. Price action alone is not research.

## 3. Risk and position sizing

- Sound core: fixed-fractional risk with a position cap; mechanics correct and tested.
- Costs: a flat 0.3% round trip is a crude proxy. Actual delivery costs (STT on both legs, stamp duty, GST, brokerage, DP charges) vary, and slippage in mid and small caps can exceed fees. Costs are displayed but never subtracted from reward-to-risk.
- Gap risk: planned risk is explicitly "excluding costs and gaps". Indian stocks gap through stops, especially on results, so the risk number is a best case.
- No check of position size against average daily volume (irrelevant at retail size, a blocker at institutional size).
- No portfolio view: no aggregate open risk, sector or correlation concentration, or drawdown limits. Ten correlated setups can mean 10% at risk under a 1% per-trade rule.
- Stops are volatility-based only, untested, with no trailing logic.

## 4. Workflow and usage

Fits well: screen after the close, shortlist, study the explained checklist, size a position. The explanation transparency is better than most retail tools.

Missing for a research loop:
- No journal or performance tracking (hit rate, expectancy). The biggest gap; the baseline spec planned it (Milestone 6).
- No alerts; pull-only.
- Signals are snapshots with no lifecycle (triggered, target hit, stopped, expired), so the app cannot audit its own calls.
- No news or disclosures, so no catalyst or event-risk context.
- No audit trail: scan runs are overwritten per scanner, and old scanner versions are not kept.
- Single user, local data: no compliance or reproducibility features an institution needs.

## 5. Ways the app could mislead a user

1. A high setup score reads as quality but has never been validated.
2. The trade plan is built on daily bars and drawn on 1D only; it could be mistaken for applying to intraday charts.
3. "Entry eligible" can appear on a circuit-locked or surveillance stock.
4. Demo mode is labelled, but its synthetic prices still produce real-looking scores.
5. "Unclassified" sector covers most stocks and acts as an exclusion, not as missing data.
6. Index charts are price indices, not total return, so long-horizon comparisons slightly understate benchmarks.

## 6. Recommendations by research value

| # | Add | Why |
|---|---|---|
| 1 | Journal with outcomes (entry, stop, exit, R multiple, strategy version) | Turns the screener into a feedback loop. Highest value. |
| 2 | Signal lifecycle persistence | Lets the app grade its own calls with no trading. |
| 3 | Backtest and replay on survivor-aware data, with costs, next-open fills and out-of-sample splits | The only way to justify weights and parameters. Needs delisted names first. |
| 4 | Tradability filters: circuit-lock, T2T/ASM/GSM, results dates, ADV participation | Removes false positives. |
| 5 | Portfolio risk panel: open risk, sector concentration, correlation | Makes the per-trade rule meaningful. |
| 6 | Costs and gaps in sizing: net reward-to-risk, stressed gap loss, liquidity cap | Turns the plan from best case into realistic. |
| 7 | Ingest delivery percentage; average turnover over all sessions | Cheap; improves liquidity and conviction measures. |
| 8 | Fundamentals and event data | Moves from technical screening toward research. |
| 9 | Alerts | Makes monitoring workable. |

## Bottom line

A transparent, well-built screener and planning aid, honest about its limits. As a research tool it lacks the one thing that separates analysis from pattern-matching: a way to measure whether its calls work. Until the journal, lifecycle tracking and a survivor-aware backtest exist, treat every score as a hypothesis and do not read the ranking as evidence.
