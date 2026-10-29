# 1. Product

Local-first PWA for researching Indian equities (NSE and BSE) and planning trades. **Research and planning only: it never places orders.** Signals are rule-based and advisory; every score is explained and none is a probability. Single user, no accounts, no per-user server state.

## 1.1 Navigation

Sidebar on desktop; bottom bar on mobile (Dashboard, Discover, Shortlist, Charts, Settings). A global **search box** sits above every page. Journal and News appear in the desktop sidebar marked "Soon" and render a placeholder (`Planned`).

| Route | Page | Status |
|---|---|---|
| `dashboard` | Dashboard | Built |
| `discover` | Discover (scanners) | Built |
| `shortlist` | Shortlist (watchlist) | Built |
| `charts` | Charts | Built |
| `settings` | Settings | Built |
| `journal` | Journal | Placeholder (Milestone 6) |
| `news` | News and disclosures | Placeholder (Milestone 5) |

## 1.2 Dashboard

- **Index strip**: Nifty 50, Sensex, Bank Nifty, Nifty IT, Fin Services, Bankex, Midcap 50, Nifty 500, BSE 500, India VIX. Each tile shows `EOD` (last daily close) or `LIVE` (Breeze tick). Click a tile to open its chart. Hidden on demo data. Sensex and the BSE indices are always end-of-day.
- **Nifty 50 card** with sparkline.
- **Market breadth** per exchange: advancers, decliners, unchanged, 52-week highs and lows. From the backend's daily summary (`pulse`); computed locally from the synthetic stocks in demo mode.
- **Top movers**: gainers and losers per exchange, liquid stocks only (average turnover at least Rs 5 crore a day).
- **Setups to review**: for each watchlist stock, both built-in strategies are evaluated; stocks in `entry_eligible` or `setup_forming` are listed, eligible first, then by score.
- **Your watchlist**: last price, day change, 30-bar sparkline.

## 1.3 Discover

- **Scanner picker** with seven built-in presets plus user scanners. Presets are read-only; **Duplicate** makes an editable copy. Import and export a scanner as JSON.
- **Scanner builder**: name, description, timeframe, nested ALL/ANY groups of rules, universe filters (min and max price, min average traded value in Rs crore, sectors), four ranking weights. Saving an existing scanner increments its `version`. Invalid rules block saving with a message (see doc 4).
- **Stock universe**: `All NSE` (default), `All BSE`, `Both`, `My watchlist`. `Both` has "Count each company once" (default on): a BSE listing is skipped when the same ISIN is on NSE.
- **Running**: market-wide choices download the exchange file once (about 6 MB gzipped each), then scan in chunks with a progress bar. Large scans keep **matches only**; a watchlist scan keeps everything and offers "show all" so you can see which rule failed.
- **Results**: ranked list (matched first, then score). Each row expands to show the rule tree with pass, fail or missing per condition, and the four-factor score breakdown. Rows can be starred into the watchlist or opened in Charts.
- The last run per scanner is cached in IndexedDB and shown offline.
- Presets that need data the app lacks (`Intraday VWAP momentum`, `Quality at a reasonable price`) are listed but blocked, with the reason shown.

## 1.4 Shortlist

The watchlist. Starring a stock anywhere adds it (status `Watching`, source recorded, e.g. the scanner name). Items are grouped by status: **Watching, Researching, Ready to plan, Rejected**, each with a free-text note. With FYERS or Breeze connected, NSE stocks here get live prices (see doc 3); BSE stocks stay end-of-day. Un-starring removes the stock from the live feed.

## 1.5 Charts

- **Stock chart**: candlesticks, optional SMA 20/50/200, EMA 20, volume, RSI 14 and MACD panes, TradingView Lightweight Charts, intraday times shown in IST.
- **Timeframes** (stocks and indices): 1m, 5m, 15m, 30m, 1h, 1D, 1W, 1M. See doc 3 for where each comes from.
- **Trade plan overlay** (stocks, 1D only): one plan per strategy showing state, entry zone, stop, two targets, reward/risk, score, validity window, and a **"Why this state"** checklist with weighted checks. Levels are drawn on the chart.
- **Position size**: from Settings (capital, risk %, max position %, costs): shares, planned risk, capital needed, estimated costs, and what limited the size. Marked "hypothetical" unless the state is `entry_eligible`.
- **Index chart**: candles, moving averages, range, returns, trend. Deliberately **no trade plan**, because an index cannot be bought directly. Live Breeze ticks update the headline level but not the candles.
- Live charts update only the latest candle, so zoom is preserved.

## 1.6 Search

Searches every liquid NSE and BSE stock from a small list (tens of KB, no price download), plus, with Breeze connected, NSE stocks missing from that list (fetched on demand, one history call, never fed to scanners). Opening a stock loads that exchange's data once. A company on both exchanges appears as two entries. BSE results show an exchange tag.

## 1.7 Settings

- **Risk and sizing**: capital (default Rs 5,00,000), risk % per trade (1), max position % (25), round-trip cost % (0.3), reward/risk targets (2 and 3).
- **Price source**: End-of-day (default), Demo, FYERS, ICICI Breeze, each with its connection form and instructions. Breeze has a staged **Run test** (relay, session, history call, symbol map, live feed).
- **Market-wide data**: what is downloaded per exchange (date, revision, stock count), refresh, and remove.
- **Backup and restore**: export and import JSON (scanners, shortlist, settings). **Credentials are never exported.**
- **Local data**: erase everything on the device.

## 1.8 Data honesty rules

- A badge states what you are looking at: `DEMO DATA`, `LIVE`, `EOD`, `CACHED`, `STALE`, `NO DATA`. Demo data never claims to be live (`isLive` is hard-coded false) and is never mixed with real candles.
- Missing inputs never pass a condition: a rule lacking history is "missing" and counts as not met, with a warning.
- A forming (unclosed) candle marks results provisional.
- Every dashboard and chart disclaimer states signals are not advice.

## 1.9 Not built

Journal and paper trading, news and disclosures, alerts and notifications, persisted signal lifecycle (target hit, stop hit, expired), backtesting and replay, fundamentals (so the `Quality` preset is inert), intraday scanners, live tick streaming for FYERS (quotes are polled each minute), live BSE prices, cross-device sync, Capacitor and Tauri wrappers, final app icons (placeholders from `scripts/make-icons.mjs`).
