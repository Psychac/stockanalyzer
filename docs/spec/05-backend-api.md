# 5. Backend API

Vercel serverless functions under `app/api/`. The backend holds **public market data only**: no user data, accounts or credentials. Access to the maintenance endpoints and the Breeze relay is gated by one shared password (`APP_PASSWORD`); there are no accounts and nothing is stored per user.

## 5.1 Endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/data/manifest` | Public | Current manifest: which data files exist and their public URLs. 200 with the manifest; 404 if nothing is published or no Blob store is connected; 502 on a storage error. Edge-cached (`s-maxage=300`, `stale-while-revalidate=3600`). |
| `GET /api/data/ingest` | Signed-in cookie, or `Authorization: Bearer $CRON_SECRET` (the cron) | Daily ingest, also used for backfill and maintenance. 503 if neither `APP_PASSWORD` nor `CRON_SECRET`, or `BLOB_READ_WRITE_TOKEN`, is unset, 401 when not signed in and no valid secret (constant-time compare), 500 on failure. Max duration 300 s; internal budget 240 s. |
| `POST /api/breeze/session` | Optional `X-Relay-Code` | Relays ICICI's session exchange (`/breezeapi/api/v1/customerdetails`). |
| `GET /api/breeze/history` | Optional `X-Relay-Code` | Relays ICICI history v2 (`/api/v2/historicalcharts`). |
| `GET /api/breeze/ping` | Optional `X-Relay-Code` | Reachability check used by the Run test. |
| `POST` (or GET) `/api/breeze/callback` | None | ICICI redirect target: extracts `apisession` and redirects the browser into the app with a GET. |

**Ingest query flags** (same bearer secret): `?refreshMeta=1` re-fetches company metadata and rewrites snapshots even with no new day; `?rebuild=1` discards published history and rebuilds it (two or three runs of about four minutes).

**Breeze relay constraints**: two fixed ICICI hosts and paths; history parameters whitelisted (`interval`, `stock_code`, `exch_code`, `from_date`, `to_date`, `product_type`, `expiry_date`, `right`, `strike_price`) with a value pattern; credentials limited to printable ASCII up to 512 chars; request body at most 4 KB, response at most 5 MB; 9 s upstream timeout (under Vercel's 10 s); same-origin callers only (plus loopback Host check on dev servers); `no-store`; nothing stored or logged. The same module (`api/_lib/breezeRelay.ts`) runs as Vercel functions and inside the Vite dev and preview servers.

## 5.2 Ingest behaviour

Source files (public, per session): NSE `sec_bhavdata_full_DDMMYYYY.csv` and BSE `BhavCopy_BSE_CM_0_0_0_YYYYMMDD_F_0000.CSV`. Index levels from Upstox daily candles; NSE metadata from Upstox's instrument master; industries from the Nifty Total Market list.

1. Read the manifest. If its `dataVersion` is older than `DATA_VERSION` (currently **2**), rebuild automatically.
2. Advance day by day from the last stored date to the latest session, within the time budget. An interrupted run resumes. About 1.4 s per trading day, so a one-year backfill takes about 6 minutes.
3. Skip non-trading days. BSE answers a missing day with HTTP 200 and an HTML page, which is treated as "no file", not an error.
4. Apply each day with the liquidity rule, BSE series filter, and corporate-action back-adjustment (doc 3).
5. Enrich rows with ISIN, name and industry. A metadata failure never blocks prices; it is reported as `metaError`.
6. Write: small days as **delta** files; a long catch-up or a week of deltas folds into new **snapshots**. Rebuild the search list, pulse and (weekly) metadata. Write the manifest last.

Response: `{ applied[], skipped[], stopped, rebuilt?, metaError?, latestDate, wrote[] }`. A run that stops on budget says `"time budget reached; run again to continue"`.

## 5.3 Published files (Vercel Blob, public, gzipped JSON except the manifest)

| File | Contents |
|---|---|
| `data/manifest.json` | See below. Cached 5 minutes. |
| `snapshot-<EX>-<date>-r<rev>.json.gz` | Whole exchange history (`History`: `dates[]`, `stocks{}`), up to 260 sessions |
| `delta-<EX>-<date>.json.gz` | One exchange, one day: `DayRow[]` |
| `indices-<date>.json.gz` | Index OHLC bars (about 270 each) |
| `search-<date>-r<rev>.json.gz` | `[id, symbol, name, isin, sector]` per stock |
| `meta-<date>-r<rev>.json.gz` | NSE symbol to ISIN and name; ISIN to industry |
| `pulse-<date>-r<rev>.json.gz` | Breadth, 52-week highs and lows, top movers per exchange |

Manifest fields: `version`, `dataVersion`, `latestDate`, `snapshots{NSE,BSE}`, `deltas[]`, `indices`, `meta`, `search`, `pulse`, `rev`, `updatedAt`, `urls{file: publicUrl}`. Files are immutable per name and cached for a year; a same-date rewrite gets a new `-rN` name so neither the CDN nor a device cache serves stale bytes.

## 5.4 Hosting constraints (Vercel Hobby)

| Limit | Design response |
|---|---|
| One cron a day, fires within a one-hour window | Single daily ingest at `30 14 * * *` UTC (20:00 IST), after both exchanges publish |
| 300 s function limit | Chunked, resumable backfill |
| 1 GB Blob, 2,000 uploads a month | Overwrite rather than accumulate; about 4 uploads on a normal day, 40 to 60 a month |
| Overage is a hard stop for 30 days | Stay well under; surface clear errors |

## 5.5 Configuration

| Variable | Where | Purpose |
|---|---|---|
| `BLOB_READ_WRITE_TOKEN` | Server | Added by connecting a public Blob store to the project |
| `APP_PASSWORD` | Server | The deployment's one password. `/api/auth` (GET status, POST `{password}` sign in, DELETE sign out) sets a signed, HttpOnly, SameSite=Strict cookie valid 30 days; changing the password signs every device out. Required for the Breeze relay and the in-app Update button on Vercel. Wrong attempts are slowed and locked out per server instance |
| `CRON_SECRET` | Server | Bearer secret for the scheduled cron and scripts calling `/api/data/ingest` |
| `VITE_BREEZE_APP_KEY` | Build | Optional prefill of the Breeze app key. Baked into the bundle, so never a secret. |
| `MARKET_DATA_ORIGIN` | Local dev | Where `npm run dev` proxies `/api/data` |

First-time setup: create the Blob store, set `CRON_SECRET`, then call `/api/data/ingest` with the bearer token repeatedly until it no longer reports hitting the time budget. Details in [`../backend-design.md`](../backend-design.md).

## 5.6 Known risks

- NSE or BSE may later refuse datacenter IPs; reachability from a Mumbai Vercel deployment was confirmed once.
- Exchange redistribution terms must be reviewed before the deployment is shared beyond personal use.
- Upstox endpoints (daily index candles, instrument master, intraday history) are public but undocumented as such and can be closed.
- Live BSE prices have no source.
- The Mumbai region choice is an untested assumption for ICICI.
