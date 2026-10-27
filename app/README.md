# Stock Analyzer (MVP)

Local-first PWA for researching Indian equities and planning trades. No backend. Implements Milestones 1–3 of `../specs`.

```bash
npm install
npm run dev       # http://localhost:5173
npm test          # indicator, rule-engine and trade-maths tests
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

**ICICI Breeze (dev machine only).** Settings → Market data → ICICI Breeze. Breeze cannot be called from a browser (its login is
a GET with a body and its data host has no CORS), so calls go through a small helper built into the Vite dev/preview server
(`vite/breezeHelper.ts`). It is not part of `npm run build` output: an installed or hosted copy has no Breeze access and says so.
Use `npm run dev`, enter your app key, log in with ICICI (or paste the `API_Session` code), then press **Run test** to check each
stage (helper, session, a real history call, symbol map, live feed). No secret key is needed or stored. History is daily bars;
live prices use ICICI's streaming socket and only flow while the market is open.

The helper only accepts requests from this machine's own pages, relays two fixed ICICI endpoints, and never logs request bodies.

Why FYERS is the portable choice and Breeze needs the helper, plus what is still unverified: [`../docs/provider-feasibility.md`](../docs/provider-feasibility.md).

## Layout

| Path | Purpose |
|---|---|
| `src/domain` | Indicators, typed rule engine, ranking, presets, strategies, position sizing. No React, no provider imports. |
| `src/providers` | Provider contract, demo adapter, FYERS adapter (`fyers/`), cache-first loader |
| `src/db` | Dexie schema, settings, candle cache, export/import. Credentials sit in a separate table that export never reads. |
| `src/store.ts` | Zustand app state |
| `src/ui` | Pages and components |

## Not built yet

Journal/paper trading, news feed, alerts, signal lifecycle persistence, backtesting, intraday data, fundamentals,
live tick streaming (quotes are polled each minute), BSE, Capacitor/Tauri wrappers. Placeholder icons in `public/` come from `scripts/make-icons.mjs`; replace before release.
