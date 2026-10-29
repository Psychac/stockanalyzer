# 2. Architecture

## 2.1 Stack

TypeScript, React 19, Vite 8, Tailwind 4, Zustand (state), Dexie over IndexedDB (storage), Zod (scanner schema), TradingView Lightweight Charts, socket.io-client (Breeze stream), `vite-plugin-pwa`, Vitest. Backend: Vercel serverless functions, Vercel Blob, one Vercel cron. All of it lives under [`app/`](../../app).

## 2.2 Layers

| Layer | Path | Rule |
|---|---|---|
| Domain | `src/domain` | Indicators, typed rule engine, ranking, presets, strategies, position sizing, time and timeframes. **No React and no provider imports.** Deterministic, unit-tested. |
| Providers | `src/providers` | `MarketDataProvider` contract plus adapters: `demo`, `fyers`, `breeze`. `loader.ts` is the cache-first loader. |
| Market | `src/market` | Client for the shared backend (`client.ts`), intraday candles (`intraday.ts`), breadth summary for demo (`pulse.ts`). |
| Persistence | `src/db` | Dexie schema, settings, candle cache, market cache, credentials, export/import. |
| State | `src/store.ts` | One Zustand store: route, data source, loaded candle sets, feed status, shortlist, scanners, scan runs, indices. |
| UI | `src/ui` | Pages (`pages/`) and components (`components/`). |
| Backend | `api/` | Vercel functions. `api/_lib` holds shared modules (underscore keeps Vercel from routing them). |
| Dev helper | `vite/breezeHelper.ts` | Serves the same Breeze relay inside `vite dev` and `vite preview`. |

`api/_lib/data/history.ts` is pure TypeScript and imported by **both** the server ingest and the browser client, so both apply daily updates identically.

## 2.3 Data flow

1. **Startup** (`init`): open the database, load settings, shortlist, scanners, cached scan runs, credentials and the chosen data source.
2. **Universe**: demo mode loads 50 synthetic stocks. Otherwise there is **no preset list**: what is loaded is the watchlist (and the stock being viewed). Market-wide data comes from the backend on demand.
3. **Candles** reach the UI as `CandleSet { instrument, timeframe, candles, source, asOf }`. Candle times are UTC epoch ms; a daily bar is stamped with the 09:15 IST open of its date.
4. **Live providers** load cache-first (`loader.ts`): a series fetched after the last session close is reused with zero network calls; otherwise only the gap is requested. An expired token or rate block stops further calls and leaves cached data marked stale.
5. **Scans** run over lazily built candle sets, in chunks that yield to the browser, so thousands of stocks never sit in memory as objects at once.

## 2.4 Storage (IndexedDB database `stock-analyzer`)

| Table | Key | Contents | Exported? |
|---|---|---|---|
| `scanners` | `id` | User scanner configs (presets are code, not rows) | Yes |
| `shortlist` | `instrumentId` | Watchlist items: status, note, addedAt, source | Yes |
| `settings` | `key` | `settings`, `dataSource`, `marketMeta:NSE/BSE` | `settings` only |
| `scanRuns` | `id` = scanner id | Last run per scanner | No |
| `candles` | `<source>:<instrument id>` | Per-provider candle cache | No |
| `market` | `NSE` / `BSE` | Whole-exchange history downloaded from the backend | No |
| `credentials` | `fyers` / `breeze` | App IDs, secrets, sessions | **Never** |

Schema versions are additive: v1 user data, v2 candle cache and credentials, v3 market cache. Candles are cached **per provider** because FYERS and Breeze adjust and stamp bars differently and must never mix. Export carries `app: 'stock-analyzer'`, `schema: 1`; import validates every scanner with Zod and rejects other files.

## 2.5 Security and privacy rules

- No provider secret in the bundle or the repository (it is public). `VITE_BREEZE_APP_KEY` is optional, identifies the app only, and is visible to anyone who opens the site.
- Credentials live in their own table and are excluded from export.
- No user data or credential is stored on the server.
- The Breeze relay is stateless, forwards two fixed ICICI endpoints, accepts only whitelisted parameters and same-origin callers, never logs bodies, and, when deployed, answers only a browser signed in with the deployment's password (`APP_PASSWORD`, see the backend spec). It has no rate limiting of its own.
- The FYERS app is created with **Market Data permission only**; the app never has trading rights.
- Display of third-party chart library attribution is included in the UI.

## 2.6 Deployment

| Target | How |
|---|---|
| Static PWA | `npm run build` (type-check plus Vite build). Installable and works offline for cached data. |
| Vercel | Root Directory `app`. Functions pinned to Mumbai (`bom1`), an untested assumption about ICICI and foreign IPs. Cron `30 14 * * *` UTC (20:00 IST) calls `/api/data/ingest`. |
| Local | `npm run dev` on port 5173. Serves the Breeze relay through a Vite plugin and proxies `/api/data` and `/api/auth` to the deployment named by `MARKET_DATA_ORIGIN` (no default; without it dev has no market data). |

A plain static host has no relay and no backend data; the app says so rather than failing silently, and falls back to demo data and cache.

## 2.7 Testing

Vitest suites cover indicators, the rule engine and trade maths (`domain.test.ts`), features (`features.test.ts`), timeframes, the market client, FYERS and Breeze providers, the Breeze relay, and the backend ingest, parsing, history and pulse code (`api/_lib/data/data.test.ts`). Live network behaviour of Breeze (index codes, tick layout) is covered by synthetic fixtures only. There are no end-to-end browser tests.
