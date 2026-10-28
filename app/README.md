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

**Demo (default).** `src/providers/demo.ts` generates deterministic synthetic daily candles for the 50-stock universe.
These are not real prices. The UI shows a `DEMO DATA` badge and `isLive` is hard-coded `false`.

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

- **Search** (top of every page) covers every NSE stock when Breeze is connected. Stocks outside the tracked 50 are fetched on
  demand (one history call) and added to the live feed while you view them. They are never fed to the scanners. The stock list
  is a build-time snapshot of ICICI's instrument master (`src/providers/breeze/master.json`), because that file sends no CORS
  header. Without Breeze, search covers the tracked 50 only.
- **Index strip** on the dashboard shows Nifty 50, Bank Nifty, Nifty IT, Fin Services, Midcap 50 and India VIX: last daily close
  (`EOD`) until live ticks arrive, then `LIVE`. The **Sensex is not available**: it is a BSE index and Breeze does not serve BSE.
- **Live charts** update only the latest candle, so the chart is built once per stock and keeps its zoom.
- Not verified against a real Breeze login: the index history codes, and the index tick layout. **Run test** reports whether index
  ticks arrive.

### Market-wide scans (NSE and BSE)

Discover has a **Stock universe** picker: Tracked 50 (your live source), All NSE, All BSE, or Both. The market-wide choices read
end-of-day data published by this project's own backend (`api/data/*`, a daily Vercel cron that stores files in Vercel Blob), so they
work with any data source, including none.

- First use downloads one file per exchange (about 6 MB each, gzipped) and keeps it in IndexedDB. After that only each day's small
  update is fetched, and a second scan downloads nothing. Measured on the real data: 2,441 NSE stocks scanned in about 3 s.
- Only liquid stocks are included (about 2,400 per exchange), and large scans keep just the matches. Stocks outside the tracked 50
  have end-of-day prices only and no sector.
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
- Backend setup (Blob store, `CRON_SECRET`, first backfill) is in [`../docs/backend-design.md`](../docs/backend-design.md).
- `npm run dev` proxies `/api/data` to the deployed site; set `MARKET_DATA_ORIGIN` to use another deployment.

### Prefilling the app key

Set `VITE_BREEZE_APP_KEY` (see `.env.example`) in a local `.env.local`, or as a Vercel environment variable, and Settings
prefills the app key. It is baked into the built page, so anyone who can open that site can read it; it identifies your Breeze
app but is not a login on its own. Do not hard-code it in source or commit it: this repository is public.

### Deploying the relay on Vercel

1. Import the GitHub repo in Vercel and set **Root Directory** to `app`. The Vite preset and `vercel.json` do the rest.
2. Optional but recommended for a public URL: add `BREEZE_RELAY_CODE`. The relay then refuses every call that reaches ICICI
   without a matching code, and Settings shows a field for it (kept in that browser only).
3. In the Breeze portal set the redirect URL to the callback address above.
4. Open the deployed app, choose ICICI Breeze, log in, and press **Run test**.

`vercel.json` pins the functions to Mumbai (`bom1`). That is an untested assumption about ICICI and foreign IPs.

The relay forwards two fixed ICICI endpoints, accepts only whitelisted parameters and same-origin callers, stores nothing and
does not log request bodies. Your session token passes through the deployment on each call. It has no rate limiting of its own,
so the access code is what stops a stranger spending your function quota.

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
