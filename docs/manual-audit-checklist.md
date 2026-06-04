# Manual Audit Checklist

Use this checklist after `npm run ingest:force` and `npm run validate:data`.

## Source Package

- [ ] Confirm `documents.json` identifies the main S-1 HTML as `spaceexplorationtechnologi.htm`.
- [ ] Confirm `manifest.json` has SHA-256 hashes for the filing index and main S-1 HTML.
- [ ] Confirm the accession number is `0001628280-26-036936`.

## Major Sections

- [ ] Review `extraction-report.json` golden checks.
- [ ] Confirm Prospectus Summary, Risk Factors, Use of Proceeds, Dividend Policy, Capitalization, Dilution, MD&A, Business, Management, Related Party Transactions, Description of Capital Stock, Shares Eligible for Future Sale, and Underwriting.
- [ ] Review the ownership/control match. For this filing, the expected Principal Stockholders concept may appear as `Security Ownership of Certain Beneficial Owners and Management`.

## Risk Factors

- [ ] Open `risk-audit.json`.
- [ ] Review the count of `full_text` risks versus `fragment`, `heading_only`, and `toc_entry` records.
- [ ] Review 20 suspicious risk factors from `suspiciousRiskSample`.
- [ ] Review 20 full-text risk factors from `normalLengthRiskSample`.
- [ ] Check duplicate or near-duplicate titles.
- [ ] Confirm suspicious records have `needsReview: true`, `extractionWarning`, and a non-`full_text` `riskExtractionType`.

## Tables

- [ ] Review table extraction summary in `diagnostics.json`.
- [ ] Inspect table candidates for income statement, balance sheet, cash flow, capitalization, and dilution.
- [ ] Do not promote table-derived figures until the table text and source section are confirmed.

## Facts

- [ ] Review all high-confidence facts in `facts.generated.json`.
- [ ] Review candidate facts with `needsReview: true`.
- [ ] Confirm ownership/control, dilution, proceeds, lockup, debt/liquidity, related-party, and financial candidates cite relevant chunks.
- [ ] Promote corrected or confirmed records into `src/data/reviewed/facts.reviewed.json`.

## Reviewed Overrides

- [ ] Promote reviewed risks into `src/data/reviewed/risks.reviewed.json`.
- [ ] Run `npm run review:merge`.
- [ ] Run `npm run validate:data`.
