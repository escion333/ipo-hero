# Ingestion Notes

IPO Hero App 2 is intentionally scoped to one SEC filing package:

- Filing: Space Exploration Technologies Corp. Form S-1
- Accession: `0001628280-26-036936`
- Filed: `2026-05-20`
- Main HTML: `spaceexplorationtechnologi.htm`

The ingestion pipeline fetches the SEC filing index and main S-1 HTML into `raw/`, then writes normalized static artifacts to `src/data/generated/`.

Raw SEC files are gitignored because they can be large and are reproducible from source URLs. Generated JSON artifacts are designed to be committed when they remain small enough for the static app to import.

## Parser Limitations

- Heading detection is heuristic and tuned for this filing, not all EDGAR filings.
- Financial tables are extracted separately but are not yet normalized into statement line items.
- Risk factor splitting uses deterministic title/body rules and should be reviewed before consumer-facing display.
- Fact extraction produces conservative candidates and marks uncertain values with lower confidence or `needsReview`.
- No LLM or vector database is used in this phase.
