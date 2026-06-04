import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { GENERATED_DIR, readJsonFile, REVIEWED_DIR, writeJsonFile } from "../lib/artifacts";
import { excerpt, normalizeTitle, normalizeWhitespace, stableId } from "../lib/normalize";
import { TARGETS } from "../lib/sec";
import type { BriefCitation, BriefItem, BriefSection, EvidenceCard, FilingChunk, FilingFact, RetailInvestorBrief, RiskFactor } from "../lib/schema";
import { validateBrief } from "./validate-brief";

const BRIEF_JSON_PATH = path.join(GENERATED_DIR, "brief.v1.generated.json");
const EVIDENCE_CARDS_PATH = path.join(GENERATED_DIR, "evidence-cards.generated.json");
const BRIEF_MD_PATH = path.join("docs", "spaceX-ipo-brief.v1.generated.md");
const DISCLAIMER =
  "This brief is an educational summary of selected disclosures from the S-1. It is not investment advice, not a recommendation, and not a substitute for reading the prospectus.";

type EvidenceTopic = EvidenceCard["topic"];
type RejectedEvidence = {
  id: string;
  topic: EvidenceTopic;
  title: string;
  sourceChunkIds: string[];
  reasons: string[];
};

type DraftEvidence = {
  topic: EvidenceTopic;
  title: string;
  chunkId: string;
  quoteNeedle: string;
  extractedText: string;
  plainEnglish: string;
  whyItMatters: string;
  confidence?: EvidenceCard["confidence"];
  needsReview?: boolean;
  extractionMethod: string;
  requiredTerms?: string[];
  allowedTitles?: string[];
};

const badCitationTitles = ["document preamble", "table of contents", "glossary of terms", "index to financial statements", "under the securities act of 1933"];
const topicAllowedTitles: Record<EvidenceTopic, string[]> = {
  business: ["PROSPECTUS SUMMARY", "BUSINESS"],
  offering: ["PRELIMINARY PROSPECTUS", "UNDERWRITING"],
  financial: ["OPERATIONS", "CAPITALIZATION", "NOTES TO THE CONSOLIDATED FINANCIAL STATEMENTS", "DIVIDEND POLICY"],
  proceeds: ["USE OF PROCEEDS"],
  dilution: ["DILUTION", "CAPITALIZATION"],
  governance: ["SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS AND MANAGEMENT", "DESCRIPTION OF CAPITAL STOCK", "PROSPECTUS SUMMARY"],
  related_party: ["CERTAIN RELATIONSHIPS AND RELATED PERSON TRANSACTIONS", "UNDERWRITING"],
  debt: ["OPERATIONS", "CAPITALIZATION", "NOTES TO THE CONSOLIDATED FINANCIAL STATEMENTS", "UNDERWRITING", "RISK FACTORS"],
  lockup: ["SHARES ELIGIBLE FOR FUTURE SALE", "UNDERWRITING"],
  risk: ["RISK FACTORS"],
};

function chunkById(chunks: FilingChunk[], id: string): FilingChunk | undefined {
  return chunks.find((chunk) => chunk.id === id);
}

function quoteWindow(chunk: FilingChunk, needle: string, maxLength = 760): string {
  const index = chunk.text.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return normalizeWhitespace(chunk.text.slice(0, maxLength));
  const start = Math.max(0, index - 80);
  const end = Math.min(chunk.text.length, index + maxLength);
  return normalizeWhitespace(chunk.text.slice(start, end));
}

function citationFromCard(card: EvidenceCard, chunksById: Map<string, FilingChunk>): BriefCitation[] {
  return card.sourceChunkIds.flatMap((chunkId) => {
    const chunk = chunksById.get(chunkId);
    if (!chunk) return [];
    return [
      {
        chunkId,
        sectionId: card.sourceSectionId,
        sourceUrl: chunk.sourceUrl,
        quote: card.sourceQuote,
      },
    ];
  });
}

function addEvidenceCard(draft: DraftEvidence, chunks: FilingChunk[], accepted: EvidenceCard[], rejected: RejectedEvidence[]) {
  const chunk = chunkById(chunks, draft.chunkId);
  const id = stableId(["evidence", draft.topic, draft.title]);
  const reasons: string[] = [];
  if (!chunk) {
    rejected.push({ id, topic: draft.topic, title: draft.title, sourceChunkIds: [draft.chunkId], reasons: ["Source chunk not found."] });
    return;
  }
  const allowedTitles = draft.allowedTitles ?? topicAllowedTitles[draft.topic];
  const normalizedTitle = normalizeTitle(chunk.title);
  if (badCitationTitles.some((title) => normalizedTitle.includes(normalizeTitle(title)))) reasons.push(`Weak citation section: ${chunk.title}.`);
  if (!allowedTitles.some((title) => normalizeTitle(title) === normalizedTitle)) reasons.push(`Source section "${chunk.title}" is not allowed for ${draft.topic}.`);
  const sourceQuote = quoteWindow(chunk, draft.quoteNeedle);
  for (const term of draft.requiredTerms ?? [draft.quoteNeedle]) {
    if (!normalizeWhitespace(sourceQuote).toLowerCase().includes(term.toLowerCase())) reasons.push(`Source quote does not contain required term "${term}".`);
  }
  if (/candidate|parser found|section presence|extracted count/i.test(`${draft.title} ${draft.plainEnglish}`)) reasons.push("Parser diagnostic or candidate language is not allowed in evidence cards.");
  if (!normalizeWhitespace(chunk.text).includes(sourceQuote)) reasons.push("Source quote is not an exact source chunk excerpt.");
  if (reasons.length) {
    rejected.push({ id, topic: draft.topic, title: draft.title, sourceChunkIds: [draft.chunkId], reasons });
    return;
  }
  accepted.push({
    id,
    topic: draft.topic,
    title: draft.title,
    sourceSectionId: chunk.sectionId,
    sourceChunkIds: [chunk.id],
    sourceQuote,
    extractedText: draft.extractedText,
    plainEnglish: draft.plainEnglish,
    whyItMatters: draft.whyItMatters,
    confidence: draft.confidence ?? "high",
    needsReview: draft.needsReview ?? false,
    extractionMethod: draft.extractionMethod,
    qualityWarnings: [],
  });
}

function buildManualEvidenceCards(chunks: FilingChunk[]): { accepted: EvidenceCard[]; rejected: RejectedEvidence[] } {
  const accepted: EvidenceCard[] = [];
  const rejected: RejectedEvidence[] = [];
  const add = (draft: DraftEvidence) => addEvidenceCard(draft, chunks, accepted, rejected);

  add({
    topic: "offering",
    title: "The filing is for Class A common stock in an initial public offering.",
    chunkId: "chunk-section8preliminaryprospectus-1",
    quoteNeedle: "This is the initial public offering of shares of Class A common stock",
    extractedText: "Initial public offering of Class A common stock.",
    plainEnglish: "The cover page describes the transaction as an initial public offering of SpaceX Class A common stock.",
    whyItMatters: "This anchors the brief to the security being offered and avoids inferring terms that are still blank.",
    extractionMethod: "cover-page-exact-phrase",
    requiredTerms: ["initial public offering", "Class A common stock"],
  });
  add({
    topic: "offering",
    title: "No public market existed before the offering.",
    chunkId: "chunk-section8preliminaryprospectus-1",
    quoteNeedle: "Currently, no public market exists for our Class A common stock",
    extractedText: "No public market exists for Class A common stock.",
    plainEnglish: "The cover page says there was no existing public market for the Class A common stock before this offering.",
    whyItMatters: "New public-market trading can make price discovery more uncertain than for seasoned public companies.",
    extractionMethod: "cover-page-exact-phrase",
    requiredTerms: ["no public market", "Class A common stock"],
  });
  add({
    topic: "offering",
    title: "The company applied to list under the symbol SPCX.",
    chunkId: "chunk-section8preliminaryprospectus-1",
    quoteNeedle: "under the symbol “SPCX”",
    extractedText: "Applied to list under the symbol SPCX.",
    plainEnglish: "The filing says SpaceX applied to list its Class A common stock on Nasdaq and Nasdaq Texas under the symbol SPCX.",
    whyItMatters: "Ticker and venue are basic offering mechanics, but they remain subject to the effectiveness and completion of the offering.",
    extractionMethod: "cover-page-symbol-extraction",
    requiredTerms: ["SPCX", "Nasdaq"],
  });
  add({
    topic: "offering",
    title: "Lead underwriting representatives are named.",
    chunkId: "chunk-section70underwriting-1",
    quoteNeedle: "Goldman Sachs & Co. LLC, Morgan Stanley & Co. LLC, BofA Securities, Inc., Citigroup Global Markets Inc. and J.P. Morgan Securities LLC",
    extractedText: "Goldman Sachs, Morgan Stanley, BofA, Citi, and J.P. Morgan are named as representatives.",
    plainEnglish: "The Underwriting section names Goldman Sachs, Morgan Stanley, BofA Securities, Citi, and J.P. Morgan Securities as representatives of the underwriters.",
    whyItMatters: "The named representatives identify the lead banks coordinating the offering process.",
    extractionMethod: "underwriting-representatives-extraction",
    requiredTerms: ["Goldman Sachs", "Morgan Stanley", "J.P. Morgan"],
  });

  add({
    topic: "business",
    title: "SpaceX describes itself as operating across space, connectivity, and AI.",
    chunkId: "chunk-section48business-1",
    quoteNeedle: "across space, connectivity, and AI",
    extractedText: "SpaceX says it operates across space, connectivity, and AI.",
    plainEnglish: "The Business section frames SpaceX as a vertically integrated company spanning space, connectivity, and AI.",
    whyItMatters: "The IPO story is not just launch services; the filing ties the business model to Starlink connectivity and AI infrastructure as well.",
    extractionMethod: "business-overview-exact-phrase",
    requiredTerms: ["space", "connectivity", "AI"],
  });
  add({
    topic: "business",
    title: "Launch services include commercial, civil, and government customers.",
    chunkId: "chunk-section48business-9",
    quoteNeedle: "We offer launch services to commercial, civil, and government customers",
    extractedText: "Launch services are offered to commercial, civil, and government customers.",
    plainEnglish: "The filing says SpaceX offers launch services to commercial, civil, and government customers using Falcon 9 and Falcon Heavy.",
    whyItMatters: "This explains a concrete revenue activity rather than relying on broad mission language.",
    extractionMethod: "business-launch-services-extraction",
    requiredTerms: ["launch services", "commercial", "government"],
  });
  add({
    topic: "business",
    title: "Starlink mobile supplements terrestrial networks across approximately 30 countries.",
    chunkId: "chunk-section48business-10",
    quoteNeedle: "supplementing terrestrial networks and substantially reducing mobile “dead zones” across approximately 30 countries",
    extractedText: "Starlink Mobile supplements terrestrial networks across approximately 30 countries.",
    plainEnglish: "The filing says Starlink Mobile supplements terrestrial networks and reduces mobile dead zones across approximately 30 countries.",
    whyItMatters: "This is a specific connectivity use case that supports how the filing describes Starlink beyond home broadband.",
    extractionMethod: "business-starlink-mobile-extraction",
    requiredTerms: ["Starlink Mobile", "30 countries"],
  });
  add({
    topic: "business",
    title: "Grok and X are part of the AI segment.",
    chunkId: "chunk-section47operations-4",
    quoteNeedle: "spanning our truth-seeking frontier model Grok, AI solutions for consumer and enterprise customers, X",
    extractedText: "The AI segment includes Grok, AI solutions, X, and AI computational infrastructure.",
    plainEnglish: "The filing describes the AI segment as including Grok, consumer and enterprise AI solutions, X, and AI computational infrastructure.",
    whyItMatters: "This clarifies that the S-1 includes xAI/X-related operations inside the company being described.",
    extractionMethod: "operations-ai-segment-extraction",
    allowedTitles: ["OPERATIONS"],
    requiredTerms: ["Grok", "X", "AI computational infrastructure"],
  });

  add({
    topic: "proceeds",
    title: "Net proceeds and assumed IPO price are blank in the preliminary filing.",
    chunkId: "chunk-section42useofproceeds-1",
    quoteNeedle: "We expect to receive approximately $ of net proceeds",
    extractedText: "Net proceeds and assumed IPO price fields are blank placeholders.",
    plainEnglish: "The Use of Proceeds section still contains blank dollar fields for net proceeds and assumed offering price.",
    whyItMatters: "Without those values, the filing does not yet specify the amount of capital the company expects to raise.",
    extractionMethod: "use-of-proceeds-placeholder-detection",
    requiredTerms: ["net proceeds", "assumed initial public offering price"],
  });
  add({
    topic: "proceeds",
    title: "Proceeds are intended for growth strategy and general corporate purposes.",
    chunkId: "chunk-section42useofproceeds-1",
    quoteNeedle: "fund our growth strategy, including the expansion of our AI compute infrastructure",
    extractedText: "Growth strategy, AI compute infrastructure, launch infrastructure, satellites, and general corporate purposes.",
    plainEnglish: "The filing says proceeds are intended to fund growth strategy, including AI compute infrastructure, launch infrastructure and vehicles, satellite constellation scale and capacity, and remaining amounts for general corporate purposes.",
    whyItMatters: "This is the clearest current statement of how offering proceeds may be used, while exact amounts remain unspecified.",
    extractionMethod: "use-of-proceeds-purpose-extraction",
    requiredTerms: ["growth strategy", "AI compute infrastructure", "general corporate purposes"],
  });
  add({
    topic: "proceeds",
    title: "Management will have significant flexibility applying proceeds.",
    chunkId: "chunk-section42useofproceeds-1",
    quoteNeedle: "our management will have significant flexibility in applying the net proceeds",
    extractedText: "Management has significant flexibility in applying net proceeds.",
    plainEnglish: "The filing says management will have significant flexibility in applying the net proceeds.",
    whyItMatters: "Retail readers should not assume a fixed allocation among AI compute, launch infrastructure, satellites, or other uses.",
    extractionMethod: "use-of-proceeds-flexibility-extraction",
    requiredTerms: ["significant flexibility", "net proceeds"],
  });

  add({
    topic: "financial",
    title: "Revenue was $4.694 billion for the three months ended March 31, 2026.",
    chunkId: "chunk-section47operations-19",
    quoteNeedle: "Revenue ...............................................................$4,694$4,067",
    extractedText: "Revenue: $4,694 million for Q1 2026.",
    plainEnglish: "The MD&A table reports revenue of $4.694 billion for the three months ended March 31, 2026.",
    whyItMatters: "Revenue gives a top-line scale reference for the most recent interim period in the filing.",
    extractionMethod: "financial-value-revenue",
    requiredTerms: ["Revenue", "$4,694"],
  });
  add({
    topic: "financial",
    title: "Loss from operations was $1.943 billion for the three months ended March 31, 2026.",
    chunkId: "chunk-section47operations-19",
    quoteNeedle: "Income (loss) from operations ............................(1,943)27",
    extractedText: "Loss from operations: $(1,943) million for Q1 2026.",
    plainEnglish: "The MD&A table reports a $1.943 billion loss from operations for the three months ended March 31, 2026.",
    whyItMatters: "This shows that recent revenue scale coexists with substantial operating losses in the period shown.",
    extractionMethod: "financial-value-operating-loss",
    requiredTerms: ["Income (loss) from operations", "(1,943)"],
  });
  add({
    topic: "financial",
    title: "Cash and cash equivalents were $15.852 billion at March 31, 2026.",
    chunkId: "chunk-section79notestotheconsolidatedfinancialstatements-2",
    quoteNeedle: "Cash and cash equivalents .........................................................................................$15,852$24,747",
    extractedText: "Cash and cash equivalents: $15,852 million at March 31, 2026.",
    plainEnglish: "The unaudited notes report $15.852 billion of cash and cash equivalents at March 31, 2026.",
    whyItMatters: "Cash balance is a key liquidity data point, especially alongside debt and investment spending.",
    extractionMethod: "financial-value-cash",
    allowedTitles: ["NOTES TO THE CONSOLIDATED FINANCIAL STATEMENTS"],
    requiredTerms: ["Cash and cash equivalents", "$15,852"],
  });
  add({
    topic: "financial",
    title: "Operating cash flow was $1.047 billion for the three months ended March 31, 2026.",
    chunkId: "chunk-section47operations-34",
    quoteNeedle: "Operating activities ........................$1,047$727",
    extractedText: "Net cash provided by operating activities: $1,047 million for Q1 2026.",
    plainEnglish: "The cash flow summary reports $1.047 billion of net cash provided by operating activities for the three months ended March 31, 2026.",
    whyItMatters: "Operating cash flow helps separate cash generation from accounting income or loss.",
    extractionMethod: "financial-value-operating-cash-flow",
    requiredTerms: ["Operating activities", "$1,047"],
  });
  add({
    topic: "financial",
    title: "Investing cash flow was negative $16.724 billion for the three months ended March 31, 2026.",
    chunkId: "chunk-section47operations-34",
    quoteNeedle: "Investing activities .........................$(16,724)$(4,170)",
    extractedText: "Net cash used in investing activities: $(16,724) million for Q1 2026.",
    plainEnglish: "The cash flow summary reports $16.724 billion of net cash used in investing activities for the three months ended March 31, 2026.",
    whyItMatters: "Large investing cash outflows help explain the capital intensity of the strategy described elsewhere in the filing.",
    extractionMethod: "financial-value-investing-cash-flow",
    requiredTerms: ["Investing activities", "$(16,724)"],
  });
  add({
    topic: "debt",
    title: "Total long-term debt was $29.111 billion in the capitalization table.",
    chunkId: "chunk-section44capitalization-2",
    quoteNeedle: "Total long-term debt ............................................................ $29,111 $29,111",
    extractedText: "Total long-term debt: $29.111 billion.",
    plainEnglish: "The Capitalization section shows total long-term debt of $29.111 billion.",
    whyItMatters: "Debt scale is important context for liquidity, proceeds, and future financing flexibility.",
    extractionMethod: "financial-value-long-term-debt",
    requiredTerms: ["Total long-term debt", "$29,111"],
  });
  add({
    topic: "debt",
    title: "The SpaceX Credit Facility provides up to $1.5 billion of borrowing capacity.",
    chunkId: "chunk-section47operations-32",
    quoteNeedle: "we have $1,500 million available to borrow under the SpaceX Credit Facility",
    extractedText: "$1,500 million available under the SpaceX Credit Facility.",
    plainEnglish: "MD&A says SpaceX had $1.5 billion available to borrow under the SpaceX Credit Facility as of March 31, 2026.",
    whyItMatters: "Available borrowing capacity is a liquidity source, but it is still debt capacity rather than cash raised from the IPO.",
    extractionMethod: "debt-credit-facility-extraction",
    requiredTerms: ["$1,500 million", "SpaceX Credit Facility"],
  });
  add({
    topic: "debt",
    title: "The SpaceX Bridge Loan may be repaid with IPO proceeds.",
    chunkId: "chunk-section47operations-33",
    quoteNeedle: "apply an amount equal to the net proceeds of a qualified initial public offering, including this offering, to repay such amounts",
    extractedText: "Qualified IPO net proceeds may be used to repay SpaceX Bridge Loan amounts.",
    plainEnglish: "MD&A says the company must apply an amount equal to net proceeds of a qualified IPO, including this offering, to repay amounts outstanding under the SpaceX Bridge Loan within six months after receipt.",
    whyItMatters: "This connects the offering to debt repayment mechanics without assuming the final proceeds amount.",
    extractionMethod: "debt-bridge-loan-repayment-extraction",
    requiredTerms: ["SpaceX Bridge Loan", "net proceeds", "repay"],
  });

  add({
    topic: "dilution",
    title: "Purchasers will experience immediate and substantial dilution.",
    chunkId: "chunk-section45dilution-1",
    quoteNeedle: "will experience immediate and substantial dilution",
    extractedText: "Immediate and substantial dilution.",
    plainEnglish: "The Dilution section says purchasers of Class A common stock in the offering will experience immediate and substantial dilution.",
    whyItMatters: "Dilution explains how the IPO price may compare with accounting book value per share after the offering.",
    extractionMethod: "dilution-exact-statement",
    requiredTerms: ["immediate and substantial dilution"],
  });
  add({
    topic: "dilution",
    title: "Per-share dilution amounts remain blank in the preliminary filing.",
    chunkId: "chunk-section45dilution-1",
    quoteNeedle: "Our net tangible book value as of March 31, 2026 was approximately $ , or $ per share",
    extractedText: "Net tangible book value and per-share dilution fields are blank.",
    plainEnglish: "The Dilution section contains blank dollar fields for net tangible book value, adjusted pro forma book value, and dilution per share.",
    whyItMatters: "The direction of dilution is disclosed, but exact per-share dilution cannot be calculated from the current placeholders.",
    extractionMethod: "dilution-placeholder-detection",
    requiredTerms: ["net tangible book value", "$ per share"],
  });

  add({
    topic: "governance",
    title: "Class B common stock carries ten votes per share.",
    chunkId: "chunk-section53descriptionofcapitalstock-1",
    quoteNeedle: "each holder of our Class B common stock is entitled to ten votes per share",
    extractedText: "Class A: one vote per share; Class B: ten votes per share; Class C: no voting rights.",
    plainEnglish: "The Description of Capital Stock section says Class A has one vote per share, Class B has ten votes per share, and Class C has no voting rights.",
    whyItMatters: "Different voting rights can concentrate control even when economic ownership differs.",
    extractionMethod: "governance-voting-rights-extraction",
    requiredTerms: ["Class A", "Class B", "ten votes per share"],
  });
  add({
    topic: "governance",
    title: "Musk will control board-selection voting power.",
    chunkId: "chunk-section35prospectussummary-11",
    quoteNeedle: "Musk will control the voting power over the selection of our board",
    extractedText: "Musk will control voting power over board selection.",
    plainEnglish: "The Prospectus Summary says Musk will control the voting power over selection of the board and the outcome of matters requiring shareholder approval.",
    whyItMatters: "This is a direct control disclosure that affects how much influence public Class A holders may have.",
    extractionMethod: "governance-control-exact-statement",
    requiredTerms: ["Musk", "control", "voting power"],
  });
  add({
    topic: "governance",
    title: "Beneficial ownership section covers owners of more than 5% of voting stock.",
    chunkId: "chunk-section52securityownershipofcertainbeneficialownersandmanagement-1",
    quoteNeedle: "beneficially own more than 5% of any class of our voting securities",
    extractedText: "Beneficial ownership table covers more-than-5% owners and management.",
    plainEnglish: "The Security Ownership section sets out beneficial ownership information for more-than-5% owners, directors, director nominees, executive officers, and those groups together.",
    whyItMatters: "This is the filing's core source for ownership concentration and insider ownership review.",
    extractionMethod: "governance-beneficial-ownership-section-extraction",
    requiredTerms: ["beneficial ownership", "5%"],
  });

  add({
    topic: "related_party",
    title: "Related-party section covers transactions with insiders and 5% holders.",
    chunkId: "chunk-section51certainrelationshipsandrelatedpersontransactions-1",
    quoteNeedle: "directors, executive officers, holders of more than 5% of our capital stock or their affiliates",
    extractedText: "Transactions with directors, executive officers, 5% holders, affiliates, and immediate family members.",
    plainEnglish: "The Related Person Transactions section says it describes certain relationships and transactions involving directors, executive officers, more-than-5% holders, affiliates, and immediate family members since January 1, 2023.",
    whyItMatters: "This is the relevant section for reviewing potential conflicts and insider-linked transactions.",
    extractionMethod: "related-party-section-scope-extraction",
    requiredTerms: ["directors", "executive officers", "5%"],
  });
  add({
    topic: "related_party",
    title: "xAI subsidiaries have equipment lease and access arrangements with Valor.",
    chunkId: "chunk-section51certainrelationshipsandrelatedpersontransactions-2",
    quoteNeedle: "Certain subsidiaries of xAI, have entered into certain equipment lease, sublease, and access agreements with Valor",
    extractedText: "xAI subsidiaries entered lease, sublease, and access agreements with Valor, including aggregate cash payments of $6.986 billion.",
    plainEnglish: "The Related Person Transactions section discloses xAI subsidiary arrangements with Valor, including an equipment lease with aggregate cash payments of $6.986 billion.",
    whyItMatters: "Specific named related-party arrangements deserve review because they can affect costs, governance, and conflicts analysis.",
    extractionMethod: "related-party-named-transaction-extraction",
    requiredTerms: ["xAI", "Valor", "$6,986 million"],
  });

  add({
    topic: "lockup",
    title: "Future sales after the offering could affect the trading price.",
    chunkId: "chunk-section55shareseligibleforfuturesale-1",
    quoteNeedle: "Future sales of our Class A common stock in the public market",
    extractedText: "Future sales or availability of shares could affect market price.",
    plainEnglish: "The Shares Eligible for Future Sale section says future sales, or the availability of shares for sale, could affect the market price.",
    whyItMatters: "Potential post-IPO share supply is a retail-relevant overhang issue.",
    extractionMethod: "lockup-future-sale-risk-extraction",
    requiredTerms: ["Future sales", "market price"],
  });
  add({
    topic: "lockup",
    title: "Directors and executive officers agreed to lock-up transfer restrictions.",
    chunkId: "chunk-section55shareseligibleforfuturesale-1",
    quoteNeedle: "all of our directors and executive officers have agreed not to sell any shares",
    extractedText: "Directors and executive officers agreed not to sell Class A common stock for a blank-day period.",
    plainEnglish: "The section says SpaceX and all directors and executive officers agreed to lock-up transfer restrictions for a period that remains blank in the preliminary prospectus.",
    whyItMatters: "The lock-up concept is disclosed, but the exact period is not specified in this preliminary text.",
    extractionMethod: "lockup-placeholder-extraction",
    requiredTerms: ["directors and executive officers", "not to sell"],
  });
  add({
    topic: "lockup",
    title: "Underwriting describes a 180-day lock-up release framework.",
    chunkId: "chunk-section70underwriting-4",
    quoteNeedle: "subject to the 180-day lock-up period described above",
    extractedText: "Early release mechanics refer to a 180-day lock-up period.",
    plainEnglish: "The Underwriting section describes early release mechanics for securities subject to a 180-day lock-up period.",
    whyItMatters: "Release timing can affect when additional shares may become available for trading.",
    extractionMethod: "underwriting-lockup-release-extraction",
    requiredTerms: ["180-day lock-up", "Early Release Eligible Shares"],
  });

  add({
    topic: "financial",
    title: "The company does not expect to pay cash dividends soon.",
    chunkId: "chunk-section43dividendpolicy-1",
    quoteNeedle: "We do not anticipate declaring or paying any cash dividends",
    extractedText: "No anticipated cash dividends in the foreseeable future.",
    plainEnglish: "The Dividend Policy section says the company does not anticipate declaring or paying cash dividends in the foreseeable future.",
    whyItMatters: "For retail holders, expected return would depend on share value changes rather than near-term cash dividends.",
    extractionMethod: "dividend-policy-extraction",
    requiredTerms: ["cash dividends", "foreseeable future"],
  });

  // Intentionally weak drafts: these should be rejected and counted, proving the quality gate catches old v0-style issues.
  add({
    topic: "debt",
    title: "Debt keyword candidate from glossary",
    chunkId: "chunk-section34glossaryofterms-1",
    quoteNeedle: "Credit Facility",
    extractedText: "Weak debt keyword match.",
    plainEnglish: "Debt keyword candidate.",
    whyItMatters: "Should be rejected.",
    extractionMethod: "rejected-broad-keyword-match",
  });
  add({
    topic: "financial",
    title: "Financial table candidate from table of contents",
    chunkId: "chunk-section74indextofinancialstatements-1",
    quoteNeedle: "Consolidated Balance Sheets",
    extractedText: "Weak financial table candidate.",
    plainEnglish: "Financial table candidate.",
    whyItMatters: "Should be rejected.",
    extractionMethod: "rejected-toc-financial-match",
  });

  return { accepted, rejected };
}

function riskTheme(text: string): string {
  if (/\b(starship|launch|rocket|spacecraft|orbit|mission)\b/i.test(text)) return "launch/space operations";
  if (/\b(starlink|connectivity|satellite|broadband|spectrum)\b/i.test(text)) return "Starlink/connectivity";
  if (/\b(ai|xai|grok|compute|data center|model)\b/i.test(text)) return "AI/xAI";
  if (/\b(government|regulatory|license|permit|fcc|faa|export control|sanctions)\b/i.test(text)) return "government/regulatory";
  if (/\b(cash flow|revenue|loss|operating results|capital expenditures)\b/i.test(text)) return "financial/cash flow";
  if (/\b(debt|bridge loan|credit facility|liquidity|indebtedness)\b/i.test(text)) return "debt/liquidity";
  if (/\b(competition|competitors|compete)\b/i.test(text)) return "competition";
  if (/\b(voting|control|musk|board|governance|controlled company)\b/i.test(text)) return "governance/control";
  if (/\b(dilution|common stock|shares eligible|lock-up)\b/i.test(text)) return "dilution/share structure";
  if (/\b(litigation|legal|lawsuit|claims)\b/i.test(text)) return "legal/litigation";
  if (/\b(cyber|security breach|data breach)\b/i.test(text)) return "cybersecurity";
  if (/\b(supply|supplier|manufactur|component|shortage)\b/i.test(text)) return "supply chain/manufacturing";
  if (/\b(macro|geopolitical|inflation|interest rate|economic conditions)\b/i.test(text)) return "macro/geopolitical";
  return "other";
}

function riskPlainEnglish(theme: string): string {
  const explanations: Record<string, string> = {
    "launch/space operations": "In plain English, the filing is saying that parts of the IPO story depend on scaling complex launch and space systems that can face operational setbacks.",
    "Starlink/connectivity": "In plain English, the filing is saying that connectivity growth depends on satellites, spectrum, network operations, and customer adoption continuing to develop as planned.",
    "AI/xAI": "In plain English, the filing is saying that AI growth depends on capital-intensive compute, model development, data access, and execution in a fast-changing market.",
    "government/regulatory": "In plain English, the filing is saying that licenses, government contracts, policy decisions, and regulatory compliance can affect operations.",
    "financial/cash flow": "In plain English, the filing is saying that revenue growth, operating losses, cash generation, or capital spending may not develop as expected.",
    "debt/liquidity": "In plain English, the filing is saying that debt, financing terms, and liquidity needs can affect flexibility.",
    competition: "In plain English, the filing is saying that other companies or technologies could pressure growth, pricing, or market position.",
    "governance/control": "In plain English, the filing is saying that control rights and governance structure may limit public shareholder influence.",
    "dilution/share structure": "In plain English, the filing is saying that share issuance, voting classes, or future sales can affect ownership economics.",
    "legal/litigation": "In plain English, the filing is saying that claims, disputes, or legal rules may create costs or constraints.",
    cybersecurity: "In plain English, the filing is saying that security incidents could affect systems, data, operations, or trust.",
    "supply chain/manufacturing": "In plain English, the filing is saying that suppliers, manufacturing scale, and component availability can affect execution.",
    "macro/geopolitical": "In plain English, the filing is saying that broader economic or geopolitical conditions can affect demand, costs, or operations.",
    other: "In plain English, the filing is flagging an uncertainty that should be read in the source context before drawing conclusions.",
  };
  return explanations[theme] ?? explanations.other;
}

function addRiskEvidenceCards(risks: RiskFactor[], chunks: FilingChunk[], accepted: EvidenceCard[], rejected: RejectedEvidence[]) {
  const selectedByTheme = new Map<string, number>();
  for (const risk of risks) {
    if (risk.riskExtractionType !== "full_text") continue;
    if (risk.title.length < 40 || /additional risks|if any of the following risks/i.test(risk.title)) continue;
    const chunk = chunkById(chunks, risk.sourceChunkIds[0]);
    if (!chunk || chunk.title.trim() !== "RISK FACTORS") continue;
    const theme = riskTheme(`${risk.title} ${risk.originalText}`);
    if ((selectedByTheme.get(theme) ?? 0) >= 2) continue;
    addEvidenceCard(
      {
        topic: "risk",
        title: `${theme}: ${risk.title}`,
        chunkId: chunk.id,
        quoteNeedle: risk.title.slice(0, 80),
        extractedText: excerpt(risk.originalText, 900),
        plainEnglish: `${riskPlainEnglish(theme)} The filing's risk title is: "${risk.title}".`,
        whyItMatters: "Risk factors describe uncertainties the company says could materially affect its business, financial condition, results, or offering economics.",
        confidence: "medium",
        needsReview: false,
        extractionMethod: `risk-full-text-${theme}`,
        requiredTerms: risk.title.split(/\s+/).filter((word) => word.length > 5).slice(0, 2),
        allowedTitles: ["RISK FACTORS"],
      },
      chunks,
      accepted,
      rejected,
    );
    selectedByTheme.set(theme, (selectedByTheme.get(theme) ?? 0) + 1);
  }
}

function makeItem(card: EvidenceCard, chunksById: Map<string, FilingChunk>, idPrefix = "evidence"): BriefItem {
  return {
    id: stableId([idPrefix, card.id]),
    title: card.title,
    body: card.plainEnglish,
    whyItMatters: card.whyItMatters,
    confidence: card.confidence,
    needsReview: card.needsReview,
    citations: citationFromCard(card, chunksById),
  };
}

function sectionFromCards(id: string, title: string, summary: string, cards: EvidenceCard[], chunksById: Map<string, FilingChunk>, limit = 8): BriefSection {
  return {
    id,
    title,
    summary,
    items: cards.slice(0, limit).map((card) => makeItem(card, chunksById)),
    warnings: cards.length ? [] : [`No high-quality evidence cards were available for ${title}.`],
  };
}

function renderMarkdown(brief: RetailInvestorBrief): string {
  const lines = [`# ${brief.title}`, "", brief.disclaimer, "", "## Filing Snapshot", ""];
  for (const [key, value] of Object.entries(brief.snapshot)) lines.push(`- **${key}:** ${value ?? "unknown"}`);
  for (const section of brief.sections) {
    lines.push("", `## ${section.title}`, "", section.summary, "");
    for (const warning of section.warnings) lines.push(`- Warning: ${warning}`);
    for (const item of section.items) {
      lines.push("", `### ${item.title}`, "", item.body);
      if (item.whyItMatters) lines.push("", `Why it matters: ${item.whyItMatters}`);
      lines.push("", `Confidence: ${item.confidence}. Needs review: ${item.needsReview ? "yes" : "no"}.`, "", "Sources:");
      for (const citation of item.citations) {
        lines.push(`- ${citation.chunkId}${citation.sectionId ? ` / ${citation.sectionId}` : ""}: "${excerpt(citation.quote, 360).replace(/\|/g, "\\|")}"`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

function highConfidence(cards: EvidenceCard[]): EvidenceCard[] {
  return cards.filter((card) => card.confidence === "high" && !card.needsReview);
}

function sourceNotesSection(cards: EvidenceCard[], rejected: RejectedEvidence[], risks: RiskFactor[], chunksById: Map<string, FilingChunk>): BriefSection {
  const firstCard = cards[0];
  const item = firstCard
    ? makeItem(
        {
          ...firstCard,
          id: "source-notes-summary",
          title: "Source notes",
          plainEnglish: `${cards.length} accepted evidence cards were generated. ${rejected.length} weak drafts were rejected before Brief v1 was assembled. ${risks.filter((risk) => risk.riskExtractionType !== "full_text").length} suspicious risk records were excluded from the main risk themes.`,
          whyItMatters: "These notes explain the extraction boundary for Brief v1 without putting parser diagnostics into the main narrative.",
          confidence: "high",
          needsReview: false,
        },
        chunksById,
        "source-notes",
      )
    : undefined;
  return {
    id: "source-notes",
    title: "Source Notes",
    summary: "Brief v1 is built from accepted evidence cards only. Parser diagnostics and rejected weak candidates are kept out of the main narrative.",
    items: item ? [item] : [],
    warnings: rejected.slice(0, 5).map((entry) => `Rejected "${entry.title}": ${entry.reasons.join("; ")}`),
  };
}

async function main() {
  const chunks = (await readJsonFile<FilingChunk[]>(path.join(GENERATED_DIR, "chunks.json"))) ?? [];
  const facts = (await readJsonFile<FilingFact[]>(path.join(GENERATED_DIR, "facts.generated.json"))) ?? [];
  const risks = (await readJsonFile<RiskFactor[]>(path.join(GENERATED_DIR, "risks.generated.json"))) ?? [];
  const chunksById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const { accepted, rejected } = buildManualEvidenceCards(chunks);
  addRiskEvidenceCards(risks, chunks, accepted, rejected);

  const byTopic = (topic: EvidenceCard["topic"]) => accepted.filter((card) => card.topic === topic);
  const tenThings = highConfidence(accepted)
    .filter((card) => ["offering", "proceeds", "financial", "debt", "dilution", "governance", "related_party", "lockup"].includes(card.topic))
    .slice(0, 10);
  const riskCards = byTopic("risk");
  const riskThemesSelected = new Set(riskCards.map((card) => card.title.split(":")[0])).size;
  const actualFinancialValueCount = accepted.filter((card) => card.extractionMethod.startsWith("financial-value")).length;

  const brief: RetailInvestorBrief = {
    id: "spacex-ipo-filing-brief-v1",
    title: "SpaceX IPO Filing Brief v1",
    generatedAt: new Date().toISOString(),
    filing: {
      companyName: "Space Exploration Technologies Corp.",
      formType: "S-1",
      accessionNumber: TARGETS.accessionNumber,
      filingDate: TARGETS.filedAt,
      sourceUrl: TARGETS.filingUrl,
    },
    disclaimer: DISCLAIMER,
    snapshot: {
      companyName: "Space Exploration Technologies Corp.",
      formType: "S-1",
      accessionNumber: TARGETS.accessionNumber,
      filingDate: TARGETS.filedAt,
      sourceFilingUrl: TARGETS.filingUrl,
    },
    sections: [
      {
        id: "ten-things",
        title: "10 Things Retail Investors Should Notice",
        summary: "These points are selected from high-confidence evidence cards only.",
        items: tenThings.map((card) => makeItem(card, chunksById, "notice")),
        warnings: tenThings.length < 10 ? [`Only ${tenThings.length} high-confidence notice items were available.`] : [],
      },
      sectionFromCards("what-spacex-says-it-does", "What SpaceX Says It Does", "The filing frames SpaceX as a business spanning launch, connectivity, and AI infrastructure.", byTopic("business"), chunksById, 6),
      sectionFromCards("offering-mechanics", "Offering Mechanics", "The offering section below sticks to terms that are actually visible in the preliminary filing.", byTopic("offering"), chunksById, 6),
      sectionFromCards("financial-snapshot", "Financial Snapshot", "These cards include deterministic financial values from MD&A, capitalization, and notes sections. Values are in millions where the filing table says so.", byTopic("financial"), chunksById, 8),
      sectionFromCards("use-of-proceeds", "Use of Proceeds", "The Use of Proceeds section is preliminary but gives a clear direction for the expected use of funds.", byTopic("proceeds"), chunksById, 5),
      sectionFromCards("dilution-capitalization", "Dilution and Capitalization", "These disclosures describe dilution placeholders and capital structure items that are visible in the current filing.", [...byTopic("dilution"), ...byTopic("debt").filter((card) => card.title.includes("long-term debt"))], chunksById, 6),
      sectionFromCards("control-governance", "Control and Governance", "Governance cards prioritize voting rights, control, and beneficial ownership disclosures.", byTopic("governance"), chunksById, 6),
      sectionFromCards("debt-liquidity", "Debt and Liquidity", "Debt and liquidity cards come from MD&A, Capitalization, and Notes rather than glossary matches.", byTopic("debt"), chunksById, 8),
      sectionFromCards("related-party-affiliated-transactions", "Related-Party / Affiliated Transactions", "These cards use the dedicated related-person transaction section and named transaction language.", byTopic("related_party"), chunksById, 5),
      sectionFromCards("lockup-share-overhang", "Lockup and Future Share Overhang", "These cards summarize future-sale and lock-up disclosures that may affect post-offering share supply.", byTopic("lockup"), chunksById, 5),
      sectionFromCards("key-risk-themes", "Key Risk Themes", "Only full-text risk records are used here; fragments, headings, and table-of-contents records are excluded.", riskCards, chunksById, 18),
      {
        id: "unclear-needs-review",
        title: "What Is Still Unclear or Needs Review",
        summary: "The current S-1 is preliminary, and some useful topics still require human review before stronger conclusions are written.",
        items: [...byTopic("proceeds"), ...byTopic("dilution"), ...byTopic("lockup")]
          .filter((card) => /blank|placeholder|period remains blank|not specified/i.test(`${card.title} ${card.plainEnglish}`))
          .map((card) => makeItem(card, chunksById, "review")),
        warnings: rejected.slice(0, 8).map((entry) => `Rejected weak candidate "${entry.title}": ${entry.reasons.join("; ")}`),
      },
      sourceNotesSection(accepted, rejected, risks, chunksById),
    ],
    diagnostics: {
      generatedFactCount: facts.length,
      reviewedFactCount: 0,
      generatedRiskCount: risks.length,
      reviewedRiskCount: 0,
      fullTextRiskCount: risks.filter((risk) => risk.riskExtractionType === "full_text").length,
      excludedSuspiciousRiskCount: risks.filter((risk) => risk.riskExtractionType !== "full_text").length,
      evidenceCardCount: accepted.length,
      highConfidenceEvidenceCardCount: highConfidence(accepted).length,
      rejectedWeakCandidateCount: rejected.length,
      actualFinancialValueCount,
      riskThemesSelected,
      warnings: [
        `${rejected.length} weak candidate cards were rejected before Brief v1 generation.`,
        `${risks.filter((risk) => risk.riskExtractionType !== "full_text").length} suspicious risk records were excluded.`,
      ],
    },
  };

  await writeJsonFile(EVIDENCE_CARDS_PATH, accepted);
  await writeJsonFile(path.join(GENERATED_DIR, "evidence-cards.rejected.json"), rejected);
  await writeJsonFile(BRIEF_JSON_PATH, brief);
  const reviewedBriefPath = path.join(REVIEWED_DIR, "brief.reviewed.json");
  if (!(await readJsonFile<unknown[]>(reviewedBriefPath))) await writeJsonFile(reviewedBriefPath, []);
  await mkdir(path.dirname(BRIEF_MD_PATH), { recursive: true });
  await writeFile(BRIEF_MD_PATH, renderMarkdown(brief));
  const validation = await validateBrief();
  for (const warning of validation.warnings) console.warn(`Warning: ${warning}`);
  if (validation.errors.length) {
    console.error("Brief validation failed:");
    for (const error of validation.errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`Generated Brief v1 with ${accepted.length} evidence cards and ${brief.sections.flatMap((section) => section.items).length} brief items.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
