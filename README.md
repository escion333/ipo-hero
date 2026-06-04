# IPO Hero

IPO Hero is a single-filing S-1 analysis workbench for the SpaceX IPO filing. The product premise is to make a dense registration statement easier for a retail investor to inspect through source-cited, plain-English analysis.

This first pass focuses on ingestion rather than a polished interface. Before adding AI, search, accounts, payments, or a richer UI, the project needs to prove it can fetch, cache, parse, segment, analyze, validate, and cite the filing reliably.

## Commands

```bash
npm install
npm run ingest
npm run ingest:force
npm run validate:data
npm run review:merge
npm run brief
npm run validate:brief
npm run dev
npm run lint
npm run typecheck
npm run build
```

`npm run ingest` downloads the filing index and main S-1 HTML into `raw/`, parses sections and tables, creates source-citable chunks, extracts deterministic facts and risk factors, writes JSON artifacts, and runs validation.

`npm run ingest` reuses cached raw SEC files and skips regeneration when raw source hashes and extractor versions match the current manifest. Use `npm run ingest:force` to refetch and regenerate everything.

`npm run brief` builds the stricter Retail Investor Brief v1 from source-backed evidence cards. It writes `src/data/generated/evidence-cards.generated.json`, `src/data/generated/brief.v1.generated.json`, and `docs/spaceX-ipo-brief.v1.generated.md`, then validates source citations and usefulness gates. The earlier v0 files remain available for comparison.

## Data Artifacts

Generated app-ready data lives in `src/data/generated/`:

- `filing-index.json`: source index metadata.
- `documents.json`: filing package document inventory.
- `sections.json`: best-effort S-1 section tree.
- `chunks.json`: section-aware source chunks with citation labels.
- `facts.json`: deterministic fact candidates with source references.
- `risks.json`: risk factor records split and classified by rules.
- `facts.generated.json`: overwriteable generated fact records.
- `risks.generated.json`: overwriteable generated risk records.
- `tables.json`: raw table text/html candidates.
- `extraction-report.json`: counts, coverage flags, warnings, and fatal errors.
- `manifest.json`: source hashes, parser/extractor versions, counts, and artifact hashes.
- `diagnostics.json`: golden-check results, suspicious risk diagnostics, table association summary, warnings, and fatal errors.
- `extraction-snapshot.json`: last extraction summary used for drift comparison.
- `risk-audit.json`: risk extraction audit with counts by category, source section, extraction type, length thresholds, suspicious samples, and normal-length samples.
- `evidence-cards.generated.json`: accepted source-backed disclosure cards used by Brief v1.
- `evidence-cards.rejected.json`: weak drafts rejected before Brief v1 assembly, with reasons.
- `brief.generated.json`: earlier static source-cited Retail Investor Brief v0, retained for comparison.
- `brief.v1.generated.json`: stricter evidence-card-based Retail Investor Brief v1.

Raw SEC downloads live in `raw/` and are gitignored except for `.gitkeep`.

Reviewed overrides live in `src/data/reviewed/`:

- `facts.reviewed.json`
- `risks.reviewed.json`
- `brief.reviewed.json`

Ingestion creates these files as empty arrays if they are missing, but never overwrites them. `npm run review:merge` merges reviewed records over generated records by `id` and writes the app-facing `facts.json` and `risks.json`.

The earlier generated Markdown brief lives at `docs/spaceX-ipo-brief.generated.md`. The current Brief v1 Markdown lives at `docs/spaceX-ipo-brief.v1.generated.md`. Brief v1 is deterministic and evidence-card based; suspicious risk records are excluded from the main risk-theme section and counted in diagnostics.

## Quality Harness

Validation now separates fatal errors from warnings. Fatal failures include missing core artifacts, missing main S-1, zero sections or chunks, missing Risk Factors section, duplicate IDs, missing source URLs, facts or risks without source references, empty chunks, and fact quotes that cannot be found in their cited chunks.

Warnings call attention to likely parser drift or false confidence: sparse fact extraction, high or low risk counts, missing golden sections, short risk records, duplicate risk titles, low-confidence sections, table association gaps, concentrated fact categories, and large count changes versus the prior snapshot.

Golden checks are hand-authored in `scripts/ingest/golden-checks.ts` and look for expected S-1 concepts such as Prospectus Summary, Risk Factors, Use of Proceeds, Dilution, MD&A, Business, Description of Capital Stock, Shares Eligible for Future Sale, and Underwriting.

The manual reviewer workflow lives in `docs/manual-audit-checklist.md`. Use it to confirm the source package, major sections, ownership/control match, suspicious risks, full-text risks, table candidates, and facts before promoting records into `src/data/reviewed/`.

Brief validation fails if required v1 sections are missing, cited chunks do not exist, citation quotes are not found in source chunks, rejected evidence cards enter the brief, fewer than 8 high-quality evidence cards exist, fewer than 5 notice items can be produced, or generated text contains advice-like language.

## Product Rules

- No buy, sell, or hold recommendations.
- No IPO score.
- No investment advice.
- Important claims must trace back to source text.
- Unknown or weakly extracted facts should be marked as low-confidence or review-needed.

## Known Limitations

- This is not a generalized EDGAR parser.
- Heading detection and risk splitting are heuristic.
- Tables are extracted, but financial statement normalization is not implemented yet.
- Offering terms may be preliminary or absent and should not be hallucinated.
- Current diagnostics distinguish full-text risk factors from fragments, heading-only records, and table-of-contents entries. Suspicious records remain auditable and are marked with `needsReview`, `extractionWarning`, and `riskExtractionType`.
- The UI is a local workbench for inspecting artifacts, not a finished consumer product.

## Next Steps

- Improve table normalization for financial statements.
- Add a red-flag candidate view driven by source chunks.
- Add a markdown analyst brief export.
- Add optional source-grounded LLM analysis after deterministic parsing is stable.
