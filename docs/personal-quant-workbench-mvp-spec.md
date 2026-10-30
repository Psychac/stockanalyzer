# Personal Quant Workbench — MVP System Specification

**Version:** 1.0  
**Date:** 29 October 2026  
**Status:** Technical design and implementation baseline

## 1. Product definition

The product is a **local-first TypeScript web/PWA application for systematic research on Indian equities**, supporting configurable strategies, historical backtesting, paper trading and, later, market-regime and news-sentiment research.

The central design decision is to separate **market data, strategy definitions, backtest execution, risk analytics and user interfaces**. Each can evolve independently through explicit contracts, without requiring a backend or allowing an external data provider to dictate the internal architecture.

### Goals

- Research all available NSE-listed ordinary shares, subject to data coverage and eligibility rules.
- Import and maintain free daily market data with validation and provenance.
- Create and compare configurable trading strategies without rewriting the engine.
- Backtest with realistic execution assumptions, transaction costs and benchmark comparisons.
- Maintain persistent paper portfolios and a complete simulated trade ledger.
- Add news, sentiment and market-regime features as optional, independently testable modules.
- Operate without a user-maintained server, subscription data feed or live trading infrastructure.

### Non-goals

- Live order placement or automatic execution through a broker.
- Guaranteed profitable strategies or AI-generated financial advice.
- Intraday tick-level research or high-frequency trading.
- A hosted multi-user service.
- Unrestricted scraping or redistribution of exchange data.
- A general-purpose financial news reader.
- Machine learning before simpler, testable baselines exist.

### Definition of “usable”

A user must be able to import market data, define a strategy, run a reproducible backtest, compare it with a benchmark, inspect individual simulated trades and maintain a paper portfolio—all locally.

News and sentiment must not be required for any of those workflows.

## 2. Architecture

### 2.1 Logical architecture

```text
Presentation — TypeScript / PWA
  Dashboard · Data Manager · Strategy Builder · Backtests
  Paper Portfolio · Research
                 |
                 v
Application services
  Use cases · Validation · Orchestration · Progress and errors
                 |
        +--------+---------+
        |                  |
        v                  v
Research domain       Optional intelligence
Universe              News / filings
Indicators            Events / sentiment
Strategies             Market regimes
Backtesting
Risk analytics
        |                  |
        +--------+---------+
                 |
                 v
Infrastructure and adapters
  Local SQLite / OPFS
  Exchange-file imports / public datasets
  Future broker and news adapters
```

The diagram describes logical dependencies, not separate deployable services. The MVP is a single PWA with isolated modules, not a distributed system.

### 2.2 Recommended stack

| Layer | Choice | Reason |
|---|---|---|
| Language | TypeScript with strict mode | Shared contracts, compile-time safety |
| UI | React + Vite | Lightweight, well-supported PWA ecosystem |
| Routing | React Router | Simple client-side navigation |
| UI state | Zustand or equivalent small store | Local interaction state, not domain logic |
| Validation | Zod | Validate imports, settings and serialized strategy definitions |
| Persistence | SQLite compiled to WebAssembly | Relational schema, transactions and portable SQL |
| Browser storage | SQLite WASM using OPFS where supported | Persistent local database without a server |
| Background computation | Web Worker | Keep imports and backtests from blocking the UI |
| Charts | Lightweight charting library behind an adapter | Avoid coupling analytics to a specific renderer |
| Testing | Vitest + property-based tests where useful | Deterministic logic and regression coverage |
| PWA | Vite PWA tooling or equivalent | Installability and cached application shell |

**Storage decision:** use SQLite WASM with an OPFS-backed database in supported browsers, accessed through a dedicated worker. OPFS is browser-managed storage, not a user-visible directory. Keep explicit database backup/export and import/restore workflows because browser storage can be cleared or unavailable.

If a target browser cannot provide the required persistent storage, show that limitation clearly and use a supported fallback such as file-based export/import. Do not silently pretend data is safely persisted.

### 2.3 Dependency rules

1. Domain modules must not import React, browser UI components or charting libraries.
2. Strategies consume domain inputs and return signals; they never query the database directly.
3. Backtesting consumes immutable input snapshots and strategy contracts.
4. Provider adapters normalize external data into canonical domain models.
5. Persistence implements repository interfaces; domain logic must not depend on SQLite-specific APIs.
6. Market intelligence may enrich research features but cannot directly mutate positions or place orders.
7. Every backtest must identify the strategy version, data snapshot and execution assumptions used.

## 3. Module boundaries

| Module | Responsibilities | Public contract |
|---|---|---|
| `instruments` | Security identifiers, symbols, exchange metadata | `Instrument`, `InstrumentRepository` |
| `universe` | Eligibility rules and historical membership | `UniverseDefinition`, `UniverseSnapshot` |
| `market-data` | OHLCV, imports, validation, adjustments | `PriceBar`, `DataQualityReport` |
| `data-providers` | Import formats and provider-specific mappings | `MarketDataAdapter` |
| `indicators` | Moving averages, momentum, volatility and future indicators | `IndicatorDefinition`, `IndicatorSeries` |
| `strategies` | Declarative strategy configuration and signal generation | `StrategyDefinition`, `StrategyEngine` |
| `backtesting` | Simulated fills, holdings, cash, fees and trade ledger | `BacktestRequest`, `BacktestResult` |
| `risk-analytics` | Drawdown, exposure, volatility and concentration | `RiskReport` |
| `paper-trading` | Simulated orders and persistent paper portfolios | `PaperPortfolio`, `PaperOrder` |
| `benchmarking` | Benchmark data and comparisons | `BenchmarkDefinition`, `BenchmarkResult` |
| `market-intelligence` | Timestamped events, news and sentiment | `MarketEvent`, `EventFeatures` |
| `research-lab` | Experiment tracking, hypotheses and comparisons | `Experiment`, `ExperimentComparison` |
| `persistence` | Schema migrations and repository implementations | Repository interfaces |
| `application` | Workflow orchestration and user-facing use cases | Application service contracts |

The `market-intelligence` module is optional and should not be imported by the core backtest engine as a mandatory dependency. The engine can consume generic, timestamped features when supplied by an experiment.

## 4. Repository structure

```text
personal-quant-workbench/
├── public/
│   ├── icons/
│   └── manifest.webmanifest
├── src/
│   ├── app/
│   │   ├── routes/
│   │   ├── providers/
│   │   └── navigation/
│   ├── features/
│   │   ├── dashboard/
│   │   ├── data-manager/
│   │   ├── universe-builder/
│   │   ├── strategy-lab/
│   │   ├── backtest-results/
│   │   ├── paper-portfolio/
│   │   └── research/
│   ├── domain/
│   │   ├── instruments/
│   │   ├── universe/
│   │   ├── market-data/
│   │   ├── indicators/
│   │   ├── strategies/
│   │   ├── backtesting/
│   │   ├── risk-analytics/
│   │   ├── benchmarking/
│   │   ├── paper-trading/
│   │   └── market-intelligence/
│   ├── application/
│   │   ├── use-cases/
│   │   ├── ports/
│   │   └── validation/
│   ├── infrastructure/
│   │   ├── database/
│   │   │   ├── migrations/
│   │   │   ├── repositories/
│   │   │   └── sqlite-worker/
│   │   ├── importers/
│   │   ├── providers/
│   │   ├── export/
│   │   └── logging/
│   ├── workers/
│   │   ├── backtest.worker.ts
│   │   └── import.worker.ts
│   ├── shared/
│   │   ├── types/
│   │   ├── errors/
│   │   └── utilities/
│   └── main.tsx
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── backtesting/
│   ├── fixtures/
│   └── golden-results/
├── docs/
│   ├── architecture.md
│   ├── strategy-definition.md
│   ├── data-provenance.md
│   ├── backtesting-methodology.md
│   └── limitations.md
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

**Boundary convention:** `domain` contains deterministic business logic and domain types. `application` coordinates use cases. `infrastructure` talks to files, browser storage and external sources. `features` renders the UI. Import direction should generally flow inward toward domain contracts.

Do not create a separate npm package for every folder. Enforce boundaries through lint rules and tests first.

## 5. Domain contracts

Contracts should describe the business concepts, not leak database records into the application.

### 5.1 Core market data

```ts
export type IsoDate = string; // YYYY-MM-DD
export type InstrumentId = string;
export type RunId = string;

export interface Instrument {
  id: InstrumentId;
  exchange: "NSE";
  symbol: string;
  isin?: string;
  name: string;
  instrumentType: "ORDINARY_EQUITY";
  listingDate?: IsoDate;
  delistingDate?: IsoDate;
  currency: "INR";
}

export interface PriceBar {
  instrumentId: InstrumentId;
  tradingDate: IsoDate;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  sourceId: string;
  adjustmentStatus: "RAW" | "ADJUSTED" | "UNKNOWN";
}

export interface DataQualityIssue {
  instrumentId?: InstrumentId;
  tradingDate?: IsoDate;
  severity: "INFO" | "WARNING" | "ERROR";
  code: string;
  message: string;
}

export interface DataQualityReport {
  rowsRead: number;
  rowsAccepted: number;
  rowsRejected: number;
  issues: DataQualityIssue[];
}
```

Use decimal-safe handling for money and quantities. JavaScript numbers are floating-point; for reproducible financial calculations, either use a documented integer minor-unit representation where suitable or a decimal arithmetic library. Do not assume arbitrary floating-point arithmetic is exact.

### 5.2 Strategy framework

The MVP supports configurable strategies immediately, but that does **not** mean users can execute arbitrary JavaScript or upload executable code. Use a validated declarative strategy definition that references registered indicators and operators.

```ts
export type ComparisonOperator =
  | "GT" | "GTE" | "LT" | "LTE" | "EQ";

export interface StrategyDefinition {
  id: string;
  name: string;
  version: number;
  universeId: string;
  rebalanceFrequency: "DAILY" | "WEEKLY" | "MONTHLY";
  indicators: IndicatorDefinition[];
  entryRules: RuleGroup;
  exitRules: RuleGroup;
  ranking?: RankingDefinition;
  portfolio: PortfolioDefinition;
  execution: ExecutionDefinition;
}

export interface IndicatorDefinition {
  id: string;
  type: string;
  inputs: Record<string, string | number | boolean>;
}

export interface Rule {
  leftIndicator: string;
  operator: ComparisonOperator;
  rightValue?: number | string;
  rightIndicator?: string;
}

export interface RuleGroup {
  logic: "AND" | "OR";
  rules: Array<Rule | RuleGroup>;
}

export interface RankingDefinition {
  indicatorId: string;
  direction: "ASC" | "DESC";
  topN: number;
}

export interface PortfolioDefinition {
  sizing: "EQUAL_WEIGHT" | "FIXED_WEIGHT";
  maxPositions: number;
  maxPositionWeight: number;
  cashReserveWeight: number;
}

export interface ExecutionDefinition {
  signalTiming: "AFTER_CLOSE";
  executionTiming: "NEXT_SESSION_OPEN" | "NEXT_SESSION_CLOSE";
  feeModelId: string;
  slippageBps: number;
}
```

This is a conceptual contract. Before implementation, add strict schemas for each indicator type, rule operand compatibility, parameter bounds and version migrations. In particular, prevent invalid references, recursive rule structures with excessive depth, and execution settings that permit same-bar look-ahead.

The first built-in registry should include:

- Simple and exponential moving averages.
- Trailing returns and momentum windows.
- Volatility and average true range.
- Volume averages and relative volume.
- Cross-sectional ranking.
- Portfolio-level exposure and drawdown features.

New indicator types should register through a documented interface rather than adding conditionals throughout the UI and backtest engine.

### 5.3 Backtesting contracts

```ts
export interface BacktestRequest {
  strategyId: string;
  strategyVersion: number;
  startDate: IsoDate;
  endDate: IsoDate;
  benchmarkId: string;
  initialCash: string;
  dataSnapshotId: string;
  costModelId: string;
}

export interface BacktestResult {
  runId: RunId;
  status: "COMPLETED" | "FAILED" | "CANCELLED";
  strategyVersion: number;
  dataSnapshotId: string;
  metrics: PerformanceMetrics;
  warnings: string[];
}

export interface PerformanceMetrics {
  totalReturn: number;
  annualizedReturn?: number;
  annualizedVolatility?: number;
  maxDrawdown: number;
  sharpeRatio?: number;
  turnover?: number;
  tradeCount: number;
  benchmarkReturn: number;
}
```

A backtest result is incomplete without a trade ledger, daily equity series, benchmark series, data-quality warnings, and the full execution assumptions. Metrics alone are insufficient for auditing.

### 5.4 Optional event and sentiment contracts

```ts
export interface MarketEvent {
  id: string;
  sourceId: string;
  sourceUrl?: string;
  title: string;
  publishedAt?: string;
  firstSeenAt: string;
  eventType: string;
  entities: Array<{
    instrumentId?: string;
    sector?: string;
    relation: string;
  }>;
  textHash: string;
}

export interface EventFeatures {
  eventId: string;
  modelId: string;
  modelVersion: string;
  promptVersion: string;
  sentimentScore: number; // -1 to +1
  severityScore: number;  // 0 to 1
  noveltyScore: number;   // 0 to 1
  confidence: number;     // 0 to 1
  generatedAt: string;
}
```

Sentiment scores are model outputs, not facts or validated probabilities. Keep source content, extraction metadata and model outputs separate. Never overwrite a historical event's first-seen timestamp with a later correction.

## 6. SQLite schema

Use versioned SQL migrations. The schema below is the MVP baseline; optional event tables can be introduced in a later migration without changing the core research schema.

### 6.1 Instruments and market data

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE instruments (
    id              TEXT PRIMARY KEY,
    exchange        TEXT NOT NULL CHECK (exchange = 'NSE'),
    symbol          TEXT NOT NULL,
    isin            TEXT,
    name            TEXT NOT NULL,
    instrument_type TEXT NOT NULL
        CHECK (instrument_type = 'ORDINARY_EQUITY'),
    listing_date    TEXT,
    delisting_date  TEXT,
    currency        TEXT NOT NULL DEFAULT 'INR',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    UNIQUE (exchange, symbol)
);

CREATE INDEX idx_instruments_isin
    ON instruments(isin);

CREATE TABLE import_batches (
    id              TEXT PRIMARY KEY,
    source_id       TEXT NOT NULL,
    file_name       TEXT,
    file_hash       TEXT,
    started_at      TEXT NOT NULL,
    completed_at    TEXT,
    status          TEXT NOT NULL
        CHECK (status IN ('RUNNING','COMPLETED','FAILED')),
    rows_read       INTEGER NOT NULL DEFAULT 0,
    rows_accepted   INTEGER NOT NULL DEFAULT 0,
    rows_rejected   INTEGER NOT NULL DEFAULT 0,
    error_summary   TEXT
);

CREATE TABLE daily_bars (
    instrument_id   TEXT NOT NULL REFERENCES instruments(id),
    trading_date    TEXT NOT NULL,
    open            REAL NOT NULL,
    high            REAL NOT NULL,
    low             REAL NOT NULL,
    close           REAL NOT NULL,
    volume          INTEGER NOT NULL,
    source_batch_id TEXT NOT NULL REFERENCES import_batches(id),
    PRIMARY KEY (instrument_id, trading_date),
    CHECK (open > 0 AND high > 0 AND low > 0 AND close > 0),
    CHECK (high >= low),
    CHECK (high >= open AND high >= close),
    CHECK (low <= open AND low <= close),
    CHECK (volume >= 0)
);

CREATE INDEX idx_daily_bars_date
    ON daily_bars(trading_date);

CREATE TABLE corporate_actions (
    id                TEXT PRIMARY KEY,
    instrument_id     TEXT NOT NULL REFERENCES instruments(id),
    ex_date           TEXT NOT NULL,
    action_type       TEXT NOT NULL,
    ratio_numerator   INTEGER,
    ratio_denominator INTEGER,
    cash_amount       REAL,
    source_id         TEXT NOT NULL,
    verified          INTEGER NOT NULL DEFAULT 0
        CHECK (verified IN (0,1))
);

CREATE INDEX idx_corporate_actions_instrument_date
    ON corporate_actions(instrument_id, ex_date);

CREATE TABLE data_quality_issues (
    id              TEXT PRIMARY KEY,
    import_batch_id TEXT REFERENCES import_batches(id),
    instrument_id   TEXT REFERENCES instruments(id),
    trading_date    TEXT,
    severity        TEXT NOT NULL
        CHECK (severity IN ('INFO','WARNING','ERROR')),
    code            TEXT NOT NULL,
    message         TEXT NOT NULL,
    created_at      TEXT NOT NULL
);
```

**Important:** `daily_bars` contains raw observations. It does not imply that raw prices are appropriate for every return calculation. The adjustment process must apply verified corporate actions consistently and produce a documented, reproducible price series. Never apply adjustments twice.

The source batch is retained so that every imported record can be traced to its origin. When an import corrects historical data, log the change and invalidate or version affected data snapshots rather than silently changing the basis of old results.

### 6.2 Universe and strategy configuration

```sql
CREATE TABLE universe_definitions (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    version         INTEGER NOT NULL,
    rules_json      TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    UNIQUE(name, version)
);

CREATE TABLE universe_memberships (
    universe_id     TEXT NOT NULL REFERENCES universe_definitions(id),
    instrument_id   TEXT NOT NULL REFERENCES instruments(id),
    effective_from  TEXT NOT NULL,
    effective_to    TEXT,
    eligibility     TEXT NOT NULL,
    PRIMARY KEY (
        universe_id, instrument_id, effective_from
    )
);

CREATE INDEX idx_universe_membership_dates
    ON universe_memberships(
        universe_id, effective_from, effective_to
    );

CREATE TABLE strategies (
    id              TEXT NOT NULL,
    version         INTEGER NOT NULL,
    name            TEXT NOT NULL,
    definition_json TEXT NOT NULL,
    definition_hash TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    PRIMARY KEY(id, version)
);

CREATE TABLE data_snapshots (
    id                TEXT PRIMARY KEY,
    source_manifest   TEXT NOT NULL,
    adjustment_policy TEXT NOT NULL,
    universe_hash     TEXT NOT NULL,
    created_at        TEXT NOT NULL
);
```

Universe membership is date-effective. This is necessary because a strategy must not use today's list of securities as if it were the correct list for every historical date.

For the initial version, the user may import a current universe and clearly label its historical limitations. Point-in-time constituent and delisting history should be added as reliable data becomes available.

### 6.3 Backtests and results

```sql
CREATE TABLE backtest_runs (
    id                   TEXT PRIMARY KEY,
    strategy_id          TEXT NOT NULL,
    strategy_version     INTEGER NOT NULL,
    data_snapshot_id     TEXT NOT NULL REFERENCES data_snapshots(id),
    benchmark_id         TEXT NOT NULL,
    start_date           TEXT NOT NULL,
    end_date             TEXT NOT NULL,
    initial_cash         TEXT NOT NULL,
    cost_model_json      TEXT NOT NULL,
    execution_model_json TEXT NOT NULL,
    engine_version       TEXT NOT NULL,
    status               TEXT NOT NULL
        CHECK (status IN (
            'QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED'
        )),
    started_at           TEXT,
    completed_at         TEXT,
    error_message        TEXT,
    FOREIGN KEY(strategy_id, strategy_version)
        REFERENCES strategies(id, version)
);

CREATE TABLE backtest_metrics (
    run_id          TEXT NOT NULL REFERENCES backtest_runs(id),
    metric_name     TEXT NOT NULL,
    metric_value    REAL,
    PRIMARY KEY(run_id, metric_name)
);

CREATE TABLE backtest_equity (
    run_id          TEXT NOT NULL REFERENCES backtest_runs(id),
    trading_date    TEXT NOT NULL,
    portfolio_value TEXT NOT NULL,
    cash_value      TEXT NOT NULL,
    benchmark_value TEXT,
    PRIMARY KEY(run_id, trading_date)
);

CREATE TABLE backtest_orders (
    id              TEXT PRIMARY KEY,
    run_id          TEXT NOT NULL REFERENCES backtest_runs(id),
    instrument_id   TEXT NOT NULL REFERENCES instruments(id),
    signal_date     TEXT NOT NULL,
    execution_date  TEXT,
    side            TEXT NOT NULL CHECK (side IN ('BUY','SELL')),
    quantity        TEXT NOT NULL,
    fill_price      TEXT,
    fees            TEXT,
    slippage        TEXT,
    status          TEXT NOT NULL,
    reason          TEXT
);

CREATE INDEX idx_backtest_orders_run
    ON backtest_orders(run_id, execution_date);
```

`quantity`, `fill_price`, `fees`, `slippage`, `initial_cash` and portfolio values are stored as text here to support an explicit decimal representation. They must be parsed and validated by the domain layer; the application must never perform arithmetic on those strings.

For larger datasets, store equity curves and trade ledgers efficiently, and index only the access paths used by the UI and analysis engine.

### 6.4 Paper portfolios

```sql
CREATE TABLE paper_portfolios (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    strategy_id      TEXT,
    strategy_version INTEGER,
    initial_cash     TEXT NOT NULL,
    created_at       TEXT NOT NULL,
    status           TEXT NOT NULL
        CHECK (status IN ('ACTIVE','PAUSED','ARCHIVED')),
    FOREIGN KEY(strategy_id, strategy_version)
        REFERENCES strategies(id, version)
);

CREATE TABLE paper_orders (
    id              TEXT PRIMARY KEY,
    portfolio_id    TEXT NOT NULL REFERENCES paper_portfolios(id),
    signal_id       TEXT,
    instrument_id   TEXT NOT NULL REFERENCES instruments(id),
    created_at      TEXT NOT NULL,
    execution_date  TEXT,
    side            TEXT NOT NULL CHECK (side IN ('BUY','SELL')),
    quantity        TEXT NOT NULL,
    fill_price      TEXT,
    fees            TEXT,
    status          TEXT NOT NULL,
    reason          TEXT
);

CREATE TABLE paper_ledger (
    id              TEXT PRIMARY KEY,
    portfolio_id    TEXT NOT NULL REFERENCES paper_portfolios(id),
    order_id        TEXT REFERENCES paper_orders(id),
    occurred_at     TEXT NOT NULL,
    entry_type      TEXT NOT NULL,
    instrument_id   TEXT REFERENCES instruments(id),
    quantity_delta  TEXT,
    cash_delta      TEXT NOT NULL,
    reference_price TEXT,
    description     TEXT NOT NULL
);

CREATE INDEX idx_paper_ledger_portfolio_time
    ON paper_ledger(portfolio_id, occurred_at);
```

The ledger is the source of truth for paper cash movements. Holdings and current portfolio value can be derived from ledger entries and the latest eligible prices, with optional cached snapshots for performance.

Paper orders must support cancelled and rejected states as well as filled orders. Never treat a signal as a fill simply because it exists.

### 6.5 Optional market intelligence tables

Add these only when implementing that module.

```sql
CREATE TABLE market_events (
    id            TEXT PRIMARY KEY,
    source_id     TEXT NOT NULL,
    source_url    TEXT,
    title         TEXT NOT NULL,
    published_at  TEXT,
    first_seen_at TEXT NOT NULL,
    event_type    TEXT NOT NULL,
    text_hash     TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    UNIQUE(source_id, text_hash)
);

CREATE TABLE event_features (
    event_id        TEXT NOT NULL REFERENCES market_events(id),
    model_id        TEXT NOT NULL,
    model_version   TEXT NOT NULL,
    prompt_version  TEXT NOT NULL,
    sentiment_score REAL NOT NULL
        CHECK (sentiment_score BETWEEN -1 AND 1),
    severity_score  REAL NOT NULL
        CHECK (severity_score BETWEEN 0 AND 1),
    novelty_score   REAL NOT NULL
        CHECK (novelty_score BETWEEN 0 AND 1),
    confidence      REAL NOT NULL
        CHECK (confidence BETWEEN 0 AND 1),
    generated_at    TEXT NOT NULL,
    output_json     TEXT NOT NULL,
    PRIMARY KEY (
        event_id, model_id, model_version, prompt_version
    )
);
```

Store entity relationships in a separate junction table when the event module is implemented. Avoid embedding an unqueryable list of affected securities in the event record if the goal is to analyze event impact by company or sector.

## 7. Module interfaces

These interfaces define how modules interact. Concrete implementations can change without changing the strategy domain or application workflows.

### 7.1 Data adapters and repositories

```ts
export interface MarketDataAdapter {
  readonly id: string;

  inspect(input: ImportInput): Promise<ImportPreview>;

  import(
    input: ImportInput,
    onProgress?: (progress: ImportProgress) => void,
  ): Promise<ImportResult>;
}

export interface PriceHistoryRepository {
  getBars(
    instrumentIds: InstrumentId[],
    from: IsoDate,
    to: IsoDate,
    policy: PriceAdjustmentPolicy,
  ): Promise<PriceBar[]>;

  getAvailableHistory(
    instrumentId: InstrumentId,
  ): Promise<HistoryCoverage>;
}

export interface InstrumentRepository {
  search(query: string, limit: number): Promise<Instrument[]>;

  getById(id: InstrumentId): Promise<Instrument | null>;

  getUniverse(
    universeId: string,
    asOf: IsoDate,
  ): Promise<Instrument[]>;
}
```

`ImportInput` should represent a selected local file or an adapter-specific input reference, not an arbitrary network URL. Import previews should show the source, detected schema, date range, symbol coverage, duplicates and invalid records before committing data.

### 7.2 Strategy and backtest engine

```ts
export interface StrategyEngine {
  validate(definition: StrategyDefinition): ValidationResult;

  generateSignals(
    definition: StrategyDefinition,
    context: StrategyContext,
  ): Signal[];
}

export interface BacktestEngine {
  run(
    request: BacktestRequest,
    onProgress?: (progress: BacktestProgress) => void,
  ): Promise<BacktestResult>;
}

export interface BenchmarkProvider {
  getReturns(
    benchmarkId: string,
    from: IsoDate,
    to: IsoDate,
  ): Promise<BenchmarkSeries>;
}

export interface CostModel {
  calculate(
    order: ProposedOrder,
    fill: SimulatedFill,
  ): CostBreakdown;
}
```

The backtest engine should be deterministic for a given data snapshot, strategy definition, engine version and execution configuration. Randomized algorithms, if introduced later, must accept and record an explicit seed.

The engine must not read future bars to make today's decision. This should be enforced by its input design and verified with automated tests—not merely documented as a convention.

### 7.3 Paper-trading interface

```ts
export interface PaperTradingService {
  createPortfolio(
    request: CreatePaperPortfolioRequest,
  ): Promise<PaperPortfolio>;

  previewOrders(
    portfolioId: string,
    signals: Signal[],
  ): Promise<ProposedOrder[]>;

  executeSimulatedOrders(
    portfolioId: string,
    orders: ProposedOrder[],
    policy: PaperExecutionPolicy,
  ): Promise<PaperExecutionResult>;

  getSnapshot(
    portfolioId: string,
    asOf: IsoDate,
  ): Promise<PaperPortfolioSnapshot>;
}
```

Paper trading must have no code path to live order placement. A future broker connector may supply market data, but it must not implicitly enable trading. Any later live-execution project would require a separate scope, safety review and regulatory review.

### 7.4 Application use cases

The UI should invoke explicit workflows, such as:

- `PreviewMarketDataImport`
- `CommitMarketDataImport`
- `CreateStrategyVersion`
- `RunBacktest`
- `CompareBacktests`
- `GeneratePaperSignals`
- `PreviewPaperOrders`
- `ExecutePaperOrders`
- `ExportWorkspaceBackup`

Each use case validates its input, calls the relevant domain interfaces, persists the outcome and returns a typed result or actionable error. Avoid a generic service with dozens of unrelated methods.

## 8. Backtesting requirements

A sophisticated UI cannot compensate for a flawed simulation. The following rules belong in the engine from the beginning.

1. **No look-ahead bias:** a signal calculated from closing prices cannot fill at that same close unless the model explicitly supports a valid executable closing-auction assumption and uses only information available before the order cutoff.
2. **Corporate-action consistency:** handle splits, bonuses and dividends according to a documented policy. Adjusted prices must not be adjusted twice.
3. **Historical universe limitations:** record the universe available on each date. Current-only security lists must be labelled as potentially survivorship-biased.
4. **Costs:** model brokerage and relevant statutory/exchange charges where possible, plus slippage. Version the cost model and document any omissions.
5. **Portfolio constraints:** prevent accidental overspending, impossible quantities, negative cash where prohibited, duplicate orders and invalid fills.
6. **Chronological validation:** keep development and out-of-sample periods separate. Do not repeatedly tune parameters on the out-of-sample period.
7. **Benchmark consistency:** use compatible date ranges, price/total-return assumptions and trading calendars.
8. **Missing data:** fail or exclude according to explicit rules; never fabricate a zero return from an absent price.
9. **Reproducibility:** preserve the data snapshot, strategy version, parameters, cost assumptions and engine version.
10. **Uncertainty:** report sample size and important limitations. A profitable backtest is evidence to investigate, not proof of future profitability.

For Indian equities, daily data coverage across every available ordinary share will be the most challenging part of the MVP. Free data may be fragmented, have incomplete history or be subject to use restrictions. The application must expose coverage gaps rather than imply it has researched every security when it has not.

## 9. Acceptance criteria

### Data foundation

- [ ] Import a documented daily OHLCV file and preview its contents before committing.
- [ ] Repeated imports are idempotent or explicitly report corrections; duplicate bars are not silently added.
- [ ] Invalid OHLC values, malformed dates and unknown symbols are reported.
- [ ] Coverage can be queried by security and date range, with source provenance retained.
- [ ] Database backup and restore are tested.

### Strategies and backtesting

- [ ] Create and save multiple strategy definitions with versioned parameters.
- [ ] Validate unsupported indicators, invalid operands and out-of-range parameters.
- [ ] Run a backtest without blocking the UI and report progress or failure.
- [ ] Repeat a run with identical inputs and reproduce the same trades and metrics.
- [ ] Inspect trade-level details, daily portfolio value, costs, benchmark and drawdown.
- [ ] Tests detect look-ahead bias, missing-data errors and invalid execution timing.

### Paper trading

- [ ] Generate signals from a saved strategy and inspect proposed orders before execution.
- [ ] Record simulated fills, fees, cash movements and holdings persistently.
- [ ] Reload the app and recover the portfolio state accurately.
- [ ] No paper-trading workflow can place a real order.

### Local-first reliability

- [ ] Core research works without a running backend.
- [ ] Storage failures and unavailable browser capabilities are surfaced clearly.
- [ ] Export and restore a workspace using a documented backup format.
- [ ] Database migrations are tested against a representative existing workspace.
- [ ] News and broker integrations can be absent without breaking core workflows.

## 10. Implementation backlog

### P0 — Repository and persistence foundation

- [ ] Initialize TypeScript, React, Vite, linting and tests.
- [ ] Add SQLite WASM and a dedicated database worker.
- [ ] Implement migration runner, schema versioning and transactions.
- [ ] Implement export/restore and storage capability checks.
- [ ] Add the first import format and data-quality report.

### P1 — Canonical market data and universe

- [ ] Implement instrument identity and symbol mapping.
- [ ] Import and validate daily OHLCV.
- [ ] Track import provenance, coverage and corrections.
- [ ] Add corporate-action ingestion and documented adjustment policies.
- [ ] Build universe definitions, including date-effective membership.
- [ ] Show unsupported or incomplete historical coverage.

### P2 — Configurable strategy framework

- [ ] Define the typed strategy schema and validation rules.
- [ ] Register initial indicators and operators.
- [ ] Implement ranking, eligibility, entry and exit rules.
- [ ] Implement position sizing and portfolio constraints.
- [ ] Add a minimal strategy editor and version history.
- [ ] Test strategy definitions independently of the UI.

### P3 — Backtesting and risk analytics

- [ ] Implement the deterministic simulation loop in a Web Worker.
- [ ] Implement execution timing, costs, slippage and cash accounting.
- [ ] Persist run configurations, equity curves and trade ledgers.
- [ ] Add benchmark comparisons and drawdown metrics.
- [ ] Add golden-result regression tests and look-ahead tests.
- [ ] Build a basic backtest comparison view.

### P4 — Paper portfolio and research workflow

- [ ] Generate and review proposed signals.
- [ ] Implement the simulated order lifecycle and ledger.
- [ ] Calculate portfolio holdings, cash, exposure and valuation.
- [ ] Add persistent research notes and experiment comparisons.
- [ ] Test restart recovery and invalid-order handling.

### P5 — Optional intelligence extensions

- [ ] Add a source adapter for timestamped news or official filings.
- [ ] Add event classification and deduplication.
- [ ] Store versioned sentiment and event features.
- [ ] Compare a baseline strategy against a regime-aware variant.
- [ ] Evaluate news features out of sample before incorporating them into decisions.

The backlog is organized by dependency, not by fixed calendar promises. With 5–8 hours available weekly, the dates should follow working increments rather than arbitrary sprints. P0 and P1 establish data trust; P2 and P3 establish the research engine; P4 makes it usable for ongoing paper trading; P5 is optional.

## 11. Key trade-offs and decisions

| Decision | Chosen approach | Trade-off |
|---|---|---|
| Application model | Local-first PWA | Limited background execution and browser-dependent persistence |
| Database | SQLite WASM + OPFS | Requires worker and browser-storage engineering |
| Strategy extensibility | Declarative definitions | Safer and testable, but less expressive than arbitrary code |
| Market coverage | All available NSE ordinary shares | Data completeness, symbol mapping and historical survivorship become major work |
| Data cost | Free daily sources initially | Limited history, adjustment quality and licensing constraints |
| News intelligence | Optional module | Lower initial complexity; historical news coverage remains a later challenge |
| Trading | Paper only | No execution risk from accidental live orders; paper fills still differ from reality |

### Two important limitations to resolve early

**Universe coverage:** “All available NSE ordinary shares” is the target, not a claim that complete historical data is readily available. Distinguish the current universe, historical universe, and securities for which reliable data exists. Make the coverage visible in every research run.

**Browser environment:** a PWA can work without a backend, but large historical datasets and long backtests may strain browser storage and memory. Use streaming imports, indexed queries and Web Workers. Benchmark realistic dataset sizes before choosing aggressive caching or precomputing every indicator.

## 12. Final implementation recommendation

Build in this order:

1. **P0–P1:** a trustworthy local dataset and data-quality workflow.
2. **P2–P3:** a configurable strategy engine and reproducible backtesting.
3. **P4:** a paper portfolio that survives restarts and can be audited.
4. **P5:** news, sentiment and market-regime experiments.

The MVP should be considered successful when you can test a strategy across your available NSE universe, inspect every simulated trade, reproduce the results, and understand the data limitations—without needing a server or risking real money.

The architecture deliberately allows the research engine, data adapters, user interface and intelligence modules to evolve separately. That is the flexibility worth building now; advanced dashboards, broker integration and AI features can wait until the core system earns them.
