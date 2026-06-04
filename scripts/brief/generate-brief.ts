import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureReviewedFiles, fileExists, GENERATED_DIR, mergeReviewed, readJsonFile, REVIEWED_DIR, writeJsonFile } from "../lib/artifacts";
import { TARGETS } from "../lib/sec";
import type { BriefCitation, BriefItem, BriefSection, FilingChunk, FilingFact, FilingSection, RetailInvestorBrief, RiskFactor } from "../lib/schema";
import { excerpt, normalizeTitle, normalizeWhitespace, stableId } from "../lib/normalize";
import { validateBrief } from "./validate-brief";

const BRIEF_PATH = path.join(GENERATED_DIR, "brief.generated.json");
const BRIEF_MD_PATH = path.join("docs", "spaceX-ipo-brief.generated.md");
const DISCLAIMER =
  "This brief is an educational summary of selected disclosures from the S-1. It is not investment advice, not a recommendation, and not a substitute for reading the prospectus.";

type Diagnostics = {
  warnings: string[];
  tableExtractionSummary: { count: number; associatedWithSections: number; unassociated: number };
};

function chunkMap(chunks: FilingChunk[]): Map<string, FilingChunk> {
  return new Map(chunks.map((chunk) => [chunk.id, chunk]));
}

function citationFromChunk(chunk: FilingChunk, quote?: string): BriefCitation {
  return {
    chunkId: chunk.id,
    sectionId: chunk.sectionId,
    sourceUrl: chunk.sourceUrl,
    quote: normalizeWhitespace(quote && normalizeWhitespace(chunk.text).includes(normalizeWhitespace(quote)) ? quote : chunk.text.slice(0, 700)),
  };
}

function citationFromFact(fact: FilingFact, chunksById: Map<string, FilingChunk>): BriefCitation[] {
  return fact.sourceChunkIds
    .map((chunkId) => {
      const chunk = chunksById.get(chunkId);
      if (!chunk) return undefined;
      const betterChunk = [...chunksById.values()].find(
        (candidate) => normalizeTitle(candidate.title) === normalizeTitle(chunk.title) && candidate.text.length > Math.max(500, chunk.text.length),
      );
      return citationFromChunk(betterChunk ?? chunk, (betterChunk ?? chunk).id === chunk.id ? fact.sourceQuote : undefined);
    })
    .filter((citation): citation is BriefCitation => Boolean(citation));
}

function itemFromFact(fact: FilingFact, chunksById: Map<string, FilingChunk>): BriefItem | undefined {
  const citations = citationFromFact(fact, chunksById);
  if (!citations.length) return undefined;
  return {
    id: fact.id,
    title: fact.label,
    body: fact.plainEnglish || `The filing includes source-backed information related to ${fact.label}.`,
    whyItMatters: fact.investorRelevance,
    confidence: fact.confidence,
    needsReview: fact.needsReview,
    citations,
  };
}

function itemFromRisk(risk: RiskFactor, chunksById: Map<string, FilingChunk>): BriefItem | undefined {
  const chunk = chunksById.get(risk.sourceChunkIds[0]);
  if (!chunk) return undefined;
  return {
    id: risk.id,
    title: risk.title,
    body: `The company discloses a risk related to ${risk.category}. In plain English, this means investors should understand that this disclosure could affect the company's business, financial condition, operating results, or offering economics.`,
    whyItMatters: risk.whyItMatters,
    confidence: risk.confidence,
    needsReview: Boolean(risk.needsReview),
    citations: [citationFromChunk(chunk, risk.sourceQuote)],
  };
}

function factsByCategory(facts: FilingFact[], category: FilingFact["category"]): FilingFact[] {
  return facts.filter((fact) => fact.category === category);
}

function pickFacts(facts: FilingFact[], chunksById: Map<string, FilingChunk>, category: FilingFact["category"], limit = 8): BriefItem[] {
  return factsByCategory(facts, category)
    .slice(0, limit)
    .map((fact) => itemFromFact(fact, chunksById))
    .filter((item): item is BriefItem => Boolean(item));
}

function makeSection(id: string, title: string, summary: string, items: BriefItem[], warnings: string[] = []): BriefSection {
  return { id, title, summary, items, warnings };
}

function factValue(facts: FilingFact[], label: string): string | undefined {
  return facts.find((fact) => fact.label.toLowerCase() === label.toLowerCase())?.valueText;
}

function riskThemeSections(risks: RiskFactor[], chunksById: Map<string, FilingChunk>): BriefSection {
  const categories = [
    "launch/space operations",
    "Starlink/connectivity",
    "AI/xAI",
    "government/regulatory",
    "financial/cash flow",
    "debt/liquidity",
    "competition",
    "governance/control",
    "dilution/share structure",
    "legal/litigation",
    "cybersecurity",
    "supply chain/manufacturing",
    "macro/geopolitical",
    "other",
  ];
  const items: BriefItem[] = [];
  for (const category of categories) {
    const selected = risks.filter((risk) => risk.category === category && risk.riskExtractionType === "full_text").slice(0, 3);
    for (const risk of selected) {
      const item = itemFromRisk(risk, chunksById);
      if (item) items.push({ ...item, id: stableId(["brief-risk", category, risk.id]), title: `${category}: ${risk.title}` });
    }
  }
  const represented = new Set(items.map((item) => item.title.split(":")[0]));
  const warnings = categories.filter((category) => !represented.has(category)).map((category) => `No full-text representative risk selected for ${category}.`);
  return makeSection(
    "key-risk-themes",
    "Key Risk Themes",
    "Representative full-text risk factors are grouped by deterministic category. Suspicious fragments, heading-only records, and table-of-contents entries are excluded from this section.",
    items.slice(0, 30),
    warnings,
  );
}

function reviewSection(facts: FilingFact[], risks: RiskFactor[], diagnostics: Diagnostics, chunksById: Map<string, FilingChunk>): BriefSection {
  const lowConfidenceFacts = facts.filter((fact) => fact.confidence === "low" || fact.needsReview).slice(0, 8);
  const items = lowConfidenceFacts
    .map((fact) => itemFromFact(fact, chunksById))
    .filter((item): item is BriefItem => Boolean(item));
  const suspiciousRiskCount = risks.filter((risk) => risk.riskExtractionType !== "full_text").length;
  const firstCitation = items[0]?.citations[0] ?? citationFromChunk(chunksById.values().next().value as FilingChunk);
  items.push({
    id: "review-suspicious-risks",
    title: "Suspicious risk extraction summary",
    body: `${suspiciousRiskCount} risk records were excluded from the main risk theme section because they were classified as fragments, heading-only records, table-of-contents entries, or unknown type.`,
    whyItMatters: "These records remain auditable, but they should not be treated as clean full-text risk factors until reviewed.",
    confidence: "medium",
    needsReview: true,
    citations: [firstCitation],
  });
  return makeSection(
    "needs-human-review",
    "What Needs Human Review",
    "This section lists extraction areas that should be checked before any consumer-facing use.",
    items,
    diagnostics.warnings,
  );
}

function markdownEscape(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function renderMarkdown(brief: RetailInvestorBrief): string {
  const lines: string[] = [`# ${brief.title}`, "", brief.disclaimer, "", "## Filing Snapshot", ""];
  for (const [key, value] of Object.entries(brief.snapshot)) {
    lines.push(`- **${key}:** ${value ?? "unknown"}`);
  }
  for (const section of brief.sections) {
    lines.push("", `## ${section.title}`, "", section.summary, "");
    if (section.warnings.length) {
      lines.push("Warnings:");
      for (const warning of section.warnings) lines.push(`- ${warning}`);
      lines.push("");
    }
    for (const item of section.items) {
      lines.push(`### ${item.title}`, "", item.body);
      if (item.whyItMatters) lines.push("", `Why it matters: ${item.whyItMatters}`);
      lines.push("", `Confidence: ${item.confidence}. Needs review: ${item.needsReview ? "yes" : "no"}.`, "", "Citations:");
      for (const citation of item.citations) {
        lines.push(`- ${citation.chunkId}${citation.sectionId ? ` / ${citation.sectionId}` : ""}: "${markdownEscape(excerpt(citation.quote, 320))}"`);
      }
      lines.push("");
    }
  }
  lines.push("## Source Notes", "");
  for (const warning of brief.diagnostics.warnings) lines.push(`- ${warning}`);
  return `${lines.join("\n")}\n`;
}

async function main() {
  await ensureReviewedFiles();
  const chunks = (await readJsonFile<FilingChunk[]>(path.join(GENERATED_DIR, "chunks.json"))) ?? [];
  const sections = (await readJsonFile<FilingSection[]>(path.join(GENERATED_DIR, "sections.json"))) ?? [];
  const tables = (await readJsonFile<Array<{ id: string; text: string }>>(path.join(GENERATED_DIR, "tables.json"))) ?? [];
  const generatedFacts = (await readJsonFile<FilingFact[]>(path.join(GENERATED_DIR, "facts.generated.json"))) ?? [];
  const reviewedFacts = (await readJsonFile<FilingFact[]>(path.join(REVIEWED_DIR, "facts.reviewed.json"))) ?? [];
  const generatedRisks = (await readJsonFile<RiskFactor[]>(path.join(GENERATED_DIR, "risks.generated.json"))) ?? [];
  const reviewedRisks = (await readJsonFile<RiskFactor[]>(path.join(REVIEWED_DIR, "risks.reviewed.json"))) ?? [];
  const diagnostics = (await readJsonFile<Diagnostics>(path.join(GENERATED_DIR, "diagnostics.json"))) ?? { warnings: [], tableExtractionSummary: { count: 0, associatedWithSections: 0, unassociated: 0 } };
  const facts = mergeReviewed(generatedFacts, reviewedFacts);
  const risks = mergeReviewed(generatedRisks, reviewedRisks);
  const chunksById = chunkMap(chunks);
  const fullTextRisks = risks.filter((risk) => risk.riskExtractionType === "full_text");
  const excludedSuspiciousRiskCount = risks.length - fullTextRisks.length;
  const warnings: string[] = [];

  const sectionsOut: BriefSection[] = [
    makeSection("what-company-does", "What The Company Does", "Business facts and source chunks provide a plain-English view of the filing's business description.", pickFacts(facts, chunksById, "business", 8)),
    makeSection("offering-description", "How The Offering Is Described", "Offering facts summarize filing metadata and source-backed offering candidates without filling in missing terms.", pickFacts(facts, chunksById, "offering", 8)),
    makeSection("use-of-proceeds", "Use Of Proceeds", "This section uses proceeds facts and source-backed keyword candidates. Candidate uses need review before exact claims are made.", pickFacts(facts, chunksById, "proceeds", 8)),
    makeSection("financial-snapshot", "Financial Snapshot", "Financial entries are candidate extractions from sections and tables. Do not treat unreviewed values as finalized metrics.", pickFacts(facts, chunksById, "financial", 10)),
    makeSection("dilution-capitalization", "Dilution And Capitalization", "Dilution and capitalization disclosures may matter because they frame share economics and capital structure.", [...pickFacts(facts, chunksById, "dilution", 8), ...pickFacts(facts, chunksById, "financial", 3)]),
    makeSection("control-governance", "Control And Governance", "Governance facts include ownership, voting, class structure, and control-related source candidates.", pickFacts(facts, chunksById, "governance", 10)),
    makeSection("related-party", "Related-Party And Affiliated Transactions", "Related-party facts identify source-backed sections and affiliate-related candidates that need careful review.", pickFacts(facts, chunksById, "related_party", 8)),
    makeSection("debt-liquidity", "Debt And Liquidity", "Debt and liquidity facts flag source-backed mentions of credit, bridge loans, indebtedness, and liquidity language.", pickFacts(facts, chunksById, "debt", 8)),
    makeSection("lockup-overhang", "Lockup And Future Share Overhang", "Lock-up and future-sale facts identify source-backed mentions that may relate to future share supply.", pickFacts(facts, chunksById, "lockup", 8)),
    riskThemeSections(fullTextRisks, chunksById),
    reviewSection(facts, risks, diagnostics, chunksById),
  ];

  for (const section of sectionsOut) {
    if (!section.items.length) warnings.push(`Brief section "${section.title}" has no cited items.`);
  }

  const companyName = factValue(facts, "Company name");
  const formType = factValue(facts, "Form type");
  const accessionNumber = factValue(facts, "Accession number");
  const filingDate = factValue(facts, "Filing date");
  const brief: RetailInvestorBrief = {
    id: "spacex-ipo-filing-brief-v0",
    title: "SpaceX IPO Filing Brief",
    generatedAt: new Date().toISOString(),
    filing: { companyName, formType, accessionNumber, filingDate, sourceUrl: TARGETS.filingUrl },
    disclaimer: DISCLAIMER,
    snapshot: {
      companyName: companyName ?? null,
      formType: formType ?? null,
      accessionNumber: accessionNumber ?? null,
      filingDate: filingDate ?? null,
      documentCount: factValue(facts, "Document count") ?? null,
      sectionCount: sections.length,
      chunkCount: chunks.length,
      tableCount: tables.length,
      factCount: facts.length,
      fullTextRiskCount: fullTextRisks.length,
      sourceFilingUrl: TARGETS.filingUrl,
    },
    sections: sectionsOut,
    diagnostics: {
      generatedFactCount: generatedFacts.length,
      reviewedFactCount: reviewedFacts.length,
      generatedRiskCount: generatedRisks.length,
      reviewedRiskCount: reviewedRisks.length,
      fullTextRiskCount: fullTextRisks.length,
      excludedSuspiciousRiskCount,
      warnings: [...warnings, ...diagnostics.warnings],
    },
  };

  await writeJsonFile(BRIEF_PATH, brief);
  const reviewedBriefPath = path.join(REVIEWED_DIR, "brief.reviewed.json");
  if (!(await fileExists(reviewedBriefPath))) await writeJsonFile(reviewedBriefPath, []);
  await mkdir(path.dirname(BRIEF_MD_PATH), { recursive: true });
  await writeFile(BRIEF_MD_PATH, renderMarkdown(brief));
  const result = await validateBrief();
  for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
  if (result.errors.length) {
    console.error("Brief validation failed:");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`Generated brief with ${brief.sections.length} sections and ${brief.sections.flatMap((section) => section.items).length} cited items.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
