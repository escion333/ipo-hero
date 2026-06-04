import path from "node:path";
import { GENERATED_DIR, readJsonFile } from "../lib/artifacts";
import { retailInvestorBriefSchema, type FilingChunk, type RetailInvestorBrief } from "../lib/schema";
import { normalizeWhitespace } from "../lib/normalize";

type BriefValidationResult = {
  errors: string[];
  warnings: string[];
};

const requiredSections = [
  "what-company-does",
  "offering-description",
  "use-of-proceeds",
  "financial-snapshot",
  "dilution-capitalization",
  "control-governance",
  "related-party",
  "debt-liquidity",
  "lockup-overhang",
  "key-risk-themes",
  "needs-human-review",
];

const advicePattern =
  /\b(buy|sell|hold|should invest|attractive valuation|undervalued|overvalued|guaranteed|safe investment|recommendation|price target)\b/i;

export async function validateBrief(): Promise<BriefValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const briefRaw = await readJsonFile<unknown>(path.join(GENERATED_DIR, "brief.generated.json"));
  const chunks = (await readJsonFile<FilingChunk[]>(path.join(GENERATED_DIR, "chunks.json"))) ?? [];
  if (!briefRaw) return { errors: ["Missing brief.generated.json."], warnings };
  const parsed = retailInvestorBriefSchema.safeParse(briefRaw);
  if (!parsed.success) return { errors: [`Brief schema failed: ${parsed.error.message}`], warnings };

  const brief: RetailInvestorBrief = parsed.data;
  const chunksById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const sectionIds = new Set(brief.sections.map((section) => section.id));
  const missingSections = requiredSections.filter((sectionId) => !sectionIds.has(sectionId));
  if (missingSections.length) errors.push(`Brief missing required sections: ${missingSections.join(", ")}.`);

  let uncitedStatements = 0;
  for (const section of brief.sections) {
    if (!section.summary.trim()) warnings.push(`Brief section ${section.id} has an empty summary.`);
    for (const item of section.items) {
      if (!item.citations.length) {
        errors.push(`Brief item ${item.id} has no citations.`);
        continue;
      }
      if (advicePattern.test(`${item.title} ${item.body} ${item.whyItMatters ?? ""}`)) {
        errors.push(`Brief item ${item.id} contains prohibited advice-like language.`);
      }
      for (const citation of item.citations) {
        const chunk = chunksById.get(citation.chunkId);
        if (!chunk) {
          errors.push(`Brief item ${item.id} cites missing chunk ${citation.chunkId}.`);
          continue;
        }
        if (!normalizeWhitespace(chunk.text).includes(normalizeWhitespace(citation.quote))) {
          errors.push(`Brief item ${item.id} citation quote was not found in chunk ${citation.chunkId}.`);
        }
      }
    }
    if (!section.items.length) uncitedStatements += 1;
  }

  if (uncitedStatements > 1) errors.push(`Too many sections without cited items: ${uncitedStatements}.`);
  if (advicePattern.test(`${brief.title} ${JSON.stringify(brief.snapshot)} ${brief.sections.map((section) => section.summary).join(" ")}`)) {
    errors.push("Brief metadata, snapshot, or summaries contain prohibited advice-like language.");
  }
  if (brief.diagnostics.excludedSuspiciousRiskCount <= 0) warnings.push("Brief diagnostics do not report excluded suspicious risk records.");
  return { errors, warnings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  validateBrief()
    .then((result) => {
      for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
      if (result.errors.length) {
        console.error("Brief validation failed:");
        for (const error of result.errors) console.error(`- ${error}`);
        process.exit(1);
      }
      console.log("Brief validation passed.");
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
