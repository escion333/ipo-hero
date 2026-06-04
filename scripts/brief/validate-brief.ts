import path from "node:path";
import { GENERATED_DIR, readJsonFile } from "../lib/artifacts";
import { evidenceCardSchema, retailInvestorBriefSchema, type EvidenceCard, type FilingChunk, type RetailInvestorBrief } from "../lib/schema";
import { normalizeTitle, normalizeWhitespace } from "../lib/normalize";

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
const advicePattern = /\b(buy|sell|hold|should invest|attractive valuation|undervalued|overvalued|guaranteed|safe investment|recommendation|price target)\b/i;
const forbiddenBriefTerms = /candidate|parser found|section presence|extracted count/i;
const weakSectionPattern = /document preamble|table of contents|glossary of terms|index to financial statements|under the securities act/i;

function topicCitationError(card: EvidenceCard, chunk: FilingChunk): string | undefined {
  const title = normalizeTitle(chunk.title);
  if (card.topic !== "offering" && weakSectionPattern.test(title)) return `${card.topic} card ${card.id} cites weak section "${chunk.title}".`;
  if (card.topic === "debt" && title.includes("glossary")) return `Debt card ${card.id} cites glossary text.`;
  if (card.topic === "proceeds" && title !== "use of proceeds") return `Proceeds card ${card.id} does not cite Use of Proceeds.`;
  if (card.topic === "lockup" && !["shares eligible for future sale", "underwriting"].includes(title)) return `Lockup card ${card.id} cites ${chunk.title}.`;
  if (card.topic === "related_party" && title !== "certain relationships and related person transactions" && !/affiliate|transaction|xai|valor/i.test(card.sourceQuote)) {
    return `Related-party card ${card.id} lacks a related-party section or clear transaction language.`;
  }
  if (card.topic === "financial" && /table of contents|index to financial statements/.test(title)) return `Financial card ${card.id} cites TOC-like text.`;
  if (card.topic === "risk" && (title !== "risk factors" || /Investing in our Class A common stock involves a high degree of risk/i.test(card.sourceQuote))) {
    return `Risk card ${card.id} cites a generic risk preamble or non-risk section.`;
  }
  return undefined;
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
      if (!normalizeWhitespace(chunk.text).includes(normalizeWhitespace(card.sourceQuote))) errors.push(`Evidence card ${card.id} quote is not found in chunk ${chunkId}.`);
      const topicError = topicCitationError(card, chunk);
      if (topicError) errors.push(topicError);
    }
    if (forbiddenBriefTerms.test(`${card.title} ${card.plainEnglish}`)) errors.push(`Evidence card ${card.id} contains parser/candidate language.`);
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
      if (advicePattern.test(`${item.title} ${item.body} ${item.whyItMatters ?? ""}`)) errors.push(`Brief item ${item.id} contains prohibited advice-like language.`);
      for (const citation of item.citations) {
        const chunk = chunksById.get(citation.chunkId);
        if (!chunk) {
          errors.push(`Brief item ${item.id} cites missing chunk ${citation.chunkId}.`);
          continue;
        }
        if (!normalizeWhitespace(chunk.text).includes(normalizeWhitespace(citation.quote))) errors.push(`Brief item ${item.id} citation quote is not found in ${citation.chunkId}.`);
      }
      const cardId = item.id.replace(/^(notice|evidence|review|source-notes)-/, "");
      if (cardId && evidenceById.has(cardId) && evidenceById.get(cardId)?.qualityWarnings.length) errors.push(`Brief item ${item.id} uses a rejected evidence card.`);
    }
  }

  const riskItems = brief.sections.find((section) => section.id === "key-risk-themes")?.items ?? [];
  const riskBodies = new Set<string>();
  for (const item of riskItems) {
    if (item.title.length < 40 || /risk factor$|additional risks/i.test(item.title)) errors.push(`Risk item title looks weak or fragmentary: ${item.title}`);
    if (riskBodies.has(item.body)) errors.push(`Risk explanation is duplicated: ${item.title}`);
    riskBodies.add(item.body);
  }

  const actualFinancialValueCount = brief.diagnostics.actualFinancialValueCount ?? 0;
  if (actualFinancialValueCount < 3) errors.push(`Only ${actualFinancialValueCount} actual financial values were extracted.`);
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
