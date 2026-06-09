# Handoff prompt — deeper content-quality pass on the SpaceX IPO Brief

> Paste everything below the line into a fresh agent. It is self-contained.

---

You are improving the **reader-facing content quality** of the "IPO Hero" SpaceX S-1 Brief. This is a deterministic, no-LLM ingestion pipeline whose output is a static JSON file that a React app renders read-only. Your job is to make the brief's *visible text* trustworthy and non-repetitive **without inventing anything** — every claim must remain traceable to the filing.

## What the product is (read `CLAUDE.md` first)

- Single hardcoded filing: SpaceX Form S-1, accession `0001628280-26-036936`. Not a general EDGAR parser.
- Two decoupled stages communicating only via committed JSON in `src/data/generated/`:
  1. **Ingestion** (`scripts/`, run via `tsx`) — fetch → parse → chunk → extract facts/risks → build brief.
  2. **App** (`src/`, React/Vite) — imports the generated JSON at build time and renders it. The brief reader UI is `src/BriefRedesign.tsx` (+ `src/lib/brief-derive.ts`, `src/brief-redesign.css`). **Do not change the UI to paper over data problems — fix the data.**
- The brief itself is built by **`scripts/brief/generate-brief.ts`** (the file you will mostly edit) and validated by **`scripts/brief/validate-brief.ts`**. Output: `src/data/generated/brief.v1.generated.json` plus `evidence-cards.generated.json` / `.rejected.json` and `docs/spaceX-ipo-brief.v1.generated.md`.

### Hard product constraints (enforce, do not violate)
- **No** buy/sell/hold, no IPO score, no valuation judgments, no investment advice. (`validate-brief.ts` has an `advicePattern` guard — keep it passing.)
- Every claim traces to source text via citations (`sourceQuote` / `sourceChunkIds`). Quotes must remain real excerpts of the cited chunk — the integrity check is `isSourceExcerpt()` in `scripts/lib/normalize.ts` (alphanumeric-signature contiguous-excerpt match). Do not weaken it.
- Fact/risk/confidence taxonomies are fixed in `docs/analysis-taxonomy.md` and mirrored in the zod enums in `scripts/lib/schema.ts`. Don't add new enum values without updating the schema.
- Prefer marking weak extractions `needsReview` or low `confidence` over asserting them.

## Commands
```bash
npm run brief           # regenerate brief.v1.generated.json from existing chunks/risks (fast, no refetch)
npm run validate:brief  # validate the brief; exits non-zero on errors
npm run typecheck       # tsc --noEmit
npm run lint            # eslint
npm run dev             # Vite dev server to eyeball the reader at the brief route
```
`npm run brief` reads `src/data/generated/{chunks.json,risks.generated.json,facts.generated.json}` and rewrites the brief — you do **not** need a full re-ingest for brief-only changes.

## What was already fixed (do not regress)
A prior pass fixed three things in `generate-brief.ts`; keep them working:
1. **Quote windowing** (`quoteWindow`, `snapLeadStart`, `snapTailEnd`) — quotes snap to sentence/word boundaries, never start mid-word.
2. **Table-cell display spacing** (`prettifyQuote`) — reflows glued table seams (`$4,694$4,067`, `2026December`, dotted leaders). NOTE: a separate, deeper "table-structure-aware extraction" fix in `scripts/lib/html.ts` may land around the same time you work — coordinate; if the upstream chunk text becomes properly spaced, `prettifyQuote` becomes mostly a safety net.
3. **Risk titles** (`isCleanRiskTitle`, `splitSentences`, `clampSentence`, `riskTheme`) — titles are now clean complete sentences with no `theme:` prefix, abbreviation-safe ("Mr. Musk" intact), and non-risk/boilerplate records are filtered out.

## Your scope — the remaining visible-content quality issues

Work these in roughly this priority. For each, decide the fix, implement it in `generate-brief.ts` (and `validate-brief.ts` guards where appropriate), regenerate, and verify against the live JSON.

1. **Risk card bodies are category-templated.** `riskPlainEnglish(theme)` returns one canned "In plain English, the filing is saying that…" sentence per *theme*, so the body's lead is identical for every card sharing a theme. The body currently appends one filing sentence (good, unique) but still leads with boilerplate. Make the "what the filing says" body genuinely specific to each risk — e.g. a short, faithful paraphrase or a tighter quote-led summary — while staying non-advisory and source-true. The validator forbids duplicate risk bodies (`validate-brief.ts` ~line 121) — keep bodies unique.

2. **QA signals are silent.** In the current output every card is `needsReview: false`, and all 18 risk cards are `confidence: "medium"` regardless of quality. Per the product rule, weak/heuristic extractions should be flagged. Add real calibration: set `needsReview`/`confidence` from concrete signals (e.g. risk title still looks fragmentary, quote is mostly table digits, required terms barely matched), and surface the count honestly (the reader UI already shows a "N items flagged for human review" total and per-section badges, driven by `needsReview`). Consider a golden check in `validate-brief.ts` that fails if a risk title is a fragment.

3. **Repetitive "why it matters."** All 18 risk cards share one identical `whyItMatters` string. Make it carry per-card signal (e.g. tie to the risk's theme or specific consequence) without drifting into advice.

4. **Cross-section duplication.** Several cards render verbatim in multiple sections: the "What Is Still Unclear or Needs Review" section re-emits the same proceeds/dilution/lockup cards already shown above, and "Total long-term debt" appears identically under both *Dilution and Capitalization* and *Debt and Liquidity*. The "10 Things" digest re-showing canonical cards is intentional; the others read as accidental repetition. Decide a policy (cross-reference/link, or a compact "still-unclear" list that doesn't re-render full cards) and implement it. The 13 required section ids in `validate-brief.ts` must still exist and be non-empty where required.

5. **Risk selection quality (stretch).** Risks are chosen as the first two per theme in filing order (`addRiskEvidenceCards`). Consider ranking by salience (length/specificity/keyword density) so the strongest risk per theme wins, and confirm theme coverage stays ≥5 (a validator warning triggers below 5).

## Definition of done
- `npm run validate:brief`, `npm run typecheck`, `npm run lint` all pass.
- Inspect `src/data/generated/brief.v1.generated.json` and confirm: risk bodies are unique *and* specific; `needsReview`/`confidence` vary and reflect real quality; no identical `whyItMatters` across all risk cards; no full-card verbatim duplication outside the intentional "10 Things" digest.
- `npm run dev` and eyeball the brief reader — the risk section and the "What Is Still Unclear" section should no longer read as boilerplate or echoes.
- Nothing invented: every new sentence is a faithful paraphrase or excerpt of the cited chunk; no advice/scoring language.

## Useful inspection one-liner
```bash
node -e 'const b=require("./src/data/generated/brief.v1.generated.json");
for(const s of b.sections){console.log("##",s.title);for(const it of s.items)console.log("  -",it.confidence,it.needsReview?"[review]":"",JSON.stringify(it.title.slice(0,80)));}'
```
