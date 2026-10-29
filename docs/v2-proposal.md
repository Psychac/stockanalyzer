# Proposal: Stock Analyzer v2 for a salaried, low-risk retail investor

Status: draft for discussion. Not designed in detail, not built. Author role: equity research analyst. This is a framework to test, not advice, and nothing here is a promise of profit. Verify tax and regulatory points with a qualified professional.

Builds on [research-assessment.md](research-assessment.md) and [code-review.md](code-review.md). Complements [roadmap.md](roadmap.md).

## 1. Honest starting point

Your goal: use technology to make money from the stock market, with limited principal, low risk appetite, and a day job.

Three facts shape the design:

1. **Most active retail traders lose money.** SEBI's published studies of individual traders (F&O for FY22 to FY24, and equity intraday) found large majorities lost money after costs; the F&O figure was roughly nine in ten. Quote from memory: check the current SEBI reports. Low-risk retail success mostly comes from *not* doing what loses.
2. **A broad index fund is the benchmark to beat.** If an active approach cannot beat a low-cost index fund after costs, tax and your time, the right output of this app is "put it in the index".
3. **Your time and attention are the scarce resource.** You cannot watch markets during work hours. The app must work on an end-of-day, once-a-day rhythm and automate the discipline, not the excitement.

So v2 changes the app's job: from "find setups" to **"protect capital, enforce rules, and prove what works before real money moves"**.

## 2. Principles

1. **Capital preservation first.** Rules that cap loss come before rules that find trades.
2. **Core and satellite.** Most savings sit in boring assets outside active trading; only a capped satellite is traded.
3. **Do nothing is a valid output.** If the regime or the rules say no, the app says no.
4. **Evidence before money.** A strategy trades real money at full size only after it has shown evidence with costs and tax included. Evidence can come from backtests, paper trading or small-size live trades. Paper trading is one source and is optional (see sections 5 and 6).
5. **Beat the alternative.** Every result is shown against "just buy the index fund".
6. **Delivery only.** Long-only equity delivery. No F&O, no intraday leverage, no margin, no shorting.
7. **Humans stay in control.** The app plans and warns; you place orders. No auto-ordering.
8. **Explain everything.** Keep the current transparency.

## 3. Capital and risk framework (parameters, set by you)

Illustrative values for a conservative setup; you choose the real ones in Settings. All limits are enforced by the app, not suggested.

| Rule | Illustrative value | Purpose |
|---|---|---|
| Emergency fund and insurance | Outside the app; the app asks you to confirm they exist | Never trade money you may need |
| Satellite size | At most 10 to 20% of investable savings | Caps the blast radius |
| Risk per trade | 0.5% of satellite capital | Small, survivable losses |
| Max open positions | 3 to 5 | Attention and concentration limit |
| Max total open risk | 2% of satellite | Correlated losers cannot stack |
| Position cap | 20 to 25% of satellite | No single name dominates |
| Monthly loss stop | 3% of satellite: no new entries for the rest of the month | Stops tilt and revenge trading |
| Drawdown pause | 10% of satellite: trading stops until a written review | Forces reflection |
| Minimum trade size | Large enough that round-trip costs are under about 0.5% of the position | Small trades are eaten by fixed costs |
| Product | Delivery, cash segment, no margin | No leverage risk |

Cost reality at small size: with a satellite of Rs 3,00,000 and 0.5% risk, a trade risks Rs 1,500. Round-trip costs on a Rs 60,000 position at about 0.3 to 0.4% are Rs 180 to 240, which is 12 to 16% of the risk you took. Net reward-to-risk must be computed after costs, and trades whose net reward-to-risk is under 2 are rejected.

## 3A. Sizing and ruin (Thorp-inspired)

Edward Thorp's lasting lessons are about discipline, not about his particular strategies: find an edge you can measure, size bets from the edge and its uncertainty, avoid ruin above all, and distrust results that look too good. (Recalled from his books *Beat the Dealer*, *Beat the Market* and *A Man for All Markets*; check specifics before quoting.) His own edges were structural and hedged, needing short selling, leverage, very low costs and large capital. A small retail account cannot replicate them, so this section borrows the method, not the trades.

### 3A.1 No proven edge, no bet

The Kelly criterion says to bet nothing when the edge is zero or negative. This is the promotion gate (section 5) in other words: until evidence exists, the right full-size position is zero, and only probation size is offered.

### 3A.2 Kelly as a ceiling check, not a target

For a trade that wins with probability p and pays b times what it risks, full Kelly risks a fraction f = p - (1 - p) / b of capital, where a loss costs the whole risked amount (so f is directly comparable to the per-trade risk in section 3).

| Win rate | Payoff | Full-Kelly bet |
|---|---|---|
| 35% | 2R | 2.5% |
| 40% | 2R | 10% |
| 45% | 2R | 17.5% |
| 33% | 2R | about 0 (no edge) |

At a 0.5% risk per trade, the plan sits at about 5% of full Kelly if the 40% case were true, which is deliberately very conservative. The app shows the Kelly fraction for each strategy as information, and **blocks any size above a configurable fraction of it (default a quarter)**. If the edge estimate is zero or negative, the ceiling is zero.

### 3A.3 The estimate is the weak point

Kelly is only as good as p and b, and both come from a small sample.

- With 50 trades the win rate has a standard error of about 7 points (for a true 40%), so a measured 40% is consistent with anything from about 26% to 54%. That range includes no edge. The 50-trade gate in section 5 is therefore a floor, not proof.
- The app shows a **confidence interval** on win rate, average R and expectancy, and **sizes from the lower bound**, not the point estimate. When the interval includes zero expectancy, sizing falls to zero (or probation size).
- Estimates come from the journal and backtest after costs, never from the signal score, which is not a probability.

### 3A.4 Drawdown is the price of aggressive sizing

A textbook result, under idealised assumptions: at full Kelly the chance of ever falling to half of capital is about 50%; at half Kelly it is about 12%. This is why practitioners use fractions of Kelly, and why a low-risk, uncertain-edge investor should size lower still.

The **ruin and drawdown simulator** resamples the R multiples in your journal (or backtest) many times, with your actual sizing rules, and reports:

- the probability of hitting the monthly loss stop and the drawdown pause (section 3) within a year;
- the distribution of worst drawdowns and the longest losing streak;
- how those change if the true win rate is a few points lower than measured.

It is a planning aid and carries the assumptions it used. It does not predict returns.

### 3A.5 Correlation and aggregate risk

Kelly assumes independent bets. Several momentum stocks in one market behave like one bet. The aggregate open-risk cap (section 3) is therefore **correlation-aware**: positions that move together (same sector, high measured correlation) count as a combined exposure, and the app shows effective independent bets rather than the raw position count.

### 3A.6 Edges decay

When others find an edge it shrinks, and costs and market regimes change. The **edge-decay monitor** tracks each strategy's rolling expectancy against its tested range. If live results fall below the lower bound of the range for a set number of trades, the strategy is automatically moved to reduced size or paper, and the move is logged.

### 3A.7 Be your own sceptic

Backtests that look too good usually are. The app flags results with:

- few trades, or a result carried by a handful of winners;
- gains that vanish with slightly different parameters (an instability check);
- fills better than the simulator's pessimistic defaults;
- a smoothness or consistency no live strategy of this kind would show.

A flagged strategy cannot be promoted without a written note explaining why.

### 3A.8 What this does not mean

- It does not mean the app has an edge. It means the app will not size one that has not been shown, and will say so.
- It does not make Thorp-style hedged arbitrage available to you; if the evidence says there is no edge, the consistent decision is the index fund.

## 4. Strategy framework (hypotheses to validate, not facts)

A single, simple, long-only swing and positional approach, because simple rules are easier to test and harder to overfit.

**Step 1: Market regime filter.** Allow new entries only when the broad market is healthy, for example the Nifty 500 above its 200-day average and the 50-day above the 200-day. Otherwise the app shows "Risk-off: hold cash or a liquid fund, no new trades."

**Step 2: Tradable universe** (replaces the current Rs 50 lakh floor):
- Top 300 to 500 stocks by average turnover over the last 6 months, averaged over all sessions.
- Main-board `EQ` series only.
- Exclude trade-for-trade, ASM and GSM names, SME, stocks at or near circuit limits, and stocks in the F&O ban list.
- Exclude stocks with results or board meetings in the next few sessions unless you opt in.
- Minimum price and a minimum average daily turnover (for example Rs 20 crore) so exits are possible.

**Step 3: Candidate ranking.** Relative strength against the broad index and against the stock's sector, over more than one horizon (for example 3 and 6 months), plus trend alignment. Keep weights few and fixed; learn them from the backtest, not by hand.

**Step 4: Entry.** Two setups at most, breakout from a base and pullback in an uptrend. The plan states a limit order range for the **next session**, a skip rule if the open gaps above it, and an order ticket you can copy into your broker.

**Step 5: Exit.** Stop-loss order (a GTT or equivalent) placed the same day; targets from structure or volatility rather than a fixed multiple; optional move to breakeven after 1R; time stop (exit if there is no progress after N sessions).

**Step 6: Sizing** from section 3, with the stressed-gap loss shown beside the planned loss.

Every number above (200-day, 1.5x volume, 20-day, 2R, N sessions) is a parameter to test in the backtest, not a belief.

## 4A. Market regimes, and what we do in each

The strategies in section 4 are long-only and rely on uptrends. That is deliberate for a salaried, low-risk investor, so the app must say clearly what to do when the market is not rising. A regime is a plain-language state shown on the dashboard, with the evidence behind it. Regime thresholds are parameters to test, like every other number here.

### 4A.1 Three regimes

| Regime | Example test (parameters, not beliefs) | New entries | Existing satellite positions | Money not deployed |
|---|---|---|---|---|
| **Risk-on** | Nifty 500 above its 200-day average, and the 50-day above the 200-day | Allowed, within the section 3 limits | Normal stops | Core SIP continues |
| **Caution** | Nifty 500 above the 200-day but the 50-day has turned down, or breadth is deteriorating, or the market is more than a set distance below its recent high | Allowed only at reduced risk (for example half the per-trade risk) and a lower position count | Tighten stops; no adding to winners | Raise the cash share of the satellite |
| **Risk-off** | Nifty 500 below its 200-day average | **None** | Exit on stops or on weakness alerts; no averaging down | Liquid or short-duration debt fund; core SIP continues |

The state changes slowly on purpose: it needs to hold for a set number of sessions before switching (to avoid flipping on one bad day), and the app shows how long the current state has lasted. Every state change is logged in the journal.

### 4A.2 Why not short

The app does not add shorting, and this is a design decision, not a gap. In India, delivery short selling is not available to retail investors in the cash market. The cash-market short is intraday only and must be squared off the same day. A multi-day bearish view needs futures or options. These are my understanding of the rules; confirm them with your broker.

| Way to be bearish | Why it does not fit the goal |
|---|---|
| Intraday cash short | Same-day square-off, usually leveraged, needs market-hours attention. This is the segment where regulator studies found most retail traders lose money. |
| Stock or index futures | Theoretically unlimited loss, margin-funded, large contract sizes relative to a small account, gaps defeat stops. |
| Buying puts | Loss is capped at the premium, but time decay means you must be right on direction and timing. |
| Spreads (for example a bear put spread) | Defined risk and cheaper, but more legs, more costs, more complexity. |
| Inverse ETFs | No widely used one in India. |

### 4A.3 What the app does in a falling market instead

1. **Cash is a position.** Risk-off means no new trades, and the undeployed satellite sits in a liquid or short-duration fund (your choice, held outside the app).
2. **The core SIP keeps running.** Steady buying through downturns belongs to the core, outside the trading satellite. The app only reminds you it is not part of the satellite's rules.
3. **Weakness is used to exit or avoid, never to short.**
   - **Exit alerts on holdings:** lost the 50-day average, broke the trailing stop, relative strength turned negative, or the stock entered a surveillance list.
   - **Avoid list:** a "weak stocks" scan, reusing the downtrend logic the app already has, used only to exclude names from candidate lists.
4. **Reduce exposure early.** The caution regime cuts per-trade risk and position count before the loss limits in section 3 are reached.
5. **Defensive sleeve view (optional).** In caution or risk-off, a list of low-volatility and defensive-sector candidates you may choose to hold instead of cash. It is information only and follows the same risk rules and the same gate as everything else.

### 4A.4 Optional bearish track, paper only

If you later want to learn bearish tools, the paper-trading module (section 6) can simulate **defined-risk structures only**: a bought put first, then a put spread. The track is off by default and:

- never connects to a broker and never produces an order ticket;
- uses the same costs, slippage and risk limits as every other paper account, plus option-specific costs and time decay;
- is judged on net results after costs against simply holding cash, with the same promotion gate (section 5);
- needs an options data source, which the app does not have, so this is last in the order and may never be built.

A hedge calculator that shows the cost of a protective put on the index against your satellite is a related optional, information-only feature. It never places an order and always shows the cost.

### 4A.5 Trades the app deliberately leaves out

| Not covered | Why |
|---|---|
| Sideways or range markets (mean reversion) | Trend rules lose here through false breakouts, and the app has no range strategy; the caution regime reduces risk instead. |
| Bear-market rallies | The trend filter ignores them, correctly, for a low-risk plan. |
| Event trades (results, dividends, buybacks) | High gap risk; results dates are used as a filter to avoid, not as a trade. |
| Leverage, F&O, intraday | Out of scope (section 7). |

## 5. The validation loop (the core of v2)

This is what the current app lacks and what decides whether any real money is used.

1. **Signal lifecycle.** Each signal is stored and tracked through triggered, stopped, target hit, expired. This needs no trading at all, so it is always on.
2. **Journal.** Each trade, paper or live, records entry, stop, exit, fees, reason, strategy version, and your notes. Paper and live trades share one journal and one ledger (section 6), told apart by an `account` field.
3. **Backtest and replay.** Run strategies over history with:
   - point-in-time universes (including stocks that later delisted or were pruned),
   - next-open fills with a gap model, slippage, and the full cost stack,
   - out-of-sample periods and a parameter-stability check,
   - a comparison against the index fund.
4. **Promotion gate.** Before a strategy trades at full size, it must show, for example: at least 50 trades (or 3 months across both a risk-on and a risk-off stretch), net expectancy above about 0.15R after costs and estimated tax, maximum drawdown within your rule, and a result not explained by a few outlier winners. The app shows a confidence interval, because 50 trades is a wide one.
5. **Live scorecard.** Hit rate, average R, expectancy, profit factor, maximum drawdown, time in market, and alpha versus the index. If live results fall below the gate, the app moves the strategy back to reduced size or to paper.

### Paper trading is optional: three evidence routes and a gate mode

Paper trading is the slowest way to gather evidence (weeks to months), so you choose the route:

| Route | Evidence quality | Cost | Main weakness |
|---|---|---|---|
| Backtest only | Medium | Fast, free | Overstates live results; needs survivor-aware data |
| Backtest plus paper trading | Highest | Weeks to months of waiting | Still not real fills |
| Probation size: trade live at 25 to 50% of normal risk and let the journal collect evidence | Real fills and real behaviour | Real, but small, losses | You are risking money to learn |

A setting, **gate mode**, controls what the app does when a strategy has not passed:

- **Enforce:** the plan is shown but real-size sizing is blocked; only probation size is offered.
- **Advise** (default): sizing works, with a visible "unvalidated strategy" warning and the evidence so far.
- **Off:** no gate, but the scorecard still records results.

With paper trading switched off, the gate uses backtest and probation evidence only. Nothing in the app requires a paper account to function.

## 6. Paper trading and tracking (optional module)

This folds roadmap item 2 into the app. It is off by default and can be enabled in Settings; turning it off hides it and leaves all other features working. Roadmap item 3 (live auto ordering) stays deferred; this module is designed so it could follow without a rewrite.

### 6.1 One ledger for paper and live

A single **account and ledger** abstraction serves both modes, as the roadmap asks ("a strategy can switch paper to live without changes"):

- `Account { id, kind: 'paper' | 'live', startingCash, currency, createdAt }`. You can keep several paper accounts, for example one per strategy, so results are not mixed.
- `Order`, `Fill`, `Position`, `CashEntry`, and a derived equity curve, all keyed by account.
- The journal is a view over the ledger plus notes. A **live** account is entered by you by hand (or imported later); a **paper** account is filled by the simulator. Reporting code treats them identically, so a paper result and a live result are directly comparable.
- Strategy version, plan id and signal id are stored on every order, so each trade traces back to the rule that produced it.

### 6.2 Three paper modes, from simplest to most automated

| Mode | What it does | Runs where |
|---|---|---|
| **Manual** | You place simulated buy and sell orders from a chart or a trade plan | In the browser |
| **Plan-following** | One click on a trade plan creates the paper orders (entry, stop, targets) exactly as the plan states them, then the simulator manages them | In the browser |
| **Automated** | A chosen strategy version takes its own signals and orders on paper, applying the same risk rules as live | In the browser, by catch-up (see 6.4) |

Backtesting (the third roadmap bullet) uses the same simulator and the same ledger over historical data, so paper, backtest and live reports share one code path and one set of numbers.

### 6.3 Simulator realism (the order model)

Paper results are only useful if the fills are pessimistic enough. Defaults, all configurable:

- **Order types:** market, limit, stop-loss (as GTT-style trigger orders), and good-till-cancelled with expiry.
- **Fill timing:** orders placed after the close fill in the **next session**, not at the signal bar's close. A market order fills at the next open plus slippage; a limit fills only if the next session trades through it.
- **Gaps:** a stop that is gapped through fills at the open, not at the stop price. A buy limit above a gap-up open is skipped.
- **Partial fills and liquidity:** on end-of-day data, an order above a set share (default 2%) of the day's volume fills partially or not at all.
- **Slippage:** a spread and impact estimate scaled by liquidity bucket, so mid and small caps cost more than large caps.
- **Costs:** a configurable stack for delivery trades: brokerage, STT, exchange charges, stamp duty, GST, DP charges. Rates are settings, not constants, because they change.
- **Circuit and untradable days:** no fills on a locked-circuit day or a suspended stock.
- **Corporate actions:** positions and stops adjust for splits and bonuses using the data already adjusted in the ingest, and dividends credit to cash.
- **Cash and risk rules:** the same limits from section 3 apply to paper accounts (max positions, open risk, monthly stop), so paper practice trains the real behaviour.

### 6.4 Automated paper without an always-on server

The roadmap notes that background execution needs a server if the tab is closed. With end-of-day data and end-of-day decisions, it does not:

- Each time the app opens, it **catches up**: for every session since it last ran, it replays that day through the simulator (fills, stops, targets, new signals, new orders) in order, using the downloaded daily history.
- Results are identical whether you open the app daily or after a week, because the simulation is deterministic and keyed by session date.
- If you want the catch-up to happen even when you do not open the app, an optional scheduled job on the shared backend can run it later; that needs per-user state and is tied to the multi-user decision in roadmap item 1, so it is deferred.
- Intraday automation (stops that trigger mid-session) is out of scope; it would need live data and a server.

### 6.5 Tracking and reporting

- Equity curve and drawdown per account, against the index fund over the same dates.
- Per-strategy and per-version statistics: trades, hit rate, average R, expectancy, profit factor, maximum drawdown, average holding time, fees paid, estimated tax.
- Separation of **signal quality** (what the plan said) from **execution quality** (what the simulated or real fill did), so you can tell a bad idea from a bad fill.
- A trade list with the checklist that justified it, your notes, and a mistake tag (for example "broke the risk rule", "chased the gap").
- Export of the ledger, and of backtest runs, in the existing JSON backup. Paper and live accounts are both included; credentials still never are.

### 6.6 What it deliberately does not do

- It never places real orders, so a paper account cannot cause a real loss.
- It never presents paper results as expected live returns; reports carry the assumptions used (fills, slippage, costs) so they can be reproduced.
- It does not hide losses: closed paper trades cannot be deleted, only annotated, so the record stays honest. Resetting an account archives it.

## 7. Features and priority

| Pri | Feature | Notes |
|---|---|---|
| P0 | Risk rules engine with hard limits and a pre-trade checklist that blocks violating plans | Core of the low-risk promise |
| P0 | Journal, signal lifecycle and the shared account and ledger | New Dexie tables; extends the existing `TradePlan` states. Always on; paper mode is a setting |
| P0 | Net-of-cost reward-to-risk, stressed gap loss, minimum trade size check | Extends `sizePosition` |
| P0 | Explicit three-state regime (risk-on, caution, risk-off) gating new entries, with a "no trade" state and a state-change log | Section 4A. Uses existing Nifty 500 index data |
| P1 | Exit and weakness alerts on holdings (lost the 50-day, trailing stop broken, relative strength negative) and an avoid list | Section 4A.3. Reuses existing indicators and the scanner engine |
| P1 | Tradability filters (circuit, T2T, ASM, GSM, F&O ban, results dates) | Needs new data sources; feasibility unverified and may require scraping, so assess licensing first |
| P1 | Backtest engine on survivor-aware data | Reuses the domain scanner; ingest must retain delisted names and a point-in-time universe |
| P1 | Paper trading, optional: manual, plan-following, and catch-up automated modes on the shared simulator | Section 6. Off by default |
| P1 | Gate mode (enforce, advise, off) and probation sizing | Section 5 |
| P1 | Benchmark comparison versus an index fund | Needs a total-return or at least a dividend-aware benchmark |
| P1 | Edge estimate with confidence intervals; sizing from the lower bound; zero size when the interval includes no edge | Section 3A.3 |
| P1 | Kelly ceiling check (block sizes above a set fraction of Kelly) | Section 3A.2 |
| P1 | Ruin and drawdown simulator from journal R multiples | Section 3A.4. Resampling in the shared simulator module |
| P2 | Edge-decay monitor with automatic demotion | Section 3A.6 |
| P2 | Too-good-to-be-true checks on backtests | Section 3A.7 |
| P2 | Correlation-aware aggregate risk | Section 3A.5. Extends the P2 portfolio panel |
| P1 | Alerts: stop approaching, target hit, setup triggered, data stale | Web push through the PWA; no always-on server needed if limited to end-of-day events |
| P2 | Portfolio panel: open risk, sector concentration, correlation, drawdown vs limits | |
| P2 | Tax and P&L tracker (short-term versus long-term, charges) | Rates change; configure, do not hard-code |
| P2 | Delivery percentage and true turnover averaging in ingest | Delivery percentage is already in the NSE file |
| P2 | Fundamentals screen (growth, debt, profitability) as a safety filter | Needs a data source |
| P2 | Defensive sleeve view (low-volatility and defensive-sector candidates in caution and risk-off) | Information only; same risk rules and gate apply |
| P3 | Hedge calculator (cost of a protective index put against the satellite) and the paper-only defined-risk bearish track | Section 4A.4. Needs an options data source, which does not exist today; may never be built |
| P3 | Weekly review report: what happened, rule breaches, lessons | Supports the written review after a drawdown pause |
| P3 | Multi-device sync, cloud backup | Optional |

Explicitly out of scope for v2: shorting and any real-money F&O, intraday, leverage, margin funding, live auto-ordering (roadmap item 3, deferred until the paper and backtest evidence exists), tips or signal sharing, and multi-user (roadmap item 1, which the optional server-side catch-up would depend on).

## 8. Workflow for a salaried user

- **Daily, about 5 minutes after the close:** open the app, read the regime, see alerts (stops, targets, stale data), review at most a few new candidates, copy an order ticket, place orders for the next session with stops in place.
- **Weekly, about 30 minutes:** review the journal, the scorecard against the index fund, and any rule breaches.
- **Monthly:** compare the satellite with the benchmark; decide whether it earns its place or the money should go to the index fund.
- **Never required:** market-hours monitoring.
- **If paper trading is on:** orders you place or accept after the close are simulated and filled at the next session when you open the app; the daily routine adds about a minute.

## 9. Data and technical changes

- Ingest: keep delisted and pruned symbols in a point-in-time archive; average turnover across all sessions; add delivery percentage; keep daily universe snapshots; add a staging step for rebuilds (see code-review finding 1).
- Domain: new modules for risk rules, regime, lifecycle, backtest and costs. They stay pure and independent of React.
- Storage: new tables for accounts, orders, fills, positions, cash entries, signals and backtest runs (additive Dexie version), included in export. Ledger rows are append-only.
- Simulator: one pure, deterministic module (`src/domain/sim`) shared by backtest, paper and the live-journal reports. It takes a day of bars, an account and a rule set, and returns fills and the new account state. Determinism is what makes catch-up and reproducible reports possible, and it needs thorough tests, including gap, partial-fill and corporate-action cases.
- A broker-adapter interface is defined now but implemented only for paper, so a later live adapter can plug in (roadmap item 3).
- Quality: CI, lint and end-to-end smoke tests before real money depends on the app (see code-review priority plan).
- Non-goal: a backend per user. The shared backend stays public-data-only.

## 10. Phases and acceptance criteria

| Phase | Scope | Exit criterion |
|---|---|---|
| A. Safety | Fix code-review findings 1 to 3; risk rules engine; net-cost sizing; regime and no-trade state | Plans violating a rule cannot be produced; a rebuild cannot publish partial data |
| B. Memory | Account and ledger, journal, signal lifecycle, scorecard (live accounts entered by hand) | Every signal and trade is recorded with its strategy version |
| C. Evidence | Simulator, point-in-time archive, backtest, benchmark comparison, gate mode and probation sizing | A strategy can be promoted or demoted from objective, cost-inclusive results, with no paper account required |
| C2. Paper (optional) | Manual and plan-following paper accounts, then catch-up automated mode, reports shared with live | Paper and backtest reports of the same rules and dates agree; turning the module off leaves the app fully working |
| D. Tradability | Circuit, T2T, ASM, GSM, ban list, results dates, delivery percentage | False positives on untradable stocks measured and reduced |
| E. Operations | Alerts, portfolio panel, tax tracker, weekly review | Daily use fits in about 5 minutes |

## 11. Expectations and open questions

- Realistic aim: capital preservation first, then modest outperformance of an index fund if the evidence supports it. A strategy that cannot clear the gate is a valid, useful result.
- Backtests overstate live results; treat paper results as the real test.
- Questions to settle:
  1. What is the actual satellite size, and what share of investable savings is it?
  2. What is your hard monthly loss and drawdown limit in rupees?
  3. Which broker, and does it support GTT stops and basket tickets?
  4. How much time can you spend each day and week?
  5. Which free sources for circuit bands, surveillance lists and results dates are acceptable to use, given exchange terms?
  6. Is this tool for you only, or might it be shared (which changes data licensing)?
  7. Paper trading: how many paper accounts do you expect (one per strategy?), and what starting cash should they use, the same as the satellite?
  8. Strategy definition for automated paper trading: only the built-in strategies, the existing scanner rule builder, or both? Code strategies are out unless you want them.
  9. Gate mode default: advise, or enforce for the first months to build the habit?
  10. Is catch-up on open good enough for automated paper, or do you want a scheduled server run (which pulls in the multi-user question)?
  11. Roadmap order: the suggested order puts paper trading before the multi-user and backend foundation. This proposal keeps that and adds the safety and evidence work ahead of it. Agree?
  12. Regime: which benchmark and thresholds do you trust (Nifty 500 and the 200-day, or something else), and how many sessions must a new state hold before the app switches?
  13. Where does money go in risk-off: a liquid fund, short-duration debt, or just your bank? The app only needs to know the label to show it.
  14. Do you want the defensive sleeve view, or is cash enough for you?
  15. Is the paper-only bearish track worth keeping on the list, or should the doc say plainly that bearish trading is out for good?
  16. Kelly ceiling: is a quarter of Kelly the right default cap, or do you want it stricter? Should sizing hard-stop at zero when the edge interval includes no edge, or only warn?
  17. How many trades must a strategy have before the app shows an edge estimate at all (it is meaningless on a handful)?
