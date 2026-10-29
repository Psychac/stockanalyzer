# 3. Market data

## 3.1 Data sources

`DataSource = 'demo' | 'fyers' | 'breeze' | 'market'`. The source decides where the **watchlist's** prices come from; market-wide scans always use the backend's end-of-day data regardless of source. Default for new installs: `market`.

| Source | Needs | Coverage | Freshness |
|---|---|---|---|
| `market` (End-of-day) | Nothing | Every liquid NSE and BSE stock | Daily, after the close |
| `demo` | Nothing | 50 synthetic stocks, made-up prices, benchmark `NSE:NIFTY50` | Static. Intraday refused. |
| `fyers` | FYERS app ID and secret; daily login | NSE | Daily history plus quotes polled each minute |
| `breeze` | ICICI app key; daily login; relay | NSE only (no BSE, no MCX) | Daily history plus live ticks over a socket while the market is open |

### FYERS

Pure PWA: the browser calls FYERS directly (CORS is open). OAuth-style login: redirect to `generate-authcode`, return with `auth_code` to the registered redirect URL, `POST validate-authcode`. Auth header `app_id:access_token`. Symbols are `NSE:<SYMBOL>-EQ`; benchmark `NSE:NIFTY50-INDEX`. History is chunked to 365 days per call; quotes in batches of 50. Rate limited by `RateLimiter` (plan: 5 calls/s, 50/min, 5,000/day). **Sessions end at 06:30 IST**; the app reconnects each trading day.

### ICICI Breeze

Needs the relay because the session exchange is a GET with a JSON body and the data host sends no CORS headers. Flow: user logs in at ICICI; ICICI **POSTs** the one-time code to the registered redirect, which must be `https://<deployment>/api/breeze/callback`; the callback redirects into the app with a GET carrying `apisession`. A manual "paste session code" fallback exists. History v2 needs only `X-SessionToken` and `apikey` headers, no secret or checksum. Daily bars only. Live prices use ICICI's socket.io stream directly from the browser (join channel `4.1!<token>`, 21-field NSE quote array). Symbols are mapped from `master.json`, a **build-time snapshot** of ICICI's instrument master (that file has no CORS header). Index codes: benchmark is the NIFTY BeES ETF (`NIFBEE`) for the stream; other index history codes and the index tick layout are **unverified against a real login**; Run test reports whether index ticks arrive.

### Provider contract (`src/providers/types.ts`)

```ts
interface MarketDataProvider {
  id: DataSource; label: string; isLive: boolean   // demo is never live
  connect(); disconnect(); getConnectionStatus()
  getInstruments?()                                 // demo only
  getHistoricalCandles(instrument, interval, bars): Promise<CandleSet>
  getCandlesSince?(instrument, interval, sinceMs): Promise<Candle[]>
  getQuotes(instruments): Promise<Quote[]>
}
```

Errors are `ProviderError` with kind `auth | rate | network | api`; `auth` and `rate` stop a batch load.

## 3.2 Feed status and the data badge

`Feed.mode` is one of `demo | eod | live | cached | stale | none`, shown as a badge (`DEMO DATA`, `EOD`, `LIVE`, `CACHED`, `STALE`, `NO DATA`). A banner appears for `cached`, `stale` and `none` states or whenever a message needs attention. The sidebar shows "Prices as of <date> close" or "Session in progress". Market hours are 09:15 to 15:30 IST on weekdays; **exchange holidays are not modelled**. A daily bar is treated as final a short settling delay after the bell.

## 3.3 Watchlist live prices

Starring an NSE stock while FYERS or Breeze is connected fetches only that stock's history and joins it to the live feed; un-starring drops it. BSE stocks, and everything scanned market-wide, are end-of-day only. Stocks found through Breeze-only search are fetched on demand and are never scanned.

## 3.4 Market-wide end-of-day data

Published by the backend (doc 5), downloaded by the client.

- **Content**: per stock, arrays of open, high, low, close (integer paise) and volume aligned to a shared `dates` list; up to **260 sessions**; one history per exchange.
- **Liquidity rule** (identical on server and client): a stock is admitted on a day its turnover reaches Rs 50 lakh; it is dropped when its average turnover falls under Rs 25 lakh. Result: about 2,400 stocks per exchange.
- **BSE filter**: real shares only (series A, B, T, X, XT, Z and SME with an ISIN starting `INE`); ETFs, funds and bonds are dropped.
- **Corporate actions**: bhavcopy prices are unadjusted, so each row's previous close is compared with yesterday's stored close; a difference above 0.05% back-adjusts that stock's history by the ratio, so splits and bonuses do not look like crashes.
- **Sync** (`syncExchange`): a cache whose revision is current and date is latest costs nothing; one at or after the snapshot date applies only the daily delta files; otherwise the snapshot is downloaded and deltas applied on top. A rewrite with the same date carries a higher `rev`, which forces clients with older caches to download again.
- **Identity**: `NSE:<SYMBOL>` and `BSE:<code>` are different instruments. ISIN links them for display and for the "count each company once" option.
- **Metadata**: NSE ISIN and name come from Upstox's public instrument master; industry comes from the free Nifty Total Market list by ISIN (about 750 companies, so about a third of stocks). The rest are `Unclassified`; choosing a sector excludes them.
- **Benchmarks** for relative strength: `NSE:NIFTY500` for NSE stocks, `BSE:BSE500` for BSE stocks.
- **Indices** published daily (about 270 bars each): Nifty 50, Bank Nifty, Nifty IT, Nifty Fin Service, Nifty Midcap Select, Nifty 500, India VIX, Sensex, BSE 500, Bankex.
- **Pulse**: a small daily summary (breadth, 52-week highs and lows among stocks with about 6 months of history, top movers) so the dashboard downloads no prices.
- **Search index**: every stock as `[id, symbol, name, isin, sector]`, about 65 KB gzipped.
- **Degradation**: if the backend is unreachable, the device cache stays usable and is labelled stale. Cached data is public and re-downloadable, so it is excluded from export.

## 3.5 Chart timeframes

| Timeframe | Source | History |
|---|---|---|
| 1D | Active source (market, FYERS, Breeze, demo) | up to 260 sessions |
| 1W, 1M | Rolled up from daily bars (`aggregate`), so they work on every source. The last bar is "forming" until its period ends (a week ends with Friday). | derived |
| 1m, 5m, 15m, 30m, 1h | **Upstox public history endpoint** (`api.upstox.com/v3/historical-candle`), keyed by `<EXCHANGE>_EQ|<ISIN>` or an index key, fetched only for the chart in view and refreshed every 45 s while the market is open | 1m: 6 days; 5m and 15m: 30 days; 30m and 1h: 90 days |

Intraday caveats: Upstox documents the endpoint as needing a login but does not enforce it today, so it **could be closed at any time**; the chart names its data source and falls back gracefully, leaving the daily chart untouched. A stock whose ISIN is unknown has no intraday. Demo data refuses intraday, because synthetic prices must not sit beside real candles. The trade plan is built on daily bars and drawn on the 1D chart only. **Scanners remain daily.**
