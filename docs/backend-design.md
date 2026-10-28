# Shared backend: market-wide data (design)

Status: designed, not built. Only the reachability probe (`api/data/probe.ts`) exists.
Spec basis: §4.5. Facts below were read from Vercel's docs on 2026-10-28 and from live requests made from a developer PC
(not from Vercel's network; the probe exists to close that gap).

## Problem

Breeze returns one stock per call (100/min, 5,000/day), so a market-wide scan of ~3,000 NSE plus ~5,000 BSE names is impractical
per user. Sites like Chartink avoid this by ingesting bulk data once on a server and sharing it.

## Vercel Hobby limits that shape the design

| Limit | Value | Consequence |
|---|---|---|
| Cron | once per day, fires anywhere in a one-hour window | one ingest per day; schedule after both exchanges publish |
| Function duration | 300 s max (fluid compute) | backfill must be chunked and resumable |
| Blob storage | 1 GB average | store compact files, overwrite rather than accumulate |
| Blob uploads/lists | 2,000 per month | about 3 writes a day is fine; never write per symbol |
| Blob reads | 10,000 simple ops, cache hits are free | publish public blobs so the CDN serves them |
| Overage | hard stop for 30 days, no charges | stay well under; surface a clear error |

## Data sources (checked from a dev PC, 2026-10-28)

| Source | Result | Notes |
|---|---|---|
| NSE `sec_bhavdata_full_DDMMYYYY.csv` | 200, 398 KB, 3,531 rows (2,712 EQ) | OHLC, prev close, volume, delivery %. NSE is known to block datacenter IPs: unverified from Vercel |
| BSE `BhavCopy_BSE_CM_0_0_0_YYYYMMDD_F_0000.CSV` | 200, 856 KB, 5,016 rows | OHLC, prev close, volume, ISIN |
| Upstox daily candles, no token | Sensex, BSE and NSE equity all work | undocumented that no token is needed; can be closed any time |
| Upstox instrument masters | NSE, BSE, complete JSON | maps symbols and ISINs to instrument keys |

## Design

1. **Daily ingest (cron, once).** Download the NSE and BSE files for the latest session, normalise rows to
   `{exchange, symbol, isin, o, h, l, c, prevClose, volume}`, and publish a **delta file** for that day plus an updated
   **manifest**. Index levels (Nifty, Sensex and others) come from Upstox. About 3 blob writes a day.
2. **Clients do the screening.** On first run a client downloads one compact **snapshot** (about 260 sessions of close, high, low,
   volume per symbol, typed arrays, gzipped), caches it in IndexedDB, and afterwards fetches only the small daily delta. The
   existing scanner engine then runs over thousands of stocks locally, so server cost does not grow with users.
3. **Bootstrap (one-off, resumable).** Backfill about 260 sessions by walking back through the daily files, N days per invocation,
   recording progress in the manifest so a re-run continues instead of restarting.
4. **Corporate actions.** Bhavcopy prices are unadjusted. Each row carries the previous close, so when yesterday's stored close
   differs from today's prev close, back-adjust that symbol's history by the ratio. Without this a split looks like a crash.
5. **Identity.** NSE and BSE listings of one company are separate instruments (spec §10). ISIN links them for display only.
6. **Fallback.** If the backend or a source is down, the client keeps its cache and labels it stale. Breeze remains for per-stock
   history and live ticks.

## Open risks

- NSE and BSE may refuse Vercel's IPs. Run the probe first. Fallbacks: Upstox per-symbol candles (50 requests/s, chunked), or a GitHub
  Actions job that publishes the same files.
- Exchange terms on redistributing data. Fine for personal use; review before sharing the deployment.
- Live BSE prices are still unsolved (Breeze has no BSE; Upstox live needs a login).
- Exchange holidays: a missing file is expected, not an error.
