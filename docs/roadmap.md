# Roadmap / Future Plans

Status: ideas captured, not designed yet. Each item needs a discussion before implementation.

## 1. Multi-user support

**Today:** the app is single-user (one browser, one set of broker credentials/settings, local storage only, pure PWA).

**Goal:** multiple people can use the same deployment, each with their own watchlists, settings and broker connections.

**Open questions / workarounds to think through**
- Identity: how do users sign in (email/password, OAuth, magic link)? Does this force us to add a backend, given the app is currently a pure PWA?
- Per-user storage: watchlists, strategies, settings, paper-trading state. Move from local storage to a server DB, or keep local and add optional sync?
- Broker credentials: each user brings their own FYERS/Breeze keys. Where are tokens/secrets stored safely (never plain in shared storage)? Token refresh and daily re-login per user.
- Breeze needs a helper because of CORS ([provider-feasibility.md](provider-feasibility.md)); a shared helper must not mix users' sessions.
- Market-data rate limits: provider limits are per account, so per-user connections avoid contention, but a shared feed would need caching/fan-out.
- Hosting and cost, privacy/compliance (storing financial data and API keys).
- Migration path for the existing single-user data.

## 2. Paper trading (manual and automated)

**Goal:** a simulated trading environment to test strategies and run simulations without real money.

**Scope**
- **Manual paper trading:** place simulated buy/sell orders from the UI against live (or delayed) prices; virtual cash, positions, P&L, order history.
- **Automated paper trading:** strategies run on live data and place simulated orders on their own.
- **Simulations / backtesting:** replay historical data through a strategy and report results (returns, drawdown, win rate, etc.).

**Things to decide**
- Order model: market/limit/stop, partial fills, slippage, brokerage/taxes/charges modelling (Indian market fees).
- Strategy definition format (code, rule builder, or both) and where it runs (in-browser vs server; background execution needs a server if the tab is closed).
- Portfolio/account abstraction shared with the future live-trading path (see item 3), so a strategy can switch paper → live without changes.
- Historical data source and its limits.

## 3. Auto ordering (live) from signals / charts / strategies

**Goal:** place real orders automatically based on signals, chart conditions or strategies.

**Notes**
- Builds on item 2: strategies should be proven in paper trading first; same execution interface, swapped broker adapter.
- Requires broker order-placement APIs (FYERS, Breeze) and their auth/session constraints.
- Needs a always-on backend runner (cannot rely on an open browser tab).
- Safety: kill switch, max position/loss limits, order confirmation modes, audit log, duplicate-order protection, handling of failed/rejected orders and API outages.
- Regulatory considerations for algorithmic trading in India (broker/exchange rules for API and algo orders) should be checked before building.
- Depends on item 1 if multiple users are supported (per-user credentials and risk limits).

## Suggested order

1. Paper trading core (order/portfolio model, manual) → 2. backtesting and automated paper strategies → 3. multi-user/backend foundation (likely needed for automation anyway) → 4. live auto ordering.

This order is a suggestion; to be discussed.
