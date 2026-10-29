# Stock Analyzer (MVP)

Local-first PWA for researching Indian equities and planning trades. Implements Milestones 1–3 of `../specs`.

```bash
npm install
npm run dev       # http://localhost:5173
npm test          # indicators, rule engine, trade maths, providers, Breeze relay
npm run build     # type-check + production build (PWA, installable)
npm run preview   # serve dist/ to test install and offline
```

## Data sources

There is no built-in list of stocks. What the app shows is driven by three things: the **market-wide end-of-day data** (every liquid
NSE and BSE stock, from this project's backend), your **watchlist** (the stocks you star), and **search**. A data source then decides
where the watchlist's prices come from.

**End-of-day (default).** The shared NSE and BSE files. No broker and no account needed; prices update once a day after the close.
The whole-market dashboard panels (breadth, 52-week highs and lows, top movers) come from a small daily summary the backend publishes.

**Demo.** `src/providers/demo.ts` generates synthetic daily candles for 50 made-up-price stocks, the only built-in stock list, so the
app can be explored with no setup. The UI shows a `DEMO DATA` badge and `isLive` is hard-coded `false`. Intraday is refused in demo mode.

**FYERS (live NSE).** Settings → Market data → FYERS. Works as a pure PWA with no server: the browser talks to FYERS directly.

1. In your FYERS API dashboard create an *individual* app with **Market Data** permission only.
2. Register the redirect URL shown in Settings, exactly as shown.
3. Enter the App ID and secret in Settings and connect. Sessions end at 06:30 IST, so reconnect each trading day.

Prices are cached in IndexedDB, so restarts make no history calls until a new session closes, and the app stays usable offline
(labelled `CACHED`). The badge always says what you are looking at: `DEMO DATA`, `LIVE`, `EOD`, `CACHED`, `STALE` or `NO DATA`.

**ICICI Breeze (needs the relay).** Settings → Market data → ICICI Breeze. Breeze cannot be called from a browser (its login is
a GET with a body and its data host has no CORS), so calls go through a small same-origin relay, `api/_lib/breezeRelay.ts`.
The same code runs two ways, at the same `/api/breeze/*` paths:

- **Locally:** `npm run dev` (or `npm run preview`) serves it through a Vite plugin (`vite/breezeHelper.ts`).
- **Deployed on Vercel:** the `api/breeze/*.ts` files are serverless functions.

A plain static host has no relay, and the app says so instead of failing silently. 

Enter your app key, log in with ICICI, then press **Run test** to check each stage (relay, session, a real history call, symbol
map, live feed). No secret key is needed or stored. History is daily bars; live prices use ICICI's streaming socket straight
from the browser and only flow while the market is open.

### Breeze redirect URL

ICICI returns the browser to your redirect URL with a **POST**, which a static page rejects with HTTP 405. Register the callback
function instead, shown in Settings: `https://<your-deployment>/api/breeze/callback` (locally `http://localhost:5173/api/breeze/callback`).
It takes the one-time code from the request and sends the browser into the app with a normal GET. If you are not returned to
the app, copy the value after `apisession=` from the address bar into "Or paste the session code" in Settings.

### Search, indices and live updates (Breeze)

- With Breeze connected, search also lists NSE stocks that the end-of-day list leaves out. Those are fetched on demand (one history
  call) and added to the live feed while you view them, and are never fed to scanners. Breeze's stock list is a build-time snapshot of
  ICICI's instrument master (`src/providers/breeze/master.json`), because that file sends no CORS header.
- **Your watchlist is what gets live prices.** Starring an NSE stock while FYERS or Breeze is connected fetches just that stock's
  history and joins it to the live feed; un-starring drops it. BSE stocks have no live source and stay end-of-day.
- **Index strip** on the dashboard shows Nifty 50, Bank Nifty, Nifty IT, Fin Services, Midcap 50 and India VIX: last daily close
  (`EOD`) until live ticks arrive, then `LIVE`. The **Sensex is not available**: it is a BSE index and Breeze does not serve BSE.
- **Live charts** update only the latest candle, so the chart is built once per stock and keeps its zoom.
- Not verified against a real Breeze login: the index history codes, and the index tick layout. **Run test** reports whether index
  ticks arrive.

### Market-wide scans (NSE and BSE)

Discover has a **Stock universe** picker: All NSE (the default), All BSE, Both, or My watchlist. The market-wide choices read
end-of-day data published by this project's own backend (`api/data/*`, a daily Vercel cron that stores files in Vercel Blob), so they
work with any data source, including none. A watchlist scan keeps non-matches so you can see which rule failed.

- First use downloads one file per exchange (about 6 MB each, gzipped) and keeps it in IndexedDB. After that only each day's small
  update is fetched, and a second scan downloads nothing. Measured on the real data: 2,441 NSE stocks scanned in about 3 s.
- Only liquid stocks are included (about 2,400 per exchange), and large scans keep just the matches. Stocks scanned this way
  have end-of-day prices only, and an industry only where the free Nifty list knows it.
- The index strip (Nifty 50, Bank Nifty, ..., **Sensex**, BSE 500, Bankex) comes from the same backend. It is hidden on demo data.
- **Search** covers every liquid NSE and BSE stock from a small list (tens of KB), without downloading prices. Opening a stock
  loads that exchange's data once. BSE listings show as BSE, and a company on both exchanges appears as two entries.
- **Both** has a "count each company once" option (on by default): a BSE listing is skipped when the same company (same ISIN) is
  on NSE. On real data this removed about 1,600 of 4,600 stocks.
- **Sectors** come from the free Nifty Total Market list (about 750 companies), matched by ISIN, so only about a third of stocks
  have an industry. The rest are Unclassified, and choosing a sector leaves them out.
- The backend filters BSE to real shares (series A, B, T, X, XT, Z and SME, ISIN starting INE), dropping ETFs, funds and bonds.
- **Index charts:** click any index tile (or the big Nifty 50 card) on the dashboard, or pick one under Indices in the chart picker.
  An index chart shows candles, moving averages, range, returns and trend, and deliberately no trade plan, because an index cannot be
  bought directly. It is end-of-day: a live Breeze tick updates the displayed level but not the candles.
- **Timeframes:** every chart (stocks and indices) has 1m, 5m, 15m, 30m, 1h, 1D, 1W and 1M. Weekly and monthly are rolled up from
  daily bars, so they work on every source. Intraday candles come from Upstox's public history endpoint (NSE and BSE stocks by ISIN,
  and indices), fetched only for the chart you are viewing and refreshed every 45 s while the market is open. Upstox documents that
  endpoint as needing a login but does not enforce it today, so it could be closed; the chart says where the data is from and falls
  back gracefully. Intraday is not offered on demo data (synthetic prices must not sit beside real candles). The trade plan is built
  from daily bars, so its levels are drawn on the 1D chart only. Scanners remain daily.
- Backend setup (Blob store, `APP_PASSWORD`, `CRON_SECRET`, first backfill) is in [`../docs/backend-design.md`](../docs/backend-design.md).
- `npm run dev` has no market data of its own: set `MARKET_DATA_ORIGIN` (in `app/.env`, see `.env.example`) to a deployment you control, and it proxies `/api/data` and `/api/auth` there. There is no default. Sign-in passwords typed in dev go to that origin.

### Prefilling the app key

Set `VITE_BREEZE_APP_KEY` (see `.env.example`) in a local `.env.local`, or as a Vercel environment variable, and Settings
prefills the app key. It is baked into the built page, so anyone who can open that site can read it; it identifies your Breeze
app but is not a login on its own. Do not hard-code it in source or commit it: this repository is public.

### Deploying the relay on Vercel

1. Import the GitHub repo in Vercel and set **Root Directory** to `app`. The Vite preset and `vercel.json` do the rest.
2. Add `APP_PASSWORD` (any long random string). It is the one password for the deployment: on the Settings page, sign in
   once per device to use the Breeze relay and the Update button. Without it the relay refuses every call that reaches ICICI.
3. In the Breeze portal set the redirect URL to the callback address above.
4. Open the deployed app, choose ICICI Breeze, log in, and press **Run test**.

`vercel.json` pins the functions to Mumbai (`bom1`). That is an untested assumption about ICICI and foreign IPs.

The relay forwards two fixed ICICI endpoints, accepts only whitelisted parameters and same-origin callers, stores nothing and
does not log request bodies. Your session token passes through the deployment on each call. It has no rate limiting of its own,
so the sign-in is what stops a stranger spending your function quota. Wrong passwords are slowed and then refused, but
serverless instances do not share memory, so use a long random password.

Why FYERS is the portable choice, what is verified and what is not: [`../docs/provider-feasibility.md`](../docs/provider-feasibility.md).

## Layout

| Path | Purpose |
|---|---|
| `src/domain` | Indicators, typed rule engine, ranking, presets, strategies, position sizing. No React, no provider imports. |
| `src/providers` | Provider contract, demo adapter, FYERS and Breeze adapters, cache-first loader |
| `api/` | Breeze relay (Vercel functions plus the shared module the dev server also uses) |
| `src/db` | Dexie schema, settings, candle cache, export/import. Credentials sit in a separate table that export never reads. |
| `src/store.ts` | Zustand app state |
| `src/ui` | Pages and components |

## Not built yet

Journal/paper trading, news feed, alerts, signal lifecycle persistence, backtesting, intraday data, fundamentals, live tick
streaming for FYERS (quotes are polled each minute), BSE, Capacitor/Tauri wrappers. Placeholder icons in `public/` come from
`scripts/make-icons.mjs`; replace before release.
