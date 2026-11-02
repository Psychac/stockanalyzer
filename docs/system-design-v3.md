# Stock Analyzer v3: design from scratch

Status: proposal, not built. Written 2026-11-02. Supersedes the architecture in [persistence-design.md](persistence-design.md) if accepted; reuses its spike findings. Regulatory points come from broker and secondary sources (section 9), not from SEBI or exchange documents directly: verify before going live.

## 1. Goals

1. **Manual trading support.** Enough relevant NSE and BSE market data to decide and place trades by hand: market overview, scanners over the whole market, charts, live quotes on what you watch and hold, alerts, and a trade planner.
2. **Automated trading that aims to earn money.** The same strategies run as backtest, automated paper trading, and automated real trading, with real money moving only after the strategy has shown evidence.

Constraints carried over: one user, Indian equities (cash segment) first, a salaried user who cannot watch markets during work hours, low risk appetite ([v2-proposal.md](v2-proposal.md)).

What automation does not do: it does not create an edge. It executes a rule faithfully, without hesitation or tilt. Whether a rule earns money is answered by evidence (section 6), and "put it in an index fund" remains a valid answer.

## 2. The constraint that shapes everything

Under SEBI's retail algo framework, in force for all brokers from 1 April 2026 (as reported by brokers, section 9):

- API orders are accepted only from a **static IP whitelisted with the broker** (a primary and a backup, changeable about once a week).
- Every API order is tagged with an exchange-assigned algo ID by the broker. Personal strategies under **10 orders per second** do not need separate registration; above that they do.
- **2FA login once every trading day.** FYERS, for example, no longer supports continuous refresh-token sessions.
- FYERS converts market orders to market-price-protection orders.

Consequences:

| Option | Can it place automated real orders? |
|---|---|
| Browser or installed PWA | No: no static IP, and it stops when the tab or phone sleeps |
| Vercel functions | No: shared, changing egress IPs on the plan in use, 300 s limit, no long-lived connections |
| **Always-on server in India with a static IP** | **Yes** |

So v3 is built around **one small always-on server** (a VPS in Mumbai). That server also removes most of the complexity in the earlier designs: it has a real disk, so there is no sharding, no 100 MB client download, and no CORS problem for Breeze.

Fully unattended trading is not possible: you log in with 2FA once each trading morning. In this design that login is also the daily **arming** step: no login, no live orders that day (paper continues).

## 3. Architecture

```
                         Exchange bhavcopies (EOD)   Broker market-data WebSocket (live)
                                   |                              |
                                   v                              v
 +----------------------------- ENGINE SERVER (VPS, Mumbai, static IP) ------------------------------+
 |  Ingest (EOD, nightly)     Live feed (ticks -> 1-min bars, quotes)                                |
 |        \                         /                                                                |
 |         v                       v                                                                 |
 |    SQLite (WAL) on local disk: market data + trading ledger + audit log                          |
 |         |                       |                                                                 |
 |    Scanner / strategy engine  -->  Signals  -->  Risk engine  -->  Order manager                  |
 |                                                                       |        |                  |
 |                                                       Paper broker (simulator)  Live broker        |
 |                                                                       (FYERS / Breeze adapter)    |
 |    Reconciler (broker is truth)    Alerts (push / Telegram)    API + WebSocket for the app        |
 +---------------------------------------------------------------------------------------------------+
           |  HTTPS + WebSocket, private network (Tailscale) or authenticated public endpoint
           v
   App (PWA: phone and desktop): dashboard, scanners, charts, watchlist, planner,
   orders and positions, strategies, kill switch
```

Principles:

1. **The server owns all state.** The app is a thin client: it asks for what a screen needs (a chart, a scan result, today's positions), so payloads are small and the phone holds only a cache.
2. **One engine, three clocks.** Backtest, paper and live run the same strategy, risk and order code. Only the clock (historical or real) and the broker adapter (simulator or real) change. A result in one mode is directly comparable with another.
3. **The broker is the source of truth for live money.** The engine's view of orders and positions is reconciled against the broker continuously; on any mismatch, the engine stops trading and alerts.
4. **Every protective stop lives at the broker.** Stops are placed as broker-side GTT or stop orders, so a crashed server, a lost network or a dead phone cannot leave a position unprotected.
5. **Fail closed.** Stale data, a failed reconciliation, a missed heartbeat, an unarmed session or a tripped limit means no new orders, never a guess.
6. **Everything is logged.** Every signal, risk decision, order, broker response and manual override is appended to an audit log that cannot be edited.

## 4. Goal 1: market data for manual trading

| Need | Source | Stored | Notes |
|---|---|---|---|
| Whole-market daily bars, NSE and BSE, 10+ years | Exchange bhavcopies (current and legacy formats, both verified reachable: [persistence-design.md](persistence-design.md) spike 3) | `bar_daily`, raw, adjusted on read | Nightly ingest plus a one-off backfill |
| Indices (Nifty 50/500, Sensex, BSE 500, sectors) | Exchange index files, or Upstox as today | `index_bar` | Benchmarks and regime |
| Corporate actions | Detected from previous close (as today); later an official feed | `corporate_action` | Flagged as unverified when detected |
| Instruments, ISIN, sector | Exchange lists plus the current metadata sources | `instrument` | Weekly refresh |
| Live quotes and intraday bars | Broker WebSocket (FYERS or Breeze, server-side) | `bar_1m` for subscribed symbols; quotes in memory | Watchlist, holdings, open orders, strategy universe |
| Market pulse (breadth, movers, highs and lows) | Computed nightly and from live quotes intraday | `breadth_daily` | Dashboard |
| Announcements and results dates | Exchange announcement pages | `event` | Later phase; licensing and scraping limits to check |

Screens: dashboard (regime, breadth, indices, movers, alerts, positions); discover (scanner over the whole market, run on the server in milliseconds against SQLite); chart (daily from the database, intraday from the live feed, indicators); watchlist with live quotes; trade planner (entry, stop, targets, risk-sized quantity, net-of-cost reward-to-risk); orders and positions (from the broker, with one-tap order placement through the same order manager, so manual orders also pass the risk checks).

Live-data limits to verify per broker: symbols per WebSocket connection, and whether BSE is covered (Breeze has no BSE live data, per [backend-design.md](backend-design.md)).

## 5. Goal 2: the trading engine

### 5.1 Flow

```
Strategy (declarative rules, versioned)
   -> Signal (instrument, side, entry, stop, targets, reason, strategy version)
   -> Risk engine: approve, resize or reject, with the rule that decided it
   -> Order intent (idempotent client id)
   -> Order manager -> broker adapter -> broker
   -> Order updates and fills -> Ledger -> Positions and cash
   -> Reconciler compares with the broker every minute in market hours
```

### 5.2 Strategy modes (set per strategy, never global)

| Mode | What happens | Promotion needs |
|---|---|---|
| Off | Nothing | |
| Backtest | Historical runs only | |
| Paper | Runs live on the simulator | A backtest that passes the gate |
| Live, confirm | Real orders, each one needs your tap on a push notification (expires if ignored) | Paper evidence passing the gate |
| Live, auto | Real orders without confirmation, at reduced size first | A confirm-mode track record; your explicit switch |

The gate is the v2 promotion gate: enough trades, positive expectancy after costs with a confidence interval, drawdown within limits, and results not carried by a few winners. Demotion is automatic when live results fall below the tested range.

### 5.3 Strategy timeframe

Start with **end-of-day and swing strategies**: signals computed after the close, orders placed for the next session (pre-open or at the open), stops at the broker. This fits a day job, needs only one order window a day, and the daily bars needed already exist for 10+ years. Intraday strategies come later and only if justified: they need intraday history (which the free sources do not give), are far more sensitive to costs and slippage, and sit in the segment where SEBI found most retail traders lose money.

### 5.4 Risk engine (hard limits, enforced in code, before every order)

Per order: risk per trade, position cap, minimum trade size, net reward-to-risk after costs, price within a band of the last trade, instrument allowed (no surveillance-listed or illiquid names).
Per account: max open positions, max open risk, daily loss limit, monthly loss stop, drawdown pause, max orders per day, order rate far below 10 per second.
Environment: session armed, market open (or pre-open window), data fresh, last reconciliation clean, kill switch off.

Each check records which rule decided; a rejected order is visible in the app with the reason.

### 5.5 Safety mechanisms

- **Kill switch** in the app and by Telegram command: cancels open orders, blocks new ones, optionally exits all positions. Also trips automatically on a daily-loss breach, a reconciliation mismatch, or repeated broker errors.
- **Idempotent orders:** every order carries a client id derived from the signal; a retry after a timeout queries before resending, so a network blip cannot double an order.
- **Heartbeat:** if the engine misses its heartbeat, you get an alert; stops are already at the broker.
- **Dry run:** a live adapter mode that logs the exact order it would send without sending it, for the first days on a new strategy or broker.
- **Daily summary:** after the close, what was traded, what was rejected and why, P&L against the index.

### 5.6 Paper broker (simulator)

Same order types as live (limit, stop, GTT-style triggers). EOD strategies fill at the next session open with a gap model; intraday fills against live ticks. Slippage scaled by liquidity, the full Indian cost stack (brokerage, STT, exchange charges, stamp duty, GST, DP charges) as versioned settings, partial fills above a share of the day's volume, no fills on circuit-locked days. Backtests use the same simulator on historical bars.

## 6. Data model (SQLite, one file, on the server)

Market data: `instrument`, `bar_daily` (raw, integer paise, volume as 64-bit), `bar_1m`, `corporate_action`, `index_bar`, `breadth_daily`, `liquidity_month` (point-in-time universe), `source_batch` (provenance), `data_quality_issue`. The schema in [persistence-design.md](persistence-design.md) section 4 carries over, with the fixes from its review: string instrument keys (`NSE:SYM`, `BSE:scripcode`), 64-bit volume, and liquidity rank computed over all raw rows.

Trading: `account` (paper or live, broker, starting cash), `strategy`, `strategy_version` (immutable), `signal`, `risk_decision`, `order` (client id, broker id, state machine), `order_event`, `fill`, `position` (derived, cached), `cash_ledger` (append-only), `gtt` (broker-side stops), `backtest_run` (pinned data revision and engine version), `audit_log` (append-only).

Backup: SQLite online backup nightly to off-server storage (Vercel Blob or any object store), encrypted. Market data can be rebuilt from exchange files; the ledger and audit log cannot, so they are backed up after every trading day.

## 7. Hosting and security

- **Server:** a small Linux VPS in Mumbai with a static IP (2 vCPU, 2 to 4 GB RAM, 40+ GB disk is ample). Low-cost providers exist with Mumbai regions; check price and whether the static IP is included before choosing. A home PC is possible only if your ISP gives a static IP and the PC stays on.
- **App hosting:** the PWA can stay on Vercel (static files only), or be served by the server.
- **Access:** the server can place real orders, so it is not openly reachable. Recommended: a private network (Tailscale) between your devices and the server, plus app login with a password and TOTP. Broker tokens encrypted at rest, never sent to the app.
- **What Vercel is no longer needed for:** the shared data backend, the Breeze relay, and the cron. They move to the server. The current deployment can keep running until the server replaces it.

## 8. What is reused from the current app

Kept, moved to shared domain code: the NSE and BSE parsers and ingest rules (date checks, holiday handling, one-sided days), indicators, the scanner engine and rule builder, the two strategies and trade-plan logic, the FYERS and Breeze clients (now server-side, so Breeze needs no helper), and most UI components. Replaced: the Vercel data backend, Blob snapshots and deltas, Dexie market cache, and the sharded design in [persistence-design.md](persistence-design.md).

## 9. Regulatory notes (verify before live trading)

Sources are broker notices and secondary articles, read 2026-11-02:

- [FYERS notice: new SEBI framework for retail algo trading from April 01, 2026](https://fyers.in/notice-board/new-sebi-framework-for-retail-algo-trading-from-april-01-2026)
- [SEBI retail algo rules in 2026: what is in force](https://antsheel.com/blog/sebi-retail-algo-trading-rules-2026-india/)
- [AlgoBulls: SEBI algo trading rules 2025 to 2026](https://algobulls.com/blog/industry-insights-and-updates/sebi-new-algotrading-regulations-for-retail-investors-2026)
- [Shoonya: SEBI's algo trading rules](https://shoonya.com/blog/sebi-algo-trading-rules/)

Check with your chosen broker: static IP registration steps, how personal API strategies are tagged, the daily login flow, order-rate limits, GTT support via API, and whether automated order placement for your own account is permitted on your plan. This tool is for your own account only; sharing strategies or signals with others would make you an algo provider under the framework.

## 10. Phases and exit criteria

| Phase | Scope | Exit criterion |
|---|---|---|
| 1. Foundation | VPS, SQLite, EOD ingest and 10-year backfill, server API, app reads from the server | Dashboard, scanner and daily charts work from the server for NSE and BSE |
| 2. Live data | Broker WebSocket on the server, quotes, intraday bars, alerts | Watchlist and holdings update live; an alert reaches the phone |
| 3. Engine and paper | Ledger, order manager, risk engine, simulator, backtests on the same code | A backtest and a paper run of the same rules over the same dates agree |
| 4. Live, manual | Live adapter, reconciliation, GTT stops, manual orders from the app through the risk engine, kill switch | Small real orders placed and reconciled correctly for two weeks |
| 5. Live, automated | Confirm mode, then auto mode per strategy after the gate | A strategy runs in confirm mode for an agreed period inside every limit |

Phase 1 alone answers the research question: with 10 years of data on a real database, the two existing strategies can be backtested after costs before anything else is built.

## 11. Decisions needed

1. **Execution broker:** FYERS (documented API, already integrated) or ICICI Breeze (your account; no BSE live data)? Possibly both: one for data, one for orders.
2. **Server:** a Mumbai VPS (recommended), or a home PC with a static IP?
3. **Strategy timeframe:** start with EOD and swing only (recommended), or intraday from the start?
4. **Risk limits in rupees:** capital for live trading, daily and monthly loss limits.
5. **Access:** Tailscale private network (recommended), or a public endpoint with strong login?
