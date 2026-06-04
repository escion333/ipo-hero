# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

IPO Hero is a single-filing S-1 analysis workbench scoped to **one hardcoded SEC filing**: the SpaceX (Space Exploration Technologies Corp.) Form S-1, accession `0001628280-26-036936`. It is deliberately not a general EDGAR parser. The current phase is deterministic ingestion (fetch → parse → segment → extract → validate → cite); there is no LLM, vector DB, search backend, accounts, or payments yet.

## Commands

```bash
npm run ingest          # full pipeline; reuses cache + skips regen when hashes/versions match
npm run ingest:force    # refetch raw SEC files and regenerate all artifacts
npm run validate:data   # run validation against existing generated artifacts only
npm run review:merge    # merge reviewed overrides into app-facing facts.json / risks.json
npm run dev             # Vite dev server for the React workbench
npm run lint            # eslint
npm run typecheck       # tsc --noEmit
npm run build           # tsc -b && vite build
```

Ingestion scripts run via `tsx` (not compiled). There is no test runner configured.

## Architecture: two stages connected by static JSON

This is the central thing to understand. The pipeline and the app are decoupled — they communicate **only through committed JSON files in `src/data/generated/`**. The app never fetches or parses at runtime; it imports the generated JSON at build time (`resolveJsonModule`).

**Stage 1 — Ingestion** (`scripts/`, Node/tsx). Orchestrated by [scripts/ingest/run-ingestion.ts](scripts/ingest/run-ingestion.ts):
1. Fetch SEC filing index + main S-1 HTML into `raw/` (gitignored), cached via `fetchWithCache` in [scripts/lib/sec.ts](scripts/lib/sec.ts). The filing URL/accession are constants in `TARGETS` there.
2. Parse the index ([parse-index.ts](scripts/ingest/parse-index.ts)), then parse sections + tables from HTML ([scripts/lib/html.ts](scripts/lib/html.ts), uses cheerio). Heading detection is heuristic and tuned for this one filing.
3. Chunk sections into citable units ([chunk-sections.ts](scripts/ingest/chunk-sections.ts)).
4. Extract risks ([extract-risks.ts](scripts/ingest/extract-risks.ts)) and deterministic facts ([extract-facts.ts](scripts/ingest/extract-facts.ts)) from chunks — regex/rule based, no LLM.
5. Merge human-reviewed overrides over generated records, run golden checks ([golden-checks.ts](scripts/ingest/golden-checks.ts)), compute diagnostics + snapshot drift, write artifacts, then validate.

**Stage 2 — App** (`src/`, React + Vite + Tailwind v4). [src/lib/filing-data.ts](src/lib/filing-data.ts) imports every generated JSON file and casts it into the `filingData` object that [src/App.tsx](src/App.tsx) renders. The app is a read-only inspector over those artifacts.

## The type contract: one source of truth

[scripts/lib/schema.ts](scripts/lib/schema.ts) holds the zod schemas (`FilingDocument`, `FilingSection`, `FilingChunk`, `FilingFact`, `RiskFactor`, `ExtractionReport`) and is the **single source of truth** for record shapes — used by the pipeline, by validation, and (via inferred types) by the app. [src/lib/types.ts](src/lib/types.ts) is just a **type-only re-export** of those inferred types, so zod is erased from the app bundle while the app stays in lock-step with the schema. Change a record shape in schema.ts and both sides update automatically; this file is the shared interface between the ingestion and UI layers.

## Caching / idempotency model

`npm run ingest` is idempotent and cheap by design. It reuses prior outputs unless something material changed. Reuse happens only when **all** hold (see the `canReuseGenerated` check in run-ingestion.ts):
- `--force` was not passed,
- raw source file SHA-256 hashes match `manifest.json`,
- `PARSER_VERSIONS` (in [scripts/lib/artifacts.ts](scripts/lib/artifacts.ts)) matches the manifest,
- all required generated files exist.

**When you change extraction/parsing logic, bump the relevant key in `PARSER_VERSIONS`** — otherwise `npm run ingest` will skip regeneration and your change won't take effect. Reviewers/CI rely on this to detect drift.

## Reviewed-override flow

Human corrections live in `src/data/reviewed/{facts,risks}.reviewed.json` (created as empty arrays if missing, **never overwritten** by ingestion). `mergeReviewed` (in artifacts.ts) overlays reviewed records onto generated ones **by `id`**, and appends reviewed records whose id isn't in the generated set. The merge produces the app-facing `facts.json` / `risks.json`. Generated-only outputs are kept separately as `facts.generated.json` / `risks.generated.json`. `npm run review:merge` re-runs just this merge without re-fetching.

## Validation: fatal vs. warning

[validate-output.ts](scripts/ingest/validate-output.ts) splits results into **errors** (fatal → `process.exit(1)`) and **warnings** (printed, non-fatal). Fatal cases include missing core artifacts, missing main S-1, zero sections/chunks, missing Risk Factors, duplicate IDs, missing source URLs, facts/risks lacking source references, and fact quotes not found in their cited chunk. Warnings flag likely parser drift (sparse facts, risk over-splitting, missing golden sections, large count deltas vs the prior `extraction-snapshot.json`). The risk splitter is heuristic and currently over-produces short records — expect risk warnings.

## Product constraints (enforce in any analysis/UI work)

No buy/sell/hold recommendations, no IPO score, no investment advice. Every important claim must trace to source text via `sourceChunkIds` / `sourceQuote`. Mark weak extractions `needsReview` or low `confidence` rather than asserting them. Fact/risk/confidence taxonomies are fixed in [docs/analysis-taxonomy.md](docs/analysis-taxonomy.md) and mirrored in the zod enums.
