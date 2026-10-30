# Persistence layer: design proposal

Status: proposal; direction decided 2026-10-30 (see section 9). Nothing here is built. Facts about vendor limits are recalled, not checked: verify them before committing.

Decided: **no hosted database service; libSQL/SQLite files are the database everywhere.** Locally (dev, backfill, analytics) it is a libSQL file; on Vercel the same kind of file is stored in **Blob** as immutable **shards** (plus one small open shard rewritten daily), which functions and devices fetch and query. The backend stays and is used fully; the device cache cap is adaptive and can be large; there is one user for now, so sync (section 7A) is an optional backup only.

Corrections (2026-10-30): (1) an earlier version specified Turso's hosted service; that was my misreading. (2) A later version published packed files in a second format instead of database files. That ignored the intent that libSQL be present on both local and Blob. My objection to "a database in Blob" only applies to one large file edited in place; sharded files avoid it.

Written for: you, as the basis for the persistence work. Builds on [backend-design.md](backend-design.md), [v2-proposal.md](v2-proposal.md) and [personal-quant-workbench-mvp-spec.md](personal-quant-workbench-mvp-spec.md).

## 1. Why change

Measured on 2026-10-30 (headless Chrome, synthetic 3,500 stocks): Dexie handles 10 years fine (full read 0.7 to 1.3 s), but a 10-year archive is about 100 MB gzipped to download and 160 MB on disk. A phone should not hold that, and the current design cannot grow past one year:

| Today | Consequence |
|---|---|
| `MAX_SESSIONS = 260`, illiquid stocks pruned, vanished stocks dropped | No backtest history, survivorship bias |
| `adjustPast` rewrites stored prices in place | Raw prices are destroyed; the adjustment cannot be audited or redone |
| One snapshot blob per exchange, rebuilt whole | A 10-year version is about 150 MB of JSON per exchange in one function's memory |
| India-only ids (`NSE:SYM`), paise hard-coded | Adding US or other markets means a rewrite |

Goals: a queryable workbench database for building and checking the archive; published, immutable, cacheable files for serving; a small, evictable working set on the device; point-in-time and reproducible data; multi-market from day one; whole-market analytics computed once at ingest.

## 2. Architecture

```
 Exchange files (raw, public, still downloadable for years: spike 3)
        |  same pure ingest code, per-market adapters
        +--------------------------------+-------------------------------------+
        | LOCAL (dev machine)            | VERCEL CRON (daily, open shard only) |
        v                                v                                      |
  WORKBENCH: libSQL file             downloads the open shard from Blob         |
  full schema (section 4) incl.      to /tmp, applies the day in one SQL        |
  row-per-bar; backfill,             transaction, uploads the new revision,     |
  corrections, analytics             writes the manifest last                   |
        |  publish = build shards            |                                  |
        v                                    v                                  |
  SHARDS: libSQL/SQLite files, same format everywhere  <-----------------------+
   closed shards (immutable) + core shard + open shard + manifest
   Production: Vercel Blob (CDN)       Dev: a local folder served by the dev server
        |                    |
        v                    v
  VERCEL FUNCTIONS:       DEVICE: download shards, import into SQLite WASM
  fetch a shard to /tmp,  (OPFS), query locally; chunk cache (LRU) + user tables
  query it with libSQL
```

Principles:

1. **Store facts, derive parameters.** Raw bars, corporate-action events, instruments and calendars are stored. Anything with a tunable parameter (moving averages, RS, regime) is computed in pure domain code. Only parameter-free cross-sectional aggregates that need the whole market (liquidity rank, breadth) are materialised.
2. **Raw is immutable truth.** Adjustment is a versioned policy applied on read, never written back.
3. **One database format everywhere.** Workbench, Blob shards, Vercel functions and device all use SQLite-format files with the same DDL for the tables they share. Use only plain SQLite features, no libSQL-only extensions, so the device's SQLite WASM can open any shard. Checked: a shard written by native libSQL opens in sqlite-wasm 3.54.1 with `integrity_check` ok and a blob round-trip (small test, section 9).
4. **Blob holds whole files, so the database is sharded.** Closed shards are immutable and written once. One small open shard is rewritten daily. No file is ever edited in place, which is what makes a database in Blob workable.
5. **Each shard has exactly one writer.** The local workbench builds and owns **closed** shards. The Vercel cron owns the **open** shard and the **core** shard. At period end the local job rebuilds the closing period from the raw files, compares it with the cron's version, and publishes the immutable one. This is what stops the two paths from diverging.
6. **Shards are a projection of the workbench.** The workbench keeps the row-per-bar `bar` table for SQL analytics. Published shards carry `bar_chunk` (packed bars, 30 to 120 times faster to load, spike 1) plus the small tables clients need, not the fat `bar` table. Same engine, same DDL where tables overlap.
7. **Device cache is disposable; user data is not.** Cache tables can always be re-downloaded. Journal, ledger, strategies and credentials cannot, and get backup and export.

## 3. Where each kind of data lives

| Data | Workbench libSQL (local) | Shards (Blob / dev folder) | Device SQLite | Notes |
|---|---|---|---|---|
| Raw bars, all years, all tracked stocks | Yes (full `bar` table) | `bar_chunk` in a closed shard per market and year | Shards on demand | Cache cap adaptive (section 7), LRU eviction |
| Current year | Derivable | The open shard, rewritten daily | Yes, always | Feeds the scanner, as the snapshot does today |
| Instruments, symbol history, corporate actions, benchmarks | Yes | Core shard (a few MB) | Replicated (small) | |
| Liquidity rank (month-end), breadth | Yes | Core shard, computed at ingest | Replicated | Point-in-time universes |
| Provenance, quality issues, revisions | Yes | No | No | Audit trail; local only |
| Scanners, shortlist, plans, settings | Optional sync (7A) | Yes (authoritative until sync is on) | Local-first; sync is opt-in |
| Journal, ledger, backtest runs, strategies | Optional sync (7A) | Yes | Irreplaceable: export, backup and sync |
| Credentials (broker keys, sessions) | **Never** | Yes, separate table | Never exported, never synced |
| Live quotes and intraday candles | No | Memory only / existing intraday cache | Not part of the archive; the daily bhavcopy is the truth for the close |

## 4. Workbench schema (libSQL/SQLite, STRICT tables; local file)

This is the full normalised schema, used locally for backfill, corrections, quality checks and analytics. Production never holds the fat row-per-bar `bar` table; it holds shards built from this schema, with `bar` packed into `bar_chunk` (sections 5 and 6). Every other table here appears unchanged in a shard (`instrument`, `corporate_action`, `liquidity_month`, and so on).

Money is integer minor units (paise, cents). `market.price_scale` says how many per major unit. Dates are `INTEGER YYYYMMDD`: 4 bytes, sortable, readable, and 87 MB smaller than ISO text at 8.75M rows.

```sql
CREATE TABLE market (
  id TEXT PRIMARY KEY,               -- 'NSE','BSE','NYSE','NASDAQ'
  country TEXT NOT NULL, currency TEXT NOT NULL,
  timezone TEXT NOT NULL,            -- 'Asia/Kolkata'
  price_scale INTEGER NOT NULL       -- 100
) STRICT;

CREATE TABLE source_batch (          -- one row per file fetched: provenance
  id INTEGER PRIMARY KEY,
  market TEXT NOT NULL REFERENCES market(id),
  source TEXT NOT NULL, date INTEGER NOT NULL,
  url TEXT, sha256 TEXT, fetched_at TEXT NOT NULL,
  rows_read INTEGER NOT NULL, rows_accepted INTEGER NOT NULL, rows_rejected INTEGER NOT NULL
) STRICT;

CREATE TABLE session (               -- dates a market actually traded, from ingested data
  market TEXT NOT NULL REFERENCES market(id),
  date INTEGER NOT NULL, bars INTEGER NOT NULL,
  PRIMARY KEY (market, date)
) WITHOUT ROWID, STRICT;

CREATE TABLE instrument (
  id INTEGER PRIMARY KEY,            -- global, market-agnostic
  market TEXT NOT NULL REFERENCES market(id),
  symbol TEXT NOT NULL,
  isin TEXT, name TEXT, sector TEXT, industry TEXT,
  kind TEXT NOT NULL DEFAULT 'EQUITY',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','DELISTED')),
  first_date INTEGER, last_date INTEGER,
  UNIQUE (market, symbol)
) STRICT;
CREATE INDEX instrument_isin ON instrument(isin);   -- links one company's NSE and BSE listings

CREATE TABLE symbol_history (        -- renames, ticker reuse (matters for US)
  instrument_id INTEGER NOT NULL REFERENCES instrument(id),
  symbol TEXT NOT NULL, from_date INTEGER NOT NULL, to_date INTEGER,
  PRIMARY KEY (instrument_id, from_date)
) WITHOUT ROWID, STRICT;

CREATE TABLE bar (                   -- RAW, never adjusted in storage
  instrument_id INTEGER NOT NULL REFERENCES instrument(id),
  date INTEGER NOT NULL,
  o INTEGER NOT NULL, h INTEGER NOT NULL, l INTEGER NOT NULL, c INTEGER NOT NULL,
  prev_close INTEGER,                -- as reported by the exchange
  volume INTEGER NOT NULL,
  turnover INTEGER,                  -- traded value when the source gives it
  delivery_bp INTEGER,               -- delivery %, in basis points, when given
  batch_id INTEGER NOT NULL REFERENCES source_batch(id),
  PRIMARY KEY (instrument_id, date),
  CHECK (h >= l AND h >= o AND h >= c AND l <= o AND l <= c AND volume >= 0)
) WITHOUT ROWID, STRICT;
CREATE INDEX bar_by_date ON bar(date, instrument_id);   -- whole-market-on-a-date queries

CREATE TABLE bar_revision (          -- only when a later file corrects an existing bar
  instrument_id INTEGER NOT NULL, date INTEGER NOT NULL, data_rev INTEGER NOT NULL,
  o INTEGER, h INTEGER, l INTEGER, c INTEGER, volume INTEGER,   -- the OLD values
  batch_id INTEGER NOT NULL,
  PRIMARY KEY (instrument_id, date, data_rev)
) WITHOUT ROWID, STRICT;

CREATE TABLE corporate_action (
  id INTEGER PRIMARY KEY,
  instrument_id INTEGER NOT NULL REFERENCES instrument(id),
  ex_date INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('SPLIT','BONUS','DIVIDEND','PRICE_JUMP')),
  factor REAL NOT NULL,              -- multiplier for bars BEFORE ex_date (volume uses 1/factor)
  cash INTEGER,                      -- dividends, minor units
  source TEXT NOT NULL,              -- 'PREVCLOSE_HEURISTIC' today; a verified feed later
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0,1)),
  UNIQUE (instrument_id, ex_date, kind)
) STRICT;

CREATE TABLE benchmark (
  id TEXT PRIMARY KEY, market TEXT NOT NULL REFERENCES market(id),
  name TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('PRICE','TOTAL_RETURN'))
) STRICT;
CREATE TABLE benchmark_bar (
  benchmark_id TEXT NOT NULL REFERENCES benchmark(id), date INTEGER NOT NULL,
  o INTEGER, h INTEGER, l INTEGER, c INTEGER NOT NULL,
  PRIMARY KEY (benchmark_id, date)
) WITHOUT ROWID, STRICT;

-- Derived, parameter-free, needs the whole market. Rebuildable from bar + corporate_action.
CREATE TABLE liquidity_month (       -- month-end only: 120 months, not 2,500 days
  instrument_id INTEGER NOT NULL REFERENCES instrument(id),
  month_end INTEGER NOT NULL,
  turnover_avg_126 INTEGER NOT NULL, rank INTEGER NOT NULL,   -- rank within the market
  PRIMARY KEY (instrument_id, month_end)
) WITHOUT ROWID, STRICT;
CREATE TABLE breadth_daily (
  market TEXT NOT NULL REFERENCES market(id), date INTEGER NOT NULL,
  tracked INTEGER NOT NULL, advancers INTEGER NOT NULL, decliners INTEGER NOT NULL, unchanged INTEGER NOT NULL,
  new_high_252 INTEGER NOT NULL, new_low_252 INTEGER NOT NULL,
  above_50dma INTEGER NOT NULL, above_200dma INTEGER NOT NULL,
  PRIMARY KEY (market, date)
) WITHOUT ROWID, STRICT;

CREATE TABLE data_quality_issue (
  id INTEGER PRIMARY KEY, batch_id INTEGER REFERENCES source_batch(id),
  instrument_id INTEGER, date INTEGER,
  severity TEXT NOT NULL CHECK (severity IN ('INFO','WARNING','ERROR')),
  code TEXT NOT NULL, message TEXT NOT NULL
) STRICT;

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID, STRICT;
-- keys: schema_version, data_rev, adjustment_policy
```

### Design choices worth defending

- **Per-bar tables are the only big tables.** `bar` is the one multi-million-row table. Derived tables are monthly or per-market-day on purpose: a daily per-stock `liquidity` table would double the database for no gain.
- **`WITHOUT ROWID` on `(instrument_id, date)`** makes a stock's whole history one contiguous range scan. The extra `(date, instrument_id)` index serves "everything on one day". It costs roughly 70 MB at 8.75M rows; drop it if the hot window and derived tables make it unused.
- **Adjustment is a function, not a column.** `adjust(bars, events, policy)` lives in `src/domain` as pure TypeScript, is used by the device and by the ingest's breadth job, and is versioned by `meta.adjustment_policy`. Every backtest records that version. Today's `adjustPast` becomes this function and stops mutating stored data.
- **Point-in-time universe** comes from `liquidity_month` plus `instrument.first_date/last_date`. It needs no index-constituent feed, and delisted stocks stay, so survivorship bias is removed for tracked stocks.
- **Corrections** (an exchange re-publishing a day) overwrite the bar, write the old values to `bar_revision`, and bump `data_rev`. A backtest pins `data_rev`, so an old run can be explained even if not byte-reproduced.
- **Multi-market** needs no schema change: a new `market` row, a new source adapter, and a calendar from that market's observed sessions. Currency stays native; an `fx_rate` table can be added when needed. Tickers are unique per market, with `symbol_history` for reuse.

### Sizing

Measured (spike 1, SQLite 3.54, synthetic): 8.5M bars in this exact `bar` schema, including the `(date, instrument_id)` index, took **536 MB, about 63 bytes per row**. My first estimate of 32 bytes was half the real figure. Expect roughly 0.5 GB for 10 years of NSE and BSE with about 4,000 ever-liquid stocks, and similar again for a US universe. Ways to shrink it, none measured: drop `batch_id` from `bar` (record provenance per day, not per bar), drop `delivery_bp` and `turnover` when the source lacks them, and drop the secondary date index if no server query needs it. This is the size of the local file, which is a disk question, not a hosting-plan one. What matters for Vercel is the size of the published files; the Blob store's limits are in [backend-design.md](backend-design.md) (1 GB on Hobby, 2,000 uploads a month), and closed-year files are written once.

## 5. Ingest

One set of pure ingest code (parse, normalise, detect corporate actions, apply a day, compute derived tables) runs in two places. It has no I/O of its own, so it is testable and cannot behave differently in each place.

- **Daily, on Vercel (open and core shards only):** the cron downloads the open shard and core shard from Blob into `/tmp` (plus the previous closed shard, read-only, for the 252-session lookback), opens them with libSQL in file mode, and applies the new day in **one SQL transaction**: upsert instruments, append the day into the open shard's `bar_chunk` rows, detect corporate actions (previous-close mismatch becomes a `PREVCLOSE_HEURISTIC` event with its factor), recompute that day's `breadth_daily` and, on month-end, `liquidity_month`. It then checkpoints each shard to a single file, uploads it as a new revision, and writes the manifest **last**. It keeps the existing safeguards in [ingest.ts](../app/api/_lib/data/ingest.ts): the file's own date wins over the URL's date, a one-sided day is held back, and a failed day publishes nothing.
- **Local workbench:** the same code reads the raw exchange files into the libSQL file in one transaction per day. Used for the 10-year backfill, for corrections (a re-published day overwrites the bar, writes the old values to `bar_revision`, bumps `data_rev`), for quality checks, and for any SQL analysis. **Publish** builds shards from it: each closed shard is created with the real DDL and filled with `INSERT ... SELECT`, packing `bar` rows into `bar_chunk`. In dev, publish writes to a local folder that the dev server serves in place of the `MARKET_DATA_ORIGIN` proxy.
- **Admission rule:** replace "prune stocks whose average turnover falls" with "track a stock if it was ever liquid", decided in a two-pass backfill. Never delete bars of a tracked stock. This keeps delisted names and the lookback bars of stocks that became liquid later.
- **Backfill:** run locally. A 10-year run is about 2,500 sessions per exchange at about 1 s per request, so over an hour, outside Vercel's 300 s limit and off datacenter IPs (which NSE is known to block). It needs two parsers per exchange (spike 3, section 9) and the file-date check on both.
- **Is the local DB irreplaceable?** Mostly not. The raw exchange files stay downloadable for years, so the database can be rebuilt. Back up only what cannot be rebuilt: `bar_revision`, any manually verified corporate actions, and `data_quality_issue` notes.
- **Verify command:** rebuild the open shard locally and compare row counts and a content hash with the published one. This is the guard behind principle 5. Compare contents, not file bytes: two SQLite files with identical content can differ byte for byte.
- **If the PC is off:** nothing is lost. The cron keeps the open and core shards current, and the local workbench catches up from the raw files on its next run.
- **Daily write size:** the open shard holds the open year as packed chunks, roughly 20 MB for 4,000 stocks at a full year (estimate from the spike 1 payload of 20 bytes per bar, not measured). Downloading and re-uploading that daily costs Blob transfer. If that proves too heavy, split the open year into month shards (about 2 MB daily) and let the local job compact them into a yearly shard at year end. This is an escape hatch, not v1.

## 6. Serving the device

The files are SQLite databases, gzipped, named in the manifest. The existing `/api/data/manifest` function stays.

| Shard (named in the manifest) | Contents | Writer | Caching |
|---|---|---|---|
| `manifest` | `data_rev`, the shard list with revision and content hash, per market | Cron (last) | Short (minutes), as now |
| `core/{market}/r{rev}` | `instrument`, `symbol_history`, `corporate_action`, `benchmark_bar`, `liquidity_month`, `breadth_daily`, `meta` | Cron | Immutable per rev |
| `{year}/{market}/r{rev}` | One closed year: `bar_chunk` for all tracked stocks | Local | Immutable per rev |
| `open/{market}/r{rev}` | The open year: `bar_chunk`, rewritten daily | Cron | Immutable per rev |

Two consumers read them:

- **Vercel functions** (the existing endpoints, and any new ones) download the shard they need into `/tmp` and query it with libSQL, caching it across warm invocations. This is how a hosted endpoint answers "these stocks over this range" or a point-in-time universe, with real SQL.
- **The device** downloads shards straight from the CDN, imports each into OPFS, and queries them with SQLite WASM. A chart beyond the current year, or a backtest, fetches the year shards it needs once; the cache then serves it.

Not v1, unverified: querying a shard in place over HTTP range requests (no download), which would fetch only the pages a query touches. It needs Blob to honour `Range` and an HTTP VFS for SQLite WASM, and some of those need cross-origin isolation. Worth a spike only if whole-shard downloads prove too heavy.

Adjustment is **not** applied inside shards; the device and functions apply the versioned policy to raw bars and events, so a shard never goes stale when the policy changes. Closed shards change only if a correction bumps `data_rev`, so a backtest downloads each year once.

## 7. Device schema and cache

The device runs SQLite WASM in one dedicated worker. It holds `instrument`, `corporate_action`, `benchmark_bar`, `liquidity_month` and `breadth_daily` with the server DDL, but **bars are stored as packed chunks, not as one row per bar** (spike 1, section 9: row-per-bar reads cost about 6 us per row in JS, 30 to 40 times slower than blobs; row-by-row loading ran at 14k rows/s):

```sql
CREATE TABLE bar_chunk (
  instrument_id INTEGER NOT NULL, year INTEGER NOT NULL,   -- year 0..N = 250-session blocks or calendar years; pick one
  n INTEGER NOT NULL, first_date INTEGER NOT NULL,
  data BLOB NOT NULL,       -- Int32 columns back to back: o[n], h[n], l[n], c[n], volume[n]; 0 = no trade that day
  PRIMARY KEY (instrument_id, year)
) WITHOUT ROWID, STRICT;
```

The device never runs analytics over bars in SQL. Whole-market aggregates (breadth, liquidity rank) are computed on the server and shipped as the small derived tables. Per-stock analytics run in the domain code over typed arrays. The same `bar_chunk` shape is the table inside every published shard (section 6), so a downloaded shard is imported as a file (or attached), not re-inserted row by row.

Cache bookkeeping:

```sql
CREATE TABLE cache_chunk (
  market TEXT NOT NULL, year INTEGER NOT NULL,      -- 0 = hot window
  data_rev INTEGER NOT NULL, bytes INTEGER NOT NULL, last_used INTEGER NOT NULL,
  PRIMARY KEY (market, year)
) WITHOUT ROWID, STRICT;
```

- A query first checks `cache_chunk` for coverage and fetches what is missing, so the domain asks for "this universe, these dates" and never knows what is cached.
- Eviction is LRU by `last_used` against a cap. The cap is **adaptive, not fixed**: default to a fraction of `navigator.storage.estimate().quota` (for example 20%, bounded to a sensible minimum and maximum), shown and overridable in Settings, and lowered automatically when the browser reports pressure or a write fails. A desktop can hold the whole 10-year archive; a phone holds the window plus the years it has used. The hot window is pinned.
- User tables (scanners, shortlist, settings, strategy versions, backtest runs, journal and ledger, from the spec and v2) sit in the same database but are excluded from eviction and included in export. Credentials stay in their own table and are never exported.
- Storage durability: request `navigator.storage.persist()`, and keep the existing export and restore workflow. OPFS and IndexedDB are both best-effort without it.

## 7A. User data and optional multi-user sync

Syncing user data to the server helps when several people use the app, and it is also the backup for irreplaceable data (journal, ledger). It reverses the earlier "no per-user server state" rule, so it is **opt-in, later, and designed in now only as hooks** so the device schema does not need rewriting.

**Hooks to build into the device user tables from the start:**

- Primary keys are client-generated UUIDs (never auto-increment), so two devices cannot collide.
- Every row has `updated_at`, `device_id` and a soft-delete `deleted_at` (tombstone), never a hard delete.
- The ledger and journal are append-only (as v2 requires), so they merge trivially: sync is a union by id. Mutable rows (scanners, shortlist, settings, strategy drafts) resolve by last-write-wins on `updated_at`, with the conflict logged. Strategy versions are immutable, so they never conflict.
- A local `outbox` of unsent changes and a `sync_state` cursor per table.

**Server side, when enabled:** with no hosted database, sync has no obvious home on Vercel. For one user, the simplest backup is the existing export and restore workflow plus an optional encrypted export to a private Blob object, which needs no database. Real multi-device sync would need a writable store, which is a separate decision (a hosted database, or the user's own server). It is out of scope until the single-user assumption changes.

**What must not sync:** broker credentials and sessions (FYERS, Breeze). They stay on the device, as the spec requires. Syncing them would make the server a custodian of keys that can place orders.

**What this needs that does not exist today:** real identity. Sign-in today is one shared `APP_PASSWORD`. Multi-user needs per-user accounts (an auth provider or passwordless email), rate limits per user, and a decision on data licensing, since a shared deployment that serves exchange data to others raises the redistribution question in [backend-design.md](backend-design.md). Per-user background work (catch-up automation, server alerts) is a separate project and is not implied by sync.

**Sequencing:** not before the market-data layer and the backtest engine. Sync is a transport for data that has to exist and be stable first.

### Device engine caveat

The main OPFS VFS needs cross-origin isolation (COOP and COEP), which breaks cross-origin fetches unless every origin sends CORP. This app fetches from the market-data origin and the broker APIs. The `opfs-sahpool` VFS avoids the headers but allows one connection, which fits a single worker. Neither is verified on Android; spike it first (section 9).

## 8. Migration (keeps the app working at every step)

| Step | What changes | Client impact |
|---|---|---|
| 1 | Create the local libSQL workbench, apply the schema, extract the pure ingest code so it can run in both places, backfill 10 years locally | None |
| 2 | Local publish builds shards into a folder; add a filesystem implementation of the `Store` interface in [store.ts](../app/api/_lib/data/store.ts) so dev serves them | None (dev only) |
| 3 | Publish closed shards to Blob; make the cron work on the open and core shards via `/tmp`; keep writing today's snapshots in parallel | None |
| 4 | Add the persistence interface in the app with a Dexie implementation behind it | None |
| 5 | Add the SQLite WASM implementation; migrate scanners, shortlist and settings once; switch reads to window and slices | One-time migration |
| 6 | Point-in-time universe and breadth files; enables backtests | Enables backtests |
| 7 | Retire the old snapshot and delta files and the in-place adjust | Cleanup |

The repository-interface step (3) is the spec's own rule and is what makes the engine swap safe.

## 9. Decisions and spikes needed

Decided (2026-10-30):

1. **Storage engine: libSQL/SQLite files everywhere.** A local libSQL file is the workbench; sharded SQLite-format files in Blob are production; functions and devices open those same files. No hosted database service.
2. **Device cache cap: adaptive** (section 7), overridable.
3. **User data sync: yes, opt-in, later** (section 7A). Credentials never sync.

Open:

4. **Admission rule.** Not yet answered; proceeding on "ever liquid" (about 4,000 stocks, roughly 300 MB) unless you want all about 9,700 stocks (about 24M bars, roughly 800 MB locally, and a larger set of published files against the Blob store's 1 GB limit).
5. **US data.** Which source and licence? The schema is ready; I have not looked for a free source and would not assume one exists.
6. **Users: one, for now (decided 2026-10-30).** The shared `APP_PASSWORD` stays. Section 7A is therefore reduced to an optional backup and cross-device sync for the single user; per-user accounts, per-user isolation and the licensing questions in 7A apply only if that changes.

### Spike results (2026-10-30)

Scripts are in the session scratchpad, not the repo. All data synthetic.

**Spike 3, backfill sources (done; probed from a dev PC, not from Vercel).** Each exchange needs two parsers:

| Exchange | Current format (the app's parser) | Legacy format |
|---|---|---|
| NSE | `sec_bhavdata_full_DDMMYYYY.csv`: works from between 2019-09-02 and 2019-12-02 to today | `cm{DD}{MON}{YYYY}bhav.csv.zip` under `content/historical/EQUITIES/`: found at 2001, 2005, 2015, 2018 and 2024-03; gone by 2025-03 |
| BSE | UDiFF `BhavCopy_BSE_CM_0_0_0_YYYYMMDD_F_0000.CSV`: works from between 2023-12-01 and 2024-01-01 to today | `EQ{DDMMYY}_CSV.ZIP`: found at 2015, 2018, 2022 and 2024-03; gone by 2025-03 |

- **Ten years is reachable on both exchanges**; NSE legacy goes back at least 25 years. BSE legacy was confirmed only to 2015 (the 2010 probe fell on a holiday).
- Legacy NSE rows carry `PREVCLOSE` and `ISIN` but not delivery %; legacy BSE rows carry `PREVCLOSE` but no ISIN (scrip code only), so BSE ISINs for old years come from the metadata list.
- **Trap, already handled in the current parser:** on an NSE holiday (2022-03-01 probed) the new-format URL returns a 200 file whose rows are dated the previous session. The legacy parsers need the same check against the file's own date column (`TIMESTAMP`).
- BSE holidays return a 200 HTML page (about 16,901 bytes), as [backend-design.md](backend-design.md) says. One BSE probe returned no response and succeeded on retry, so the fetcher needs retries.
- Not verified: every day in the range, boundary dates to the day, and behaviour from Vercel's network. A 2,500-day backfill at about 1 s per request is over an hour per exchange.

**Spike 1, SQLite WASM on Windows (done; Chrome 156 headless, `opfs-sahpool`, no cross-origin-isolation headers needed).** The engine works: it installs in about 100 to 160 ms, opens in under 12 ms, a cold start from a fresh browser process shows no penalty, and a daily append of 3,800 rows takes 1.6 s. Row-per-bar versus packed chunks, same data:

| Operation | Row per bar (8.5M rows) | Packed chunks (36k blobs) |
|---|---|---|
| Initial load | 609 s | 5 s |
| 500 stocks, 10 years | 4.5 to 6.6 s | 0.13 to 0.21 s |
| Whole market, last year | 6.5 to 9.7 s | 0.17 to 0.19 s |
| One stock, all history | 34 to 75 ms | 1 ms |
| Database size | 536 MB | 316 MB (168 MB of payload; overflow pages add overhead, a larger page size might help, untested) |

The cause is JS marshalling per row, not SQLite scanning: a 126-day aggregate returning 500 rows took 0.9 to 1.9 s, but pulling about 1M rows into JS took 6 to 8 s. The 252-day breadth aggregate took 9 to 14 s on the device, which is another reason those aggregates are computed on the server. **Android is not tested**: it needs a phone (see below).

**Spike 2, local libSQL file (done, small scale).** The original plan was to measure Turso over the network; with no hosted service that no longer applies, so it was re-run against a local file (`@libsql/client`, `file:` URL, Windows, Node 24). It works with no account. A 4,000-row day in one batch took 142 ms. A 100k-row bulk load ran at about 23k rows/s through the batch API (about 5 minutes extrapolated to 7M rows). Against 104k rows: one stock's rows in 1 ms, a whole day in 52 ms, a per-stock max/min aggregate in 53 ms. Only 104k rows were loaded, so the extrapolations are indicative, not measured. A prepared-statement bulk path would likely be faster, untested. Native aggregates at about 0.5 us per row suggest the 252-day breadth job would take well under a second locally, against 9 to 14 s in the browser.

**Compatibility check (done, small scale).** A shard written by native libSQL (tables `bar_chunk` and `meta`, 200 blob rows) was read as bytes and opened in sqlite-wasm 3.54.1: row count, a blob round-trip and `PRAGMA integrity_check` were all correct. The test built the shard with `CREATE TABLE AS`, which drops primary keys and `STRICT`, so a real publish must create the tables with the real DDL first. It also ran in Node, not in a browser or on Android.

**Not measured, needed before migration step 3 (all about Vercel):**

- Does `@libsql/client`'s native file mode install and run in a Vercel Linux function? (It ran on this Windows machine only.) If not, SQLite WASM in Node is the fallback, which can also open the same shards.
- `/tmp` capacity (I recall 512 MB, unchecked) against the open, core and previous-year shards together, and the cold-start time to download them from Blob.
- Blob transfer and operation limits for a daily rewrite of the open shard (section 5), and whether gzipped shards compress well enough.
- The cron's total time against the 300 s limit.

## 10. What this does not cover

User-data schema in detail (journal, ledger, strategy versions: a separate document, from the spec and v2), the live-data adapter (quotes are not persisted here), and any server-side backtest compute.
