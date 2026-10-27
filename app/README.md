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

**ICICI Breeze (needs the relay).** Settings → Market data → ICICI Breeze. Breeze cannot be called from a browser (its login is
a GET with a body and its data host has no CORS), so calls go through a small same-origin relay, `api/_lib/breezeRelay.ts`.
The same code runs two ways, at the same `/api/breeze/*` paths:

- **Locally:** `npm run dev` (or `npm run preview`) serves it through a Vite plugin (`vite/breezeHelper.ts`).
- **Deployed on Vercel:** the `api/breeze/*.ts` files are serverless functions. See below.

A plain static host has no relay, and the app says so instead of failing silently.

Enter your app key, log in with ICICI (or paste the `API_Session` code), then press **Run test** to check each stage (relay,
session, a real history call, symbol map, live feed). No secret key is needed or stored. History is daily bars; live prices
use ICICI's streaming socket straight from the browser and only flow while the market is open.

### Deploying the relay on Vercel

1. Import the GitHub repo in Vercel and set **Root Directory** to `app`. The Vite preset and `vercel.json` do the rest.
2. Optional but recommended for a public URL: add an environment variable `BREEZE_RELAY_CODE`. The relay then refuses every call
   that carries no matching code, and Settings shows a field for it (kept in that browser only).
3. In the Breeze API portal, set your app's redirect URL to the deployed address (Settings shows the exact value).
4. Open the deployed app, choose ICICI Breeze, log in, and press **Run test**.

`vercel.json` pins the functions to Mumbai (`bom1`), because ICICI may treat foreign data-centre IPs differently. That is an
untested assumption: nothing here has been run from Vercel's network.

What the relay does and does not do: it forwards two fixed ICICI endpoints, accepts only whitelisted parameters and same-origin
callers, stores nothing, and does not log request bodies. Your session token does pass through the deployment on each call,
so treat the Vercel project as holding that trust. It has no rate limiting of its own, so the access code is what stops a
stranger spending your function quota.

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
