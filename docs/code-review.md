# Architecture and code-quality review

Date: 2026-10-29. Commit reviewed: `6212473`. Scope: domain, scanner, trade, providers, db, store, ingest, relay, history, parse and chart code. `tsc --noEmit` is clean, 173 of 173 tests pass, `npm audit --omit=dev` reports 4 high findings (see 14).

Not covered: the remaining UI pages, the scanner builder, and any live run of the app, Breeze or FYERS. Each finding says whether it was reproduced or read from the code. None was reproduced by running the app.

## Scorecard

| Dimension | Grade | Why |
|---|---|---|
| Domain design | A- | Pure, deterministic, typed rule engine, with no lookahead (`highest` uses prior bars only). |
| Data pipeline | B | Resumable, versioned and well measured, but it has a data-loss path (finding 1). |
| Provider layer | B+ | Clean contract, typed errors, cache-first loading. |
| State and orchestration | C+ | `store.ts` is a 768-line closure with race conditions. |
| UI | B- | Sound chart lifecycle, but untested, and only 22 `aria-`/`role` attributes across the UI. |
| Security | B- | Relay is carefully narrowed, but the model has gaps (findings 4 to 6). |
| Testing and delivery | C | Unit tests are strong; there is no CI, lint, e2e or monitoring. |
| Documentation | A- | Decisions are recorded with evidence. |

## High findings

**1. The automatic rebuild publishes truncated data. FIXED** (read from the code; the fix is covered by a unit test, not run against Blob or the exchanges).
`advance()` in `api/_lib/data/ingest.ts` rebuilds from `today - 380` days when `dataVersion` is outdated. A rebuild takes about six minutes against a 240 s budget. It used to stop on the budget but still publish the partial history, with `dataVersion` current and `latestDate` months old, and delete the old files in the same run. Clients would have had stale data and no fallback until later runs caught up, and the endpoint returned 200.
Fix applied: a rebuild now accumulates in `manifest.staging`, which clients ignore. It replaces the published data, and the old files are removed, only once it reaches the latest date the old data had. A cut-short run leaves what clients see untouched and the next run resumes. While staging, runs write full snapshots instead of deltas (a few more uploads) so file names cannot collide with live ones.

**2. A permanent ingest failure stalls silently. PARTLY FIXED** (unit-tested only, not run on Vercel or in a browser).
Any `error` outcome (a 5xx, or a changed CSV header giving `unexpected columns`) sets `stopped` and breaks, and the same day fails on every later run. The cron answered 200 with `stopped` in the body, and the app only showed an aging "as of" date.
Fix applied: the endpoint returns 502 for a stop that needs attention (not the time budget, "not published yet" or "only one exchange"), with the same body, and the Settings button reads that body as a partial run. Dashboard and Discover show a warning once data is 2 or more trading days old (exchange holidays are not known, so it can overcount around them).
Not done: skipping a repeatedly failing day. It needs extra state, and it would silently drop days after a changed CSV header, so a bad day keeps blocking, loudly.

**3. A partial day is applied silently. MADE VISIBLE, NOT BLOCKED** (unit-tested only).
If one exchange file is missing for a day older than yesterday, `rows` holds only the other exchange. The day is still applied and the missing exchange's stocks get zero bars for it. The corporate-action check still runs on the next day against each stock's last real close, so a split is not missed; the harm is a one-day gap, not wrong prices.
Not changed to an error as first proposed: applying such a day is deliberate (a genuine one-exchange holiday), and an error would stall every later day, as in finding 2.
Fix applied: `advance()` returns `oneSided: [{date, missing}]` for these days. It is only in the run response, not stored in the manifest or shown in the app.

**4. The relay's origin protection only stops browsers. REPLACED BY A SIGN-IN; no rate limit** (unit-tested only, not run on Vercel).
`allowed()` in `api/_lib/breezeRelay.ts` checks the custom header, `Sec-Fetch-Site` and `Origin`. A script can send `X-Breeze-Helper: 1` and omit the others. With no shared code configured, anyone could use the relay. It holds no credentials and forwards the caller's own ICICI key and session, so an anonymous caller without valid credentials only gets ICICI errors; the real cost is function quota and a free proxy for whoever holds credentials. That makes it medium, not high.
Fix applied: `BREEZE_RELAY_CODE` is gone. One password (`APP_PASSWORD`) now gates the relay and the in-app Update button. `/api/auth` sets a signed, HttpOnly, SameSite=Strict cookie (30 days; changing the password signs everyone out). On Vercel the relay refuses every call that reaches ICICI without it. Local dev needs no sign-in. `CRON_SECRET` stays for the scheduled cron and scripts only.
Not done: real rate limiting. Functions are stateless, so failed sign-ins are only slowed and locked out per server instance; use a long random password. `ping` and `callback` still need no sign-in.

**5. Secrets handling. PARTLY FIXED** (headers read from config only; nothing run in a browser).
The FYERS app secret is stored in IndexedDB when "remember" is checked and in `sessionStorage` during the login round-trip; the token exchange runs in the browser. An XSS would take it. There is no `innerHTML` or `dangerouslySetInnerHTML` in the code, but also no CSP, and `vercel.json` set no security headers.
Fix applied: `vercel.json` now sends `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and `X-Frame-Options: DENY`. The Content-Security-Policy is **Report-Only** for now, because I could not exercise the deployed app in a browser; open the console on a deployed copy, check for violations, and rename the header to `Content-Security-Policy` once it is clean. Also, the ingest secret and the relay code are no longer kept in `localStorage` (replaced by the cookie; old copies are removed on load), so two fewer secrets sit in the browser.
Not done: the FYERS secret still lives in the browser, because FYERS is a pure PWA by design (the token exchange needs the secret). Moving it server-side would break that.

**6. Hard-coded personal deployment URL in a public repo.**
`vite.config.ts` proxies `/api/data` to `https://stockanalyzer-ivory.vercel.app` by default, so anyone cloning the repo sends dev traffic to that deployment.
Fix: require `MARKET_DATA_ORIGIN` explicitly, with no default.

## Medium findings

**7. Stale-snapshot overwrite in `pollQuotes`** (`src/store.ts`, about lines 238 to 277).
It reads `sets`, `extras` and `benchmark` before `await provider.getQuotes(...)`, then builds `new Map(sets)` from that old snapshot. If `attachLive` or `removeFromShortlist` changes `sets` during the await, the write reverts it. After a source switch, the old source's data can land in the new source's state.
Fix: re-read `get()` after the await and give each load a generation token.

**8. No concurrency control on `loadMarket` or `setSource`.**
Rapid switching interleaves loads. `scanRunning` guards market scans only; the watchlist `run` has no guard.

**9. Import is only half validated** (`src/db/db.ts`, `importData`).
Scanners go through Zod, but shortlist rows and settings are written as-is, so a hand-edited file with `capital: "x"` gives NaN sizing. The `schema` field is written but never checked.

**10. `store.ts` structure.**
Module-level mutable state (`pollTimer`, `streaming`, `streamStartedAt`) sits beside closure maps (`applied`, `marketHist`, `setCache`). The benchmark builder is duplicated in `marketBenchmark` and `runMarketScan`, and the two differ on the NSE fallback. There are 15 `catch` sites, several empty, which hides real failures.
Suggested slices: live feed, market data, scanners, shortlist, auth.

**11. Memory and recomputation.**
A market-wide scan holds both exchanges' full histories as arrays (about 6 MB gzipped each, tens of MB decompressed). It measured about 3 s for 2,441 stocks, fine on a desktop; low-end Android is unmeasured. `PriceChart` recomputes indicators over the full series on every live update, cheap at 260 daily bars but wasteful for 1-minute bars.

**12. Weak points in the corporate-action adjustment.**
`applyDay` compares each row's previous close with the stored last close and back-adjusts when they differ by more than 0.05%. It works on integer paise and compounds, so rounding error accumulates. If exchanges ever differ on previous close (for example around dividends), it misfires. The only guard is a ratio between 0.01 and 100. Tests use synthetic rows; there is no fixture from a real split.

**13. Legal and operational dependence.**
The ingest sends a browser-like user agent to NSE and BSE and redistributes their data from a public Blob. Three Upstox endpoints (index candles, instrument master, intraday) are public but not documented for this use, and intraday has no fallback if closed. Nothing detects breakage.

**14. Dependency audit.**
`npm audit --omit=dev` reports four high findings: `@vercel/blob`, `@vercel/oidc`, `@vercel/cli-config` and `zod`. The Zod advisory is memory exhaustion on oversized collections; here it only affects a user importing a hostile file into their own browser. The Vercel packages run server-side only.

## Low findings

- Holidays are not modelled in market hours, bar finality or `validUntil`.
- `init` registers a `hashchange` listener with no teardown; StrictMode registers it twice in dev.
- A failed FYERS or Breeze login switches the saved data source to that provider.
- The scanner schema accepts `15m`, which cannot run.
- Chart effects depend on `options` object identity; a new object each render rebuilds the chart. Not confirmed whether `Charts.tsx` memoises it.
- `openStock` falls back to `get().instruments[0]?.id ?? id` when Breeze is unavailable.
- The Breeze live path is covered only by synthetic ticks. There are no component or browser tests, although `main.tsx` mentions browser tests injecting state.
- The commit history includes a "dummy commit".

## Strengths

- The domain engine has no UI or network imports, and `history.ts` is shared by server and client.
- Constant-time secret compare, relay size and timeout caps, one-time code stripped from the URL before exchange, CSV header checks, and a guard against a file for another date.
- Honest UI: data badge, "missing never passes", explanation checklists.
- Revisioned publishing with the manifest written last and old files deleted after.

## Priority plan

| # | Action | Effort |
|---|---|---|
| 1 | Stage rebuilds and swap on completion (1) | 0.5 day |
| 2 | Non-200 on stalled ingest, plus a staleness warning in the UI (2, 3) | 0.5 day |
| 3 | CI with `tsc`, `vitest`, `build`, and ESLint with no-empty-catch | 0.5 day |
| 4 | Re-read state after `await` in `pollQuotes`, add a load-generation token (7, 8) | 0.5 day |
| 5 | Mandatory relay code in production, security headers and a CSP (4, 5) | 0.5 day |
| 6 | Zod-validate the full import file and check `schema` (9) | 2 hours |
| 7 | Remove the hardcoded dev proxy default (6) | 15 minutes |
| 8 | Split `store.ts` into slices (10) | 2 to 3 days |
| 9 | Add a holiday calendar, an end-to-end smoke test, and a real split-day fixture (12) | 2 days |
