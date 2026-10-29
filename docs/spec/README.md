# Stock Analyzer: as-built specification

What the app does **today**, written from the code (commit `6212473`, 2026-10-28). It complements, and does not replace:

| Document | Role |
|---|---|
| [`/specs`](../../specs) | The original design baseline: goals, principles, full target scope, milestones. Describes intent. |
| [`../roadmap.md`](../roadmap.md) | Future ideas (multi-user, paper trading, auto ordering). Not designed. |
| [`../provider-feasibility.md`](../provider-feasibility.md) | Probe results for FYERS and Breeze. |
| [`../backend-design.md`](../backend-design.md) | Why the shared backend is shaped as it is, with measurements. |

This folder is the **current behaviour**. When code and these docs disagree, the code wins; fix the doc.

## Contents

1. [Product](01-product.md): scope, pages, user-visible behaviour, what is not built.
2. [Architecture](02-architecture.md): layers, state, storage, deployment, security rules.
3. [Market data](03-market-data.md): sources, the data badge, provider contract, end-of-day backend data, intraday.
4. [Scanner and strategies](04-scanner-and-strategies.md): fields, rules, presets, ranking, trade plans, position sizing.
5. [Backend API](05-backend-api.md): `/api/data/*` and `/api/breeze/*`, published files, ingest, configuration.

## Status against the baseline `specs` milestones

| Milestone | State |
|---|---|
| 0 Feasibility prototypes | Done for FYERS and Breeze (mock-verified; see feasibility doc). Live verification of Breeze index codes and tick layout is still open. |
| 1 Local foundation | Done: PWA, Dexie storage, settings, export/import. |
| 2 Scanner engine | Done: typed rule tree, presets, builder, explanations, ranking. |
| 3 Charts and signals | Done, with snapshot signals only (no persisted signal lifecycle). |
| 4 Market-data integration | Done beyond the baseline: FYERS, Breeze, market-wide NSE+BSE end-of-day backend, intraday via Upstox. |
| 5 News and alerts | Not built. |
| 6 Validation and packaging | Not built (no journal, paper trading, backtest, Capacitor/Tauri). |

## Deviations from the baseline spec

- **No built-in stock list** except the 50 synthetic demo stocks. The baseline assumed a fixed universe.
- **Shared backend is real and central** (baseline §4.5): market-wide scans depend on it.
- **Tailwind, Zustand, Zod, Lightweight Charts, Dexie, Vitest** are used as proposed. **Playwright is not.**
- **Windows/Android** are served by the installable PWA only.
- **Scanner timeframes** are `1D` and `15m`; only `1D` runs. Charts have eight timeframes (see Market data).
