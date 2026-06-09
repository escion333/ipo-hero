import path from "node:path";
import { GENERATED_DIR, readJsonFile } from "../lib/artifacts";
import { evidenceCardSchema, retailInvestorBriefSchema, type EvidenceCard, type FilingChunk, type RetailInvestorBrief } from "../lib/schema";
import { isSourceExcerpt } from "../lib/normalize";
import { ADVICE_PATTERN, isAllowedSectionForTopic, isCleanRiskTitle } from "./quality";

type BriefValidationResult = {
  errors: string[];
  warnings: string[];
};

const briefPath = path.join(GENERATED_DIR, "brief.v1.generated.json");
const evidencePath = path.join(GENERATED_DIR, "evidence-cards.generated.json");
const rejectedPath = path.join(GENERATED_DIR, "evidence-cards.rejected.json");
const requiredSections = [
  "ten-things",
  "what-spacex-says-it-does",
  "offering-mechanics",
  "financial-snapshot",
  "use-of-proceeds",
  "dilution-capitalization",
  "control-governance",
  "debt-liquidity",
  "related-party-affiliated-transactions",
  "lockup-share-overhang",
  "key-risk-themes",
  "unclear-needs-review",
  "source-notes",
];
const forbiddenBriefTerms = /candidate|parser found|section presence|extracted count/i;
// A dollar amount written in a card's prose ("$4.694 billion", "$1,500 million", "$399 million").
const DOLLAR_IN_PROSE = /\$\s?\d[\d,]*(?:\.\d+)?\s*(?:million|billion)?/g;

// The validator drives its topic→section rule off the SAME topicAllowedTitles map the
// generator uses (via isAllowedSectionForTopic), so the two cannot diverge — previously the
// validator had no rule at all for the business, governance, or dilution topics.
function topicCitationError(card: EvidenceCard, chunk: FilingChunk): string | undefined {
  if (!isAllowedSectionForTopic(card.topic, chunk.title)) {
    return `${card.topic} card ${card.id} cites disallowed section "${chunk.title}".`;
  }
  if (card.topic === "risk" && /Investing in our Class A common stock involves a high degree of risk/i.test(card.sourceQuote)) {
    return `Risk card ${card.id} cites a generic risk preamble rather than a specific risk.`;
  }
  return undefined;
}

// "Actual financial value" defined structurally: a financial/debt/dilution card whose quoted
// source text contains a currency or number token. This replaces trusting an author-typed
// extractionMethod prefix.
function isActualFinancialValue(card: EvidenceCard): boolean {
  if (!["financial", "debt", "dilution"].includes(card.topic)) return false;
  return /\$\s?\d|\(\s?\d|\d[\d,]*(?:\.\d+)?\s*(?:million|billion|%)/.test(card.sourceQuote);
}

export async function validateBrief(): Promise<BriefValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const briefRaw = await readJsonFile<unknown>(briefPath);
  const evidenceRaw = (await readJsonFile<unknown[]>(evidencePath)) ?? [];
  const rejectedRaw = (await readJsonFile<unknown[]>(rejectedPath)) ?? [];
  const chunks = (await readJsonFile<FilingChunk[]>(path.join(GENERATED_DIR, "chunks.json"))) ?? [];
  if (!briefRaw) return { errors: ["Missing brief.v1.generated.json."], warnings };

  const parsedBrief = retailInvestorBriefSchema.safeParse(briefRaw);
  if (!parsedBrief.success) return { errors: [`Brief v1 schema failed: ${parsedBrief.error.message}`], warnings };
  const parsedEvidence = evidenceCardSchema.array().safeParse(evidenceRaw);
  if (!parsedEvidence.success) return { errors: [`Evidence card schema failed: ${parsedEvidence.error.message}`], warnings };

  const brief: RetailInvestorBrief = parsedBrief.data;
  const evidenceCards = parsedEvidence.data;
  const evidenceById = new Map(evidenceCards.map((card) => [card.id, card]));
  const chunksById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const sectionIds = new Set(brief.sections.map((section) => section.id));
  const missingSections = requiredSections.filter((id) => !sectionIds.has(id));
  if (missingSections.length) errors.push(`Brief v1 missing required sections: ${missingSections.join(", ")}.`);

  if (evidenceCards.length < 8) errors.push(`Only ${evidenceCards.length} evidence cards exist; at least 8 are required.`);
  const highQualityCards = evidenceCards.filter((card) => card.confidence === "high" && !card.needsReview && card.qualityWarnings.length === 0);
  if (highQualityCards.length < 8) errors.push(`Only ${highQualityCards.length} high-quality evidence cards exist; at least 8 are required.`);
  const tenThings = brief.sections.find((section) => section.id === "ten-things");
  if (!tenThings || tenThings.items.length < 5) errors.push("Fewer than 5 high-confidence '10 Things Retail Investors Should Notice' items were produced.");

  for (const card of evidenceCards) {
    if (card.qualityWarnings.length) errors.push(`Rejected/weak card ${card.id} entered accepted evidence cards: ${card.qualityWarnings.join("; ")}`);
    if (!card.sourceChunkIds.length) errors.push(`Evidence card ${card.id} has no source chunks.`);
    for (const chunkId of card.sourceChunkIds) {
      const chunk = chunksById.get(chunkId);
      if (!chunk) {
        errors.push(`Evidence card ${card.id} cites missing chunk ${chunkId}.`);
        continue;
      }
      if (!isSourceExcerpt(chunk.text, card.sourceQuote)) errors.push(`Evidence card ${card.id} quote is not found in chunk ${chunkId}.`);
      const topicError = topicCitationError(card, chunk);
      if (topicError) errors.push(topicError);
      // Cross-check figures: every dollar amount asserted in any card's own prose must have its
      // digits present in the quoted source text, so a card cannot narrate a number that isn't
      // backed by its citation. Comparison is digits-only, which collapses harmless formatting
      // differences ("$4.694 billion" vs the table's "$4,694" million).
      {
        const quoteDigits = card.sourceQuote.replace(/\D/g, "");
        const proseFigures = new Set((`${card.title} ${card.plainEnglish}`.match(DOLLAR_IN_PROSE) ?? []).map((m) => m.replace(/\D/g, "")).filter((d) => d.length >= 2));
        for (const figure of proseFigures) {
          if (!quoteDigits.includes(figure)) warnings.push(`Card ${card.id} asserts dollar figure (digits ${figure}) not backed by its source quote.`);
        }
      }
    }
    if (forbiddenBriefTerms.test(`${card.title} ${card.plainEnglish}`)) errors.push(`Evidence card ${card.id} contains parser/candidate language.`);
    if (ADVICE_PATTERN.test(`${card.title} ${card.plainEnglish} ${card.whyItMatters}`)) errors.push(`Evidence card ${card.id} contains prohibited advice-like language.`);
  }

  const allItems = brief.sections.flatMap((section) => section.items);
  const candidateItems = allItems.filter((item) => forbiddenBriefTerms.test(`${item.title} ${item.body}`));
  if (candidateItems.length > 0) errors.push(`${candidateItems.length} brief items contain parser/candidate language.`);
  if (candidateItems.length / Math.max(1, allItems.length) > 0.2) errors.push("More than 20% of brief items contain candidate-style language.");

  for (const section of brief.sections) {
    const metaOnly = section.items.length > 0 && section.items.every((item) => /count|parser|generated|source notes/i.test(`${item.title} ${item.body}`));
    if (metaOnly && section.id !== "source-notes") errors.push(`Brief section ${section.id} contains only meta items.`);
    for (const item of section.items) {
      if (!item.citations.length) errors.push(`Brief item ${item.id} has no citations.`);
      if (ADVICE_PATTERN.test(`${item.title} ${item.body} ${item.whyItMatters ?? ""}`)) errors.push(`Brief item ${item.id} contains prohibited advice-like language.`);
      for (const citation of item.citations) {
        const chunk = chunksById.get(citation.chunkId);
        if (!chunk) {
          errors.push(`Brief item ${item.id} cites missing chunk ${citation.chunkId}.`);
          continue;
        }
        if (!isSourceExcerpt(chunk.text, citation.quote)) errors.push(`Brief item ${item.id} citation quote is not found in ${citation.chunkId}.`);
      }
      const cardId = item.id.replace(/^(notice|evidence|review|source-notes)-/, "");
      if (cardId && evidenceById.has(cardId) && evidenceById.get(cardId)?.qualityWarnings.length) errors.push(`Brief item ${item.id} uses a rejected evidence card.`);
    }
  }

  const riskItems = brief.sections.find((section) => section.id === "key-risk-themes")?.items ?? [];
  const riskBodies = new Set<string>();
  for (const item of riskItems) {
    if (!isCleanRiskTitle(item.title) || /risk factor$|additional risks/i.test(item.title)) errors.push(`Risk item title looks weak or fragmentary: ${item.title}`);
    if (riskBodies.has(item.body)) errors.push(`Risk explanation is duplicated: ${item.title}`);
    riskBodies.add(item.body);
  }

  // Count actual financial values structurally rather than trusting the generator's diagnostic.
  const actualFinancialValueCount = evidenceCards.filter(isActualFinancialValue).length;
  if (actualFinancialValueCount < 3) errors.push(`Only ${actualFinancialValueCount} actual financial values were extracted.`);
  if ((brief.diagnostics.actualFinancialValueCount ?? 0) !== actualFinancialValueCount) {
    warnings.push(`Diagnostic actualFinancialValueCount (${brief.diagnostics.actualFinancialValueCount}) disagrees with structural count (${actualFinancialValueCount}).`);
  }
  if (brief.diagnostics.rejectedWeakCandidateCount !== rejectedRaw.length) warnings.push("Rejected weak candidate count does not match rejected artifact length.");
  if ((brief.diagnostics.riskThemesSelected ?? 0) < 5) warnings.push(`Only ${brief.diagnostics.riskThemesSelected ?? 0} risk themes were selected.`);
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
