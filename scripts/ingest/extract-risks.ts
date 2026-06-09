import type { FilingChunk, RiskFactor } from "../lib/schema";
import { excerpt, normalizeTitle, normalizeWhitespace, stableId } from "../lib/normalize";

const categoryRules: Array<[string, RegExp]> = [
  ["launch/space operations", /\b(launch|rocket|spacecraft|mission|orbit|reentry|explosion|failure)\b/i],
  ["Starlink/connectivity", /\b(starlink|satellite|connectivity|broadband|spectrum)\b/i],
  ["AI/xAI", /\b(ai|artificial intelligence|xai|machine learning)\b/i],
  ["government/regulatory", /\b(government|regulat|fcc|faa|license|permit|compliance|export control)\b/i],
  ["financial/cash flow", /\b(revenue|profit|loss|cash flow|capital expenditure|operating results)\b/i],
  ["debt/liquidity", /\b(debt|liquidity|borrow|credit facility|indebtedness)\b/i],
  ["competition", /\b(compete|competition|competitor|market share)\b/i],
  ["governance/control", /\b(control|founder|board|voting|governance)\b/i],
  ["dilution/share structure", /\b(dilution|common stock|preferred stock|shares eligible)\b/i],
  ["legal/litigation", /\b(litigation|lawsuit|legal proceedings|claims)\b/i],
  ["cybersecurity", /\b(cyber|security breach|data breach|hacking)\b/i],
  ["supply chain/manufacturing", /\b(supply chain|supplier|manufactur|component|shortage)\b/i],
  ["macro/geopolitical", /\b(geopolitical|inflation|interest rate|economic conditions|war|sanctions)\b/i],
];

type RiskCandidate = {
  title: string;
  body: string;
  extractionMethod: string;
};

function categorize(text: string): string {
  return categoryRules.find(([, rule]) => rule.test(text))?.[0] ?? "other";
}

function specificity(text: string): RiskFactor["specificity"] {
  const companyTerms = /\b(spacex|space exploration|starlink|falcon|dragon|starship|super heavy|launch|xai|grok)\b/i.test(text);
  const boilerplateTerms = /\b(our business|our operating results|may be adversely affected|could harm)\b/i.test(text);
  if (companyTerms && boilerplateTerms) return "mixed";
  if (companyTerms) return "company_specific";
  return "generic";
}

function sentenceCandidates(text: string): RiskCandidate[] {
  const clean = normalizeWhitespace(text);
  const matches = [...clean.matchAll(/(?<title>(?:We|Our|If|Failure|Failures|Inability|Changes|Risks|Because|Although|A|The|Any|Certain|Future|Natural|Competition|Regulatory|Government|Cybersecurity|Security|Operational|Legal|Economic|Market|Mr\.)[^.;:!?]{20,220}(?:\.|:))(?<body>.*?)(?=(?:We|Our|If|Failure|Failures|Inability|Changes|Risks|Because|Although|A|The|Any|Certain|Future|Natural|Competition|Regulatory|Government|Cybersecurity|Security|Operational|Legal|Economic|Market|Mr\.)[^.;:!?]{20,220}(?:\.|:)|$)/g)];
  return matches
    .map((match) => ({
      title: normalizeWhitespace(match.groups?.title ?? "Risk factor").replace(/[:.]$/, ""),
      body: normalizeWhitespace(`${match.groups?.title ?? ""} ${match.groups?.body ?? ""}`),
      extractionMethod: "sentence-heading-regex",
    }))
    .filter((item) => item.body.length > 120);
}

function splitRiskText(text: string): RiskCandidate[] {
  const clean = normalizeWhitespace(text);
  const candidates = sentenceCandidates(clean);
  if (candidates.length >= 3) return candidates;

  return clean
    .split(/(?=Risks? Related to )/i)
    .map((body, index) => ({
      title: index === 0 ? "Risk factor" : excerpt(body, 120).replace(/[:.]$/, ""),
      body: normalizeWhitespace(body),
      extractionMethod: "risk-related-to-fallback",
    }))
    .filter((item) => item.body.length > 120);
}

// A captured title is fragmentary when it begins as a relative clause / mid-word stub or
// ends on an abbreviation (so the sentence splitter cut mid-factor). Such records must not be
// classified full_text, because full_text is asserted as medium-confidence / no-review.
function titleLooksFragmentary(title: string): boolean {
  const t = title.trim();
  if (/^.{1,40},\s*(which|that)\b/i.test(t)) return true; // leading relative clause
  if (/^[A-Z]{2,},/.test(t)) return true; // orphaned all-caps stub
  if (/\b(U|U\.S|Inc|Corp|Mr|Mrs|Ms|Dr|No|Co|vs|e\.g|i\.e)$/.test(t)) return true; // ends on an abbreviation
  return false;
}

function classifyRisk(candidate: RiskCandidate, chunk: FilingChunk): RiskFactor["riskExtractionType"] {
  const isMainRiskFactorsSection = chunk.title.trim() === "RISK FACTORS";
  const normalizedTitle = normalizeTitle(candidate.title);
  if (!isMainRiskFactorsSection) return "toc_entry";
  if (/^risk factors?$|^\d+$/i.test(normalizedTitle)) return "toc_entry";
  if (candidate.body.length < 180) return "heading_only";
  if (candidate.body.length < 500 || candidate.body.length < candidate.title.length + 160) return "fragment";
  if (titleLooksFragmentary(candidate.title)) return "fragment";
  return "full_text";
}

function riskWarning(type: RiskFactor["riskExtractionType"], title: string, body: string, chunk: FilingChunk): string | undefined {
  if (chunk.title.trim() !== "RISK FACTORS") return `Extracted from "${chunk.title}" rather than the main Risk Factors section.`;
  if (type === "toc_entry") return "Looks like a table-of-contents or section-heading entry.";
  if (type === "heading_only") return "Looks like a heading with little supporting body text.";
  if (type === "fragment") return "Risk source text is short or appears to start/end mid-factor.";
  if (title === "Risk factor") return "Missing specific risk title.";
  return undefined;
}

export function extractRisks(chunks: FilingChunk[]): RiskFactor[] {
  const riskChunks = chunks.filter((chunk) => chunk.chunkType === "risk_factor" || normalizeTitle(chunk.title).includes("risk factors"));
  const risks: RiskFactor[] = [];

  for (const chunk of riskChunks) {
    const items = splitRiskText(chunk.text);
    for (const item of items) {
      const extractionType = classifyRisk(item, chunk);
      const category = categorize(item.body);
      const warning = riskWarning(extractionType, item.title, item.body, chunk);
      risks.push({
        id: stableId(["risk", risks.length + 1, item.title]),
        title: item.title,
        category,
        originalText: item.body,
        plainEnglish: `The filing flags this as a ${category} risk. Review the source text for exact wording before relying on a summary.`,
        whyItMatters: "Risk factors describe uncertainties the company says could affect its business, financial condition, operating results, or offering economics.",
        specificity: specificity(item.body),
        confidence: extractionType === "full_text" ? "medium" : "low",
        sourceSectionId: chunk.sectionId,
        sourceChunkIds: [chunk.id],
        sourceQuote: chunk.text.slice(0, 700),
        characterLength: item.body.length,
        extractionMethod: item.extractionMethod,
        riskExtractionType: extractionType,
        needsReview: extractionType !== "full_text" || Boolean(warning),
        extractionWarning: warning,
      });
    }
  }

  return risks;
}
