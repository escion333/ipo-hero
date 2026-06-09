import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { GENERATED_DIR, readJsonFile, REVIEWED_DIR, writeJsonFile } from "../lib/artifacts";
import { excerpt, isSourceExcerpt, normalizeTitle, normalizeWhitespace, stableId } from "../lib/normalize";
import { TARGETS } from "../lib/sec";
import type { BriefCitation, BriefItem, BriefSection, EvidenceCard, FilingChunk, FilingFact, RetailInvestorBrief, RiskFactor } from "../lib/schema";
import { ADVICE_PATTERN, badCitationTitles, isCleanRiskTitle, RISK_SIGNAL, stripPageFurniture, topicAllowedTitles } from "./quality";
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

function chunkById(chunks: FilingChunk[], id: string): FilingChunk | undefined {
  return chunks.find((chunk) => chunk.id === id);
}

// A sentence boundary is a terminator followed by whitespace — but NOT a dot that is part
// of a table leader run ("Revenue ......... $4,694"), which would otherwise be mistaken for
// a sentence end and snap the window onto the bare figure, dropping the row label.
function isSentenceBoundaryAt(text: string, i: number): boolean {
  return /[.!?]/.test(text[i]) && text[i - 1] !== "." && /\s/.test(text[i + 1] ?? " ");
}

// Snap the lead-in to a clean boundary so a quote never begins mid-word. Prefer the
// start of the sentence the needle sits in (within `floor`), else the next word boundary.
function snapLeadStart(text: string, needleStart: number, floor: number): number {
  for (let i = needleStart - 1; i > floor; i--) {
    if (isSentenceBoundaryAt(text, i)) {
      let j = i + 1;
      while (j < needleStart && /\s/.test(text[j])) j++;
      return j;
    }
  }
  let j = floor;
  if (j > 0 && !/\s/.test(text[j - 1])) {
    while (j < needleStart && !/\s/.test(text[j])) j++; // drop a partial leading word
    while (j < needleStart && /\s/.test(text[j])) j++; // and the whitespace after it
  }
  return j;
}

// Snap the tail to a clean boundary so a quote never ends mid-word. Prefer a sentence end
// in the latter half of the window (so a quote keeps useful length); if the needle's own
// sentence ends immediately and the next sentence runs past `ceil`, fall back to a word
// boundary near `ceil` rather than starving the quote down to the needle alone.
function snapTailEnd(text: string, needleEnd: number, ceil: number): number {
  const minEnd = needleEnd + Math.floor((ceil - needleEnd) / 2);
  for (let i = ceil - 1; i >= minEnd; i--) {
    if (isSentenceBoundaryAt(text, i)) return i + 1;
  }
  let j = Math.min(ceil, text.length);
  if (j < text.length && !/\s/.test(text[j])) {
    while (j > needleEnd && !/\s/.test(text[j - 1])) j--; // drop a partial trailing word
  }
  return j;
}

// Reflow table-flattened text for display: cheerio's .text() concatenates adjacent
// table cells with no separator, producing runs like "$4,694$4,067", "2026December",
// and dotted leaders ("Revenue ......$4,694"). Insert spacing at those glued seams and
// drop the leaders. Only whitespace/punctuation changes — the words and figures are
// untouched, so isSourceExcerpt() still confirms the quote against the source chunk.
function prettifyQuote(quote: string): string {
  return quote
    .replace(/\s*[.…]{2,}\s*/g, " ") // dotted/elided table leaders
    .replace(/(\d)\$/g, "$1 $") // "$4,694$4,067" -> "$4,694 $4,067"
    .replace(/(\))\$/g, "$1 $") // ")$(" cell seam
    .replace(/([A-Za-z])\$/g, "$1 $") // "Total$29,111" -> "Total $29,111"
    .replace(/(\))(\d)/g, "$1 $2") // "(1,943)27" -> "(1,943) 27"
    .replace(/(\d{3,})([A-Z])/g, "$1 $2") // "2026December" / "689195Total" cell seam
    .replace(/(%)([A-Za-z(])/g, "$1 $2") // "15.4%Costs" -> "15.4% Costs" percent-column seam
    .replace(/\s{2,}/g, " ")
    .trim();
}

function quoteWindow(chunk: FilingChunk, needle: string, maxLength = 760): string {
  const text = chunk.text;
  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return prettifyQuote(normalizeWhitespace(text.slice(0, maxLength)));
  const needleEnd = index + needle.length;
  const floor = Math.max(0, index - 140);
  const ceil = Math.min(text.length, Math.max(needleEnd, index + maxLength));
  const start = snapLeadStart(text, index, floor);
  const end = snapTailEnd(text, needleEnd, ceil);
  return prettifyQuote(normalizeWhitespace(text.slice(start, end)));
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
  if (!isSourceExcerpt(chunk.text, sourceQuote)) reasons.push("Source quote is not an exact source chunk excerpt.");
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

// Evidence cards added by the brief-hardening audit: each is a needle-verified, material
// disclosure that the original curated set did not cover. Topic→section and quote-excerpt
// gates apply to these exactly as to the hand-written drafts above.
const gapAuditDrafts: DraftEvidence[] = [
    {
    topic: "business",
    title: "SpaceX launches over 80% of the world's mass to orbit with a 99%+ success rate",
    chunkId: "chunk-section35prospectussummary-1",
    quoteNeedle: "Since 2023, we have launched more than 80% of mass to orbit for the world each year with an over 99% mission success rate with Falcon rockets.",
    extractedText: "SpaceX launches over 80% of the world's mass to orbit with a 99%+ success rate",
    plainEnglish: "Since 2023, SpaceX says it has launched more than 80% of all mass sent to orbit worldwide each year, with an over 99% mission success rate using its Falcon rockets.",
    whyItMatters: "This quantifies SpaceX's scale and reliability in the launch market, a core scale metric not captured by the existing segment-framing cards.",
    confidence: "high",
    extractionMethod: "gap-audit-business",
    requiredTerms: ["80%","99%","Falcon"],
    },
    {
    topic: "business",
    title: "SpaceX is the primary launch provider for the U.S. government",
    chunkId: "chunk-section48business-9",
    quoteNeedle: "We are the primary launch provider for the U.S. government. In 2025, we launched 11 of 12 National Security Space Launch (“NSSL”) medium and heavy lift missions and all five U.S. crew and cargo missions to the International Space Station for NASA.",
    extractedText: "SpaceX is the primary launch provider for the U.S. government",
    plainEnglish: "SpaceX states it is the primary launch provider for the U.S. government, and in 2025 it flew 11 of 12 National Security Space Launch medium and heavy lift missions and all five U.S. crew and cargo missions to the International Space Station for NASA.",
    whyItMatters: "It shows how dependent core launch revenue is on U.S. government and NASA programs, a customer-concentration fact a reader should weigh.",
    confidence: "high",
    extractionMethod: "gap-audit-business",
    requiredTerms: ["U.S. government","NSSL","NASA"],
    },
    {
    topic: "business",
    title: "Starlink reached about 10.3 million subscribers, up roughly 105% year over year",
    chunkId: "chunk-section48business-9",
    quoteNeedle: "As of March 31, 2026, we had approximately 10.3 million Starlink Subscribers, up approximately 105% from 5.0 million subscribers a year prior.",
    extractedText: "Starlink reached about 10.3 million subscribers, up roughly 105% year over year",
    plainEnglish: "As of March 31, 2026, SpaceX reported approximately 10.3 million Starlink subscribers, about 105% more than the roughly 5.0 million subscribers a year earlier.",
    whyItMatters: "Subscriber count and growth rate are central scale metrics for the Connectivity business and are not captured by the existing business cards.",
    confidence: "high",
    extractionMethod: "gap-audit-business",
    requiredTerms: ["10.3 million","105%","5.0 million"],
    },
    {
    topic: "business",
    title: "A fleet of 24 flight-proven, reusable rockets with a growing share of mass to orbit",
    chunkId: "chunk-section48business-25",
    quoteNeedle: "Our fleet of 24 flight-proven, reusable rockets and our growing share of total mass delivered to orbit has increased every year since 2021.",
    extractedText: "A fleet of 24 flight-proven, reusable rockets with a growing share of mass to orbit",
    plainEnglish: "SpaceX describes a fleet of 24 flight-proven reusable rockets and says its share of total mass delivered to orbit has risen every year since 2021, framing reusability as a cost and cadence advantage.",
    whyItMatters: "Reusability economics are SpaceX's stated competitive moat in launch, a topic the existing cards do not address.",
    confidence: "medium",
    extractionMethod: "gap-audit-business",
    requiredTerms: ["24","reusable","rockets"],
    },
    {
    topic: "business",
    title: "Connectivity (Starlink) generated $11,387 million of revenue and $4,423 million of operating income in 2025",
    chunkId: "chunk-section35prospectussummary-3",
    quoteNeedle: "Our Connectivity segment, primarily driven by Starlink, generated revenue of $11,387 million, income from operations of $4,423 million, and Segment Adjusted EBITDA of $7,168 million in 2025",
    extractedText: "Connectivity segment: $11,387 million revenue, $4,423 million operating income, $7,168 million Segment Adjusted EBITDA in 2025.",
    plainEnglish: "For full-year 2025, SpaceX's Connectivity segment, primarily driven by Starlink, generated $11,387 million of revenue, $4,423 million of income from operations, and $7,168 million of Segment Adjusted EBITDA, which the filing presents as year-over-year growth of 49.8%, 120.4%, and 86.2% respectively.",
    whyItMatters: "It shows the Connectivity (Starlink) segment is the company's profit driver, a material part of the segment picture not covered by existing cards.",
    confidence: "high",
    extractionMethod: "gap-audit-business",
    requiredTerms: ["Connectivity","$11,387 million","Starlink"],
    },
    {
    topic: "business",
    title: "About 80% of Starship is manufactured in-house",
    chunkId: "chunk-section48business-25",
    quoteNeedle: "approximately 80% of Starship, SpaceX’s next-generation launch vehicle, is manufactured in-house.",
    extractedText: "About 80% of Starship is manufactured in-house",
    plainEnglish: "SpaceX states that approximately 80% of Starship, its next-generation launch vehicle, is manufactured in-house, reflecting its extreme vertical integration.",
    whyItMatters: "Vertical integration is a stated cost and velocity advantage; this in-house manufacturing figure quantifies it and is not captured by existing cards.",
    confidence: "medium",
    extractionMethod: "gap-audit-business",
    requiredTerms: ["80%","Starship","in-house"],
    },
    {
    topic: "business",
    title: "No large Starlink enterprise customer has voluntarily left since 2023",
    chunkId: "chunk-section48business-9",
    quoteNeedle: "Since 2023, no Starlink Enterprise customer having contributed more than $750,000 of annual revenue has voluntarily discontinued their service, demonstrating the strong performance and value of our offering.",
    extractedText: "No large Starlink enterprise customer has voluntarily left since 2023",
    plainEnglish: "SpaceX states that since 2023, no Starlink enterprise customer contributing more than $750,000 of annual revenue has voluntarily discontinued service, despite customers being able to cancel at any time.",
    whyItMatters: "Enterprise customer retention is a stated indicator of revenue durability in the Connectivity business and is not covered by existing cards.",
    confidence: "medium",
    extractionMethod: "gap-audit-business",
    requiredTerms: ["$750,000","Enterprise","discontinued"],
    },
    {
    topic: "financial",
    title: "Net loss widened to $(4,276) million for the three months ended March 31, 2026.",
    chunkId: "chunk-section47operations-19",
    quoteNeedle: "Net loss ................................................................ $(4,276) $(528) $(3,748) 709.8%",
    extractedText: "Net loss widened to $(4,276) million for the three months ended March 31, 2026.",
    plainEnglish: "On a bottom-line basis, the company reported a net loss of $4,276 million for the three months ended March 31, 2026, compared with a net loss of $528 million a year earlier — an increase of $3,748 million, or 709.8%. The net loss is larger than the operating loss shown elsewhere because it also reflects non-operating items below the operating line.",
    whyItMatters: "The net loss is the company's full bottom-line result and is materially larger than the operating loss already shown elsewhere; it captures the effect of interest expense and other non-operating items below the operating line.",
    confidence: "high",
    extractionMethod: "gap-audit-financial",
    requiredTerms: ["Net loss","(4,276)","(528)"],
    },
    {
    topic: "financial",
    title: "Q1 2026 revenue grew by $627 million, or 15.4%, year over year.",
    chunkId: "chunk-section47operations-19",
    quoteNeedle: "Revenue for the three months ended March 31, 2026 increased by $627 million, or 15.4%, compared to the three months ended March 31, 2025. This increase was primarily due to an increase in revenue from our Connectivity segment of $782 million",
    extractedText: "Q1 2026 revenue grew by $627 million, or 15.4%, year over year.",
    plainEnglish: "Revenue for the three months ended March 31, 2026 increased by $627 million, or 15.4%, year over year, which the company attributes mainly to higher Connectivity (Starlink) revenue and higher launch revenue.",
    whyItMatters: "Existing cards state the Q1 2026 revenue level but not the growth rate versus the prior-year quarter or the segment drivers behind it, which describe the rate and mix of top-line change.",
    confidence: "high",
    extractionMethod: "gap-audit-financial",
    requiredTerms: ["increased by $627 million","15.4%","Connectivity segment"],
    },
    {
    topic: "financial",
    title: "Q1 2026 cost of revenue was $2,388 million and R&D was $3,514 million, up 125.7% year over year.",
    chunkId: "chunk-section47operations-19",
    quoteNeedle: "Cost of revenue .............................................. 2,388 1,962 426 21.7% Research and development ............................. 3,514 1,557 1,957 125.7%",
    extractedText: "Q1 2026 cost of revenue was $2,388 million and R&D was $3,514 million, up 125.7% year over year.",
    plainEnglish: "For Q1 2026, cost of revenue was $2,388 million (up 21.7% from $1,962 million) and research and development expense was $3,514 million (up $1,957 million, or 125.7%, from $1,557 million). R&D was the largest cost line and grew faster than revenue.",
    whyItMatters: "Cost of revenue and the steep R&D increase explain the gap between revenue and the operating loss; existing financial cards report revenue and operating loss but not these underlying expense lines.",
    confidence: "high",
    extractionMethod: "gap-audit-financial",
    requiredTerms: ["Cost of revenue","2,388","Research and development","3,514"],
    },
    {
    topic: "financial",
    title: "Full-year 2025 revenue was $18,674 million, up 33.2% from $14,015 million in 2024.",
    chunkId: "chunk-section47operations-22",
    quoteNeedle: "Revenue ............................................................... $18,674 $14,015 $4,659 33.2%",
    extractedText: "Full-year 2025 revenue was $18,674 million, up 33.2% from $14,015 million in 2024.",
    plainEnglish: "For the full year ended December 31, 2025, consolidated revenue was $18,674 million, an increase of $4,659 million, or 33.2%, over $14,015 million in 2024. This is the annual top-line figure, distinct from the quarterly figures emphasized elsewhere.",
    whyItMatters: "Existing cards focus on the Q1 2026 quarter; the full-year 2025 versus 2024 revenue comparison provides the annual scale and growth rate of the business.",
    confidence: "high",
    extractionMethod: "gap-audit-financial",
    requiredTerms: ["18,674","14,015","33.2%"],
    },
    {
    topic: "financial",
    title: "Connectivity revenue grew on 104.7% subscriber growth offset by a 22.9% ARPU decline.",
    chunkId: "chunk-section47operations-21",
    quoteNeedle: "an increase of $656 million in revenue from our consumer subscribers, composed of 104.7% growth in Starlink Subscribers, offset by an 22.9% decline in Starlink Subscriber ARPU",
    extractedText: "Connectivity revenue grew on 104.7% subscriber growth offset by a 22.9% ARPU decline.",
    plainEnglish: "Connectivity consumer revenue rose $656 million, driven by 104.7% growth in Starlink Subscribers, partially offset by a 22.9% decline in Starlink Subscriber ARPU (average revenue per user) that the company attributes to international expansion and lower-priced plans.",
    whyItMatters: "Subscriber growth paired with a falling per-subscriber price is a key operating trend for the largest revenue segment, describing both the volume and unit-economics direction of Starlink.",
    confidence: "medium",
    extractionMethod: "gap-audit-financial",
    requiredTerms: ["104.7% growth in Starlink Subscribers","22.9% decline","ARPU"],
    },
    {
    topic: "financial",
    title: "Financing cash flow was $7,125 million in Q1 2026 and $26,350 million for full-year 2025.",
    chunkId: "chunk-section47operations-34",
    quoteNeedle: "Financing activities ........................ $7,125 $354 $26,350 $11,830 $422",
    extractedText: "Financing cash flow was $7,125 million in Q1 2026 and $26,350 million for full-year 2025.",
    plainEnglish: "Net cash provided by financing activities was $7,125 million in Q1 2026 (versus $354 million in Q1 2025) and $26,350 million for full-year 2025 (versus $11,830 million in 2024). These inflows reflect debt and capital-stock proceeds and largely funded the heavy investing outflows.",
    whyItMatters: "Financing cash flow is the third statement-of-cash-flows line and is not covered by existing cards, which report only operating and investing cash flow; it shows the scale of external funding the company raised.",
    confidence: "high",
    extractionMethod: "gap-audit-financial",
    requiredTerms: ["Financing activities","7,125","26,350"],
    },
    {
    topic: "financial",
    title: "Q1 2026 investing outflow was driven by a $5,967 million increase in capital expenditures.",
    chunkId: "chunk-section47operations-34",
    quoteNeedle: "an increase in capital expenditures of $5,967 million related to the build out of data centers and related infrastructure, and space launch facilities and related infrastructure, as well as an increase in purchases of marketable securities of $7,489 million",
    extractedText: "Q1 2026 investing outflow was driven by a $5,967 million increase in capital expenditures.",
    plainEnglish: "The large Q1 2026 investing outflow was driven primarily by a $5,967 million increase in capital expenditures for data centers and space launch facilities, plus a $7,489 million increase in purchases of marketable securities. This explains the composition of the investing cash outflow.",
    whyItMatters: "Existing cards report the total investing cash outflow but not its drivers; the magnitude of capex on data centers and launch facilities indicates how the company is deploying capital.",
    confidence: "medium",
    extractionMethod: "gap-audit-financial",
    requiredTerms: ["capital expenditures of $5,967 million","data centers","marketable securities of $7,489 million"],
    },
    {
    topic: "debt",
    title: "SpaceX Bridge Loan effective interest rate was 4.58%; a 100 bps rate rise adds about $200 million of annual interest expense.",
    chunkId: "chunk-section47operations-36",
    quoteNeedle: "The effective interest rate on outstanding borrowings under the SpaceX Bridge Loan was 4.58% as of March 31, 2026. A hypothetical 100 basis point increase in U.S. interest rates would increase annual interest expense by approximately $200 million",
    extractedText: "SpaceX Bridge Loan effective interest rate was 4.58%; a 100 bps rate rise adds about $200 million of annual interest expense.",
    plainEnglish: "As of March 31, 2026, the effective interest rate on outstanding SpaceX Bridge Loan borrowings was 4.58%. The company discloses that a hypothetical 100 basis point increase in U.S. interest rates would increase its annual interest expense by approximately $200 million.",
    whyItMatters: "This quantifies the company's exposure to floating-rate debt; the roughly $200 million per-100bps interest-rate sensitivity indicates a sizable variable-rate borrowing base behind the existing debt cards.",
    confidence: "medium",
    extractionMethod: "gap-audit-debt",
    requiredTerms: ["effective interest rate","4.58%","100 basis point"],
    },
    {
    topic: "financial",
    title: "One customer accounted for about 21% of consolidated revenue in 2025",
    chunkId: "chunk-section76notestotheconsolidatedfinancialstatements-11",
    quoteNeedle: "Consolidated revenue from a significant customer is as follows: Year Ended December 31, 2025 2024 2023 Customer A .................................................................................... 20.9% 24.2% 25.2%",
    extractedText: "One customer accounted for about 21% of consolidated revenue in 2025",
    plainEnglish: "A single unnamed customer (\"Customer A\") accounted for 20.9% of consolidated revenue in 2025, down from 24.2% in 2024 and 25.2% in 2023. The notes state this customer's revenue relates to all three segments and that no other customer exceeded 10% of revenue in those years.",
    whyItMatters: "Revenue concentration in one customer is a disclosed financial-statement fact relevant to understanding how dependent reported revenue is on a single relationship.",
    confidence: "high",
    extractionMethod: "gap-audit-financial",
    requiredTerms: ["Customer A","20.9%","2025"],
    },
    {
    topic: "financial",
    title: "Company recorded a $399 million accrual for probable litigation losses",
    chunkId: "chunk-section79notestotheconsolidatedfinancialstatements-22",
    quoteNeedle: "The Company has recorded an accrual of $399 million for litigation losses that are probable and reasonably estimable",
    extractedText: "Company recorded a $399 million accrual for probable litigation losses",
    plainEnglish: "As of March 31, 2026 the company had recorded a $399 million accrual for litigation losses it considers probable and reasonably estimable, classified in accrued expenses, other current liabilities, and other liabilities. For other matters it says it cannot currently estimate the possible loss or range of loss.",
    whyItMatters: "A quantified litigation accrual is a disclosed balance-sheet liability that helps a reader see the scale of currently estimable legal exposure.",
    confidence: "high",
    extractionMethod: "gap-audit-financial",
    requiredTerms: ["$399 million","litigation","probable"],
    },
    {
    topic: "financial",
    title: "Jury awarded $105 million plus $67 million interest in the Vidstream patent case",
    chunkId: "chunk-section79notestotheconsolidatedfinancialstatements-20",
    quoteNeedle: "The jury awarded Plaintiff $105 million in damages. In November 2025, the district court affirmed the jury’s award and awarded an additional $67 million in prejudgment interest",
    extractedText: "Jury awarded $105 million plus $67 million interest in the Vidstream patent case",
    plainEnglish: "In an April 2025 patent trial, a jury found that Twitter willfully infringed one patent claim and awarded the plaintiff (Vidstream) $105 million in damages; in November 2025 the district court affirmed the award and added $67 million in prejudgment interest. Both the company and the plaintiff have appealed and the appeals remain pending before the Federal Circuit.",
    whyItMatters: "This is a specific quantified adverse legal outcome disclosed in the notes, giving readers a concrete figure for one identified litigation matter.",
    confidence: "medium",
    extractionMethod: "gap-audit-financial",
    requiredTerms: ["$105 million","$67 million","jury"],
    },
    {
    topic: "financial",
    title: "Segment revenue split: Space $619M, Connectivity $3,257M, AI $818M",
    chunkId: "chunk-section79notestotheconsolidatedfinancialstatements-22",
    quoteNeedle: "Space Connectivity AI Total Reportable Segments Revenue ............................................................. $619 $3,257 $818 $4,694",
    extractedText: "Segment revenue split: Space $619M, Connectivity $3,257M, AI $818M",
    plainEnglish: "For the three months ended March 31, 2026 the company reported revenue across its three reportable segments: Space $619 million, Connectivity $3,257 million, and AI $818 million, totaling $4,694 million.",
    whyItMatters: "The segment revenue breakdown shows how the reported total revenue is distributed across the Space, Connectivity, and AI businesses.",
    confidence: "high",
    extractionMethod: "gap-audit-financial",
    requiredTerms: ["Connectivity","$3,257","$4,694"],
    },
    {
    topic: "financial",
    title: "Segment operating results: AI segment lost $2,469M; consolidated operating loss $1,943M",
    chunkId: "chunk-section79notestotheconsolidatedfinancialstatements-22",
    quoteNeedle: "Income (loss) from operations .......................... (662) 1,188 (2,469) (1,943)",
    extractedText: "Segment operating results: AI segment lost $2,469M; consolidated operating loss $1,943M",
    plainEnglish: "For the three months ended March 31, 2026, segment income (loss) from operations was a $662 million loss for Space, $1,188 million of income for Connectivity, and a $2,469 million loss for AI, producing a consolidated operating loss of $1,943 million.",
    whyItMatters: "The per-segment operating results show which segments generated income and which generated losses behind the consolidated operating loss.",
    confidence: "high",
    extractionMethod: "gap-audit-financial",
    requiredTerms: ["Income (loss) from operations","(2,469)","(1,943)"],
    },
    {
    topic: "debt",
    title: "A large concentration of debt principal — $21,540 million — matures in 2027",
    chunkId: "chunk-section79notestotheconsolidatedfinancialstatements-11",
    quoteNeedle: "The future scheduled principal maturities of debt as of March 31, 2026 are as follows: 2026 (remaining nine months) .............................................................................................................. $801",
    extractedText: "Scheduled debt principal maturities: $801 million (2026), $21,540 million (2027), $1,938 million (2028), $2,393 million (2029).",
    plainEnglish: "As of March 31, 2026 the scheduled principal maturities of debt were $801 million for the remaining nine months of 2026, $21,540 million in 2027, $1,938 million in 2028, and $2,393 million in 2029 — a large concentration of principal coming due in 2027.",
    whyItMatters: "The maturity schedule shows when debt principal comes due, including a large concentration in 2027 that the company may need to refinance.",
    confidence: "high",
    extractionMethod: "gap-audit-debt",
    requiredTerms: ["principal maturities","$801","21,540"],
    },
    {
    topic: "debt",
    title: "Refinancing produced a $1,526 million loss on debt extinguishment",
    chunkId: "chunk-section79notestotheconsolidatedfinancialstatements-8",
    quoteNeedle: "resulting in a loss on extinguishment of $1,526 million, recorded in Other expense, net",
    extractedText: "Refinancing produced a $1,526 million loss on debt extinguishment",
    plainEnglish: "The company accounted for repaying several prior loans and notes (including the X B-1 and B-3 Term Loans, the xAI fixed and floating rate loans, and the xAI 12.5% Senior Secured Notes) as a debt extinguishment, which produced a $1,526 million loss recorded in Other expense, net.",
    whyItMatters: "This is a quantified non-recurring charge tied to refinancing activity that affected the period's results.",
    confidence: "medium",
    extractionMethod: "gap-audit-debt",
    requiredTerms: ["loss on extinguishment","$1,526 million","Other expense"],
    },
    {
    topic: "financial",
    title: "CEO award: 1,000 million performance shares tied to $500B-$7.5T market-cap milestones",
    chunkId: "chunk-section79notestotheconsolidatedfinancialstatements-18",
    quoteNeedle: "the Company granted 1,000 million performance-based restricted shares of Class B common stock to Elon Musk",
    extractedText: "CEO award: 1,000 million performance shares tied to $500B-$7.5T market-cap milestones",
    plainEnglish: "In January 2026 the company granted Elon Musk 1,000 million performance-based restricted shares of Class B common stock. The shares vest across 15 equal tranches as the company hits market-capitalization milestones from $500 billion to $7.5 trillion (each $500 billion apart) and establishes a permanent Mars colony of at least one million inhabitants, subject to his continued employment. The grant-date fair value was determined to be $90.40 to $95.92 per share per tranche.",
    whyItMatters: "This is a disclosed, quantified share-based compensation award to the CEO with defined performance conditions.",
    confidence: "high",
    extractionMethod: "gap-audit-financial",
    requiredTerms: ["1,000 million","Elon Musk","market capitalization"],
    },
    {
    topic: "governance",
    title: "Musk holds 85.1% of combined voting power before the offering",
    chunkId: "chunk-section52securityownershipofcertainbeneficialownersandmanagement-1",
    quoteNeedle: "Elon Musk (1) ................................... 849,494,440 12.3% 5,569,053,075 93.6% 85.1%",
    extractedText: "Musk holds 85.1% of combined voting power before the offering",
    plainEnglish: "In the beneficial-ownership table as of May 1, 2026, Elon Musk is shown holding 849,494,440 Class A shares (12.3% of that class) and 5,569,053,075 Class B shares (93.6% of that class), giving him 85.1% of the combined voting power before the offering. The corresponding after-offering percentage columns are left blank in this preliminary filing.",
    whyItMatters: "This quantifies the controlling shareholder's voting position before the IPO. The blank after-offering figures reflect that the offering size and price are not yet set, so the post-IPO voting percentages are not yet disclosed.",
    confidence: "high",
    extractionMethod: "gap-audit-governance",
    requiredTerms: ["Elon Musk","85.1%","Class B"],
    },
    {
    topic: "governance",
    title: "Class C common stock has no voting rights; Class A one vote, Class B ten votes",
    chunkId: "chunk-section53descriptionofcapitalstock-1",
    quoteNeedle: "each holder of our Class A common stock is entitled to one vote per share; each holder of our Class B common stock is entitled to ten votes per share; and the holders of our Class C common stock will have no voting rights",
    extractedText: "Class C common stock has no voting rights; Class A one vote, Class B ten votes",
    plainEnglish: "The charter sets up three classes of common stock: Class A carries one vote per share, Class B carries ten votes per share, and Class C carries no voting rights at all.",
    whyItMatters: "Class C exists in the capital structure but is non-voting, which is relevant to understanding how voting power is concentrated across the three share classes.",
    confidence: "medium",
    extractionMethod: "gap-audit-governance",
    requiredTerms: ["Class A","Class C","no voting rights"],
    },
    {
    topic: "governance",
    title: "Class B common stock can only be issued to Musk, his family, and permitted entities",
    chunkId: "chunk-section54tboc-2",
    quoteNeedle: "Our charter will provide that additional shares of Class B common stock may only be issued in the future to Mr. Musk, his family members and certain entities permitted under our charter.",
    extractedText: "Class B common stock can only be issued to Musk, his family, and permitted entities",
    plainEnglish: "Under the charter, any additional high-vote Class B shares the company issues in the future can go only to Mr. Musk, his family members, and certain entities permitted under the charter.",
    whyItMatters: "This restricts the high-vote share class to the controlling shareholder's circle, which bears on how concentrated voting control can remain over time.",
    confidence: "medium",
    extractionMethod: "gap-audit-governance",
    requiredTerms: ["Class B common stock","Mr. Musk","issued"],
    },
    {
    topic: "governance",
    title: "Controlled-company status lets the company skip board-independence requirements",
    chunkId: "chunk-section49management-4",
    quoteNeedle: "a “controlled company” and may elect not to comply with certain Nasdaq and Nasdaq Texas corporate governance requirements, including the requirements that: •a majority of such company’s board of directors consist of independent directors",
    extractedText: "Controlled-company status lets the company skip board-independence requirements",
    plainEnglish: "As a controlled company under Nasdaq and Nasdaq Texas rules, the company may opt out of several governance requirements, including having a board majority of independent directors and having the nominating and compensation committees composed entirely of independent directors. The filing states it intends to use certain of these exemptions and does not expect a fully independent compensation and nominating committee.",
    whyItMatters: "Reliance on controlled-company exemptions means investors receive fewer of the standard board-independence protections that apply to companies that are not controlled.",
    confidence: "high",
    extractionMethod: "gap-audit-governance",
    requiredTerms: ["controlled company","independent directors","compensation committee"],
    },
    {
    topic: "governance",
    title: "Texas anti-takeover statute (TBOC Section 21.606) restricts business combinations",
    chunkId: "chunk-section54tboc-2",
    quoteNeedle: "We will be subject to Section 21.606 of the TBOC, which in general, prohibits a publicly held Texas corporation, like the Company after the completion of this offering, from engaging, under certain circumstances, in a business combination with an affiliated shareholder",
    extractedText: "Texas anti-takeover statute (TBOC Section 21.606) restricts business combinations",
    plainEnglish: "After the offering the company will be subject to Section 21.606 of the Texas Business Organizations Code, which generally bars certain business combinations with an affiliated shareholder for three years after that person becomes an affiliated shareholder, unless specified board or supermajority shareholder approvals are obtained.",
    whyItMatters: "This is a statutory anti-takeover provision that can make acquisitions of the company more difficult, which the filing itself describes as potentially deterring transactions shareholders might otherwise favor.",
    confidence: "medium",
    extractionMethod: "gap-audit-governance",
    requiredTerms: ["Section 21.606","business combination","affiliated shareholder"],
    },
    {
    topic: "governance",
    title: "Bylaws impose an exclusive forum, mandatory ICC arbitration, and a jury-trial waiver",
    chunkId: "chunk-section54tboc-4",
    quoteNeedle: "the sole and exclusive forum for any of the filing, adjudication and trial of all disputes (“Internal Disputes”) between (i) one or more shareholders and (ii) the Company or its directors, officers, or controlling persons",
    extractedText: "Bylaws impose an exclusive forum, mandatory ICC arbitration, and a jury-trial waiver",
    plainEnglish: "The bylaws designate the Texas Business Court as the sole and exclusive forum for shareholder disputes against the company and its directors, officers, controlling persons, and underwriters, and provide that disputes found outside that forum must instead be settled by mandatory arbitration before the International Chamber of Commerce in Houston, with shareholders deemed to waive the right to a jury trial and barred from bringing claims as a class except at the company's option.",
    whyItMatters: "Exclusive-forum, mandatory-arbitration, jury-waiver, and class-action limitations affect how and where shareholders can pursue claims; the filing notes a court could find some of these provisions unenforceable.",
    confidence: "high",
    extractionMethod: "gap-audit-governance",
    requiredTerms: ["exclusive forum","Internal Disputes","shareholders"],
    },
    {
    topic: "governance",
    title: "Only Class B holders (Musk) can remove Musk from the board and leadership roles",
    chunkId: "chunk-section53descriptionofcapitalstock-1",
    quoteNeedle: "removal of Mr. Musk from his board and leadership roles (Chief Executive Officer and Chairman of our board) requires the approval of the holders of at least a majority of the voting power of the outstanding shares of Class B common stock, voting separately as a class",
    extractedText: "Only Class B holders (Musk) can remove Musk from the board and leadership roles",
    plainEnglish: "The charter provides that removing Mr. Musk from the board or from his CEO and Chairman positions requires approval of at least a majority of the Class B voting power, voting separately as a class. Because Mr. Musk holds a majority of the Class B shares, this effectively means he cannot be removed without his own consent.",
    whyItMatters: "This entrenches the controlling shareholder's leadership and board roles, limiting the ability of other shareholders to effect a change in management.",
    confidence: "high",
    extractionMethod: "gap-audit-governance",
    requiredTerms: ["removal of Mr. Musk","Class B common stock","majority"],
    },
    {
    topic: "offering",
    title: "Underwriters hold a 30-day option to buy additional shares (greenshoe).",
    chunkId: "chunk-section70underwriting-2",
    quoteNeedle: "We have granted to the underwriters an option, exercisable for 30 days after the date of this prospectus, to purchase up to additional shares of Class A common stock at the public offering price",
    extractedText: "Underwriters hold a 30-day option to buy additional shares (greenshoe).",
    plainEnglish: "The company has granted the underwriters an option, exercisable for 30 days after the prospectus date, to buy additional shares of Class A common stock at the public offering price less discounts. The exact number of additional shares is left blank in this preliminary filing.",
    whyItMatters: "An over-allotment (greenshoe) option lets underwriters increase the size of the offering, which affects the final share count and proceeds. The size of this option is not yet disclosed.",
    confidence: "high",
    needsReview: true,
    extractionMethod: "gap-audit-offering",
    requiredTerms: ["option","30 days","additional shares"],
    },
    {
    topic: "offering",
    title: "Per-share and total underwriting discounts and proceeds remain blank placeholders.",
    chunkId: "chunk-section70underwriting-2",
    quoteNeedle: "The following table shows the per share and total public offering price, underwriting discounts and commissions, and proceeds before expenses to us.",
    extractedText: "Per-share and total underwriting discounts and proceeds remain blank placeholders.",
    plainEnglish: "The underwriting section presents a table of the per-share and total public offering price, underwriting discounts and commissions, and proceeds before expenses, shown both with and without exercise of the additional-shares option. In this preliminary filing all of those dollar figures are blank.",
    whyItMatters: "The underwriting discount is the fee paid to the banks and directly reduces the net proceeds to the company. These amounts are not yet filled in.",
    confidence: "high",
    needsReview: true,
    extractionMethod: "gap-audit-offering",
    requiredTerms: ["underwriting discounts and commissions","public offering price","proceeds"],
    },
    {
    topic: "offering",
    title: "Shares are anticipated to be offered to retail investors via online brokerage platforms.",
    chunkId: "chunk-section70underwriting-2",
    quoteNeedle: "we currently anticipate that certain of the shares of Class A common stock offered hereby will, at our request, be offered to retail investors through Charles Schwab & Co., Inc., Fidelity Brokerage Services LLC",
    extractedText: "Shares are anticipated to be offered to retail investors via online brokerage platforms.",
    plainEnglish: "The company anticipates that some shares will, at its request, be offered to retail investors through online brokerage platforms including Charles Schwab, Fidelity, Robinhood, and SoFi (and, per a related passage, E*TRADE) acting as selling group members.",
    whyItMatters: "This describes how individual investors may be able to participate in the IPO. Purchases through these platforms are at the same offering price and time as institutional purchases, subject to each platform's own terms.",
    confidence: "medium",
    extractionMethod: "gap-audit-offering",
    requiredTerms: ["retail investors","Charles Schwab","Fidelity"],
    },
    {
    topic: "lockup",
    title: "Founder and certain significant investors face a longer 366-day lock-up with no early release.",
    chunkId: "chunk-section70underwriting-3",
    quoteNeedle: "Our Founder and certain significant investors have agreed with the underwriters, that during a period of 366 days after the date of this prospectus",
    extractedText: "Founder and certain significant investors face a longer 366-day lock-up with no early release.",
    plainEnglish: "Beyond the standard 180-day lock-up, the Founder (Elon Musk) and certain significant investors agreed to a 366-day lock-up covering an aggregate block of shares, including 100% of the Founder's shares. This block is not subject to any early-release provisions. The percentage of outstanding shares it represents is left blank.",
    whyItMatters: "A longer 366-day restriction on insider shares, with no early release for the Founder, affects when a large portion of insider holdings can reach the public market relative to the general 180-day lock-up.",
    confidence: "high",
    extractionMethod: "gap-audit-lockup",
    requiredTerms: ["Founder","366 days","significant investors"],
    },
    {
    topic: "dilution",
    title: "Filing compares shares and consideration paid by existing investors versus new investors.",
    chunkId: "chunk-section45dilution-1",
    quoteNeedle: "the total number of shares of Class A and Class B common stock owned by Mr. Musk and other existing investors and to be owned by new investors in this offering, the total consideration paid",
    extractedText: "Filing compares shares and consideration paid by existing investors versus new investors.",
    plainEnglish: "The dilution section includes a table comparing the number of shares, the total consideration paid, and the average price per share for Mr. Musk and other existing investors versus new investors in this offering. The specific numbers and percentages are blank in this preliminary filing.",
    whyItMatters: "This disclosure shows how much existing holders paid for their shares relative to what new IPO investors will pay, illustrating the source of dilution. The figures are not yet populated.",
    confidence: "medium",
    needsReview: true,
    extractionMethod: "gap-audit-dilution",
    requiredTerms: ["existing investors","new investors","total consideration"],
    },
    {
    topic: "lockup",
    title: "Total Class A shares outstanding after the offering is left blank.",
    chunkId: "chunk-section55shareseligibleforfuturesale-1",
    quoteNeedle: "Upon the completion of this offering, we will have outstanding an aggregate of shares of Class A common stock.",
    extractedText: "Total Class A shares outstanding after the offering is left blank.",
    plainEnglish: "The filing states that upon completion of the offering the company will have an aggregate number of Class A shares outstanding, but the actual share count is a blank placeholder in this preliminary prospectus. Shares sold in the offering will be freely tradable, while pre-offering shares are treated as restricted securities under Rule 144.",
    whyItMatters: "The total post-offering share count determines the public float and the denominator for ownership and per-share figures. It is not yet disclosed.",
    confidence: "medium",
    needsReview: true,
    extractionMethod: "gap-audit-lockup",
    requiredTerms: ["completion of this offering","outstanding","Class A common stock"],
    },
    {
    topic: "dilution",
    title: "Pro forma as-adjusted capitalization column is blank pending the IPO price.",
    chunkId: "chunk-section44capitalization-1",
    quoteNeedle: "sale of shares of our Class A common stock in this offering at an assumed initial offering price of $ per share, which is the midpoint",
    extractedText: "Pro forma as-adjusted capitalization column is blank pending the IPO price.",
    plainEnglish: "The capitalization table presents actual, pro forma, and pro forma as-adjusted columns. The pro forma as-adjusted column reflects the sale of shares at an assumed IPO price (midpoint of the range) and application of net proceeds, but the price per share and resulting as-adjusted figures are blank in this preliminary filing.",
    whyItMatters: "The pro forma as-adjusted column shows how the offering would change the company's cash and equity structure, but the key inputs depend on the not-yet-set IPO price.",
    confidence: "medium",
    needsReview: true,
    extractionMethod: "gap-audit-dilution",
    requiredTerms: ["assumed initial offering price","pro forma as adjusted","net proceeds"],
    },
    {
    topic: "lockup",
    title: "Holders of additional shares will have registration rights after the offering.",
    chunkId: "chunk-section55shareseligibleforfuturesale-1",
    quoteNeedle: "holders of an aggregate of approximately shares of our Class A common stock will be entitled to certain rights with respect to the registration of such shares under the Securities Act",
    extractedText: "Holders of additional shares will have registration rights after the offering.",
    plainEnglish: "After the offering, holders of an aggregate number of Class A shares will have registration rights, which can make those shares eligible for public sale upon registration. The aggregate share figure is a blank placeholder in this preliminary filing.",
    whyItMatters: "Registration rights can bring additional insider shares to the public market over time, separate from the lock-up mechanics, affecting future supply of tradable shares.",
    confidence: "medium",
    needsReview: true,
    extractionMethod: "gap-audit-lockup",
    requiredTerms: ["registration","rights","Securities Act"],
    },
    {
    topic: "related_party",
    title: "Tesla commercial dealings: SpaceX and xAI bought hundreds of millions in goods and services",
    chunkId: "chunk-section51certainrelationshipsandrelatedpersontransactions-1",
    quoteNeedle: "xAI is party to certain commercial, licensing, and support agreements with Tesla. Under these agreements, xAI obtained goods and services of $191 million in 2024, $506 million in 2025, and $34 million from January 1, 2026 through February 28, 2026",
    extractedText: "Tesla commercial dealings: SpaceX and xAI bought hundreds of millions in goods and services",
    plainEnglish: "SpaceX's subsidiary xAI bought goods and services from Tesla under commercial, licensing and support agreements, totaling $191 million in 2024, $506 million in 2025, and $34 million from January 1 through February 28, 2026, and recognized $2 million of revenue from Tesla in 2025. Tesla also purchased advertising on the X platform, totaling $0.5 million in 2024 and $4 million in 2025.",
    whyItMatters: "Tesla is controlled by SpaceX's CEO and principal shareholder Elon Musk, so these are sizeable transactions between affiliated Musk entities rather than arms-length deals with unrelated parties. The filing discloses them as related-person transactions.",
    confidence: "high",
    extractionMethod: "gap-audit-related_party",
    requiredTerms: ["Tesla","xAI","$506 million"],
    },
    {
    topic: "related_party",
    title: "Two additional xAI-Valor equipment leases worth $6,633M and $6,587M beyond the first lease",
    chunkId: "chunk-section51certainrelationshipsandrelatedpersontransactions-2",
    quoteNeedle: "a second equipment lease agreement under which such subsidiary leases certain computing and related equipment from Valor, which provides for aggregate cash payments of $6,633 million to be made by such subsidiary over the life of the lease, and (iii) a third equipment lease under which such subsidiary leases certain computing and related equipment from Valor, which provides for aggregate cash payments of $6,587 million",
    extractedText: "Two additional xAI-Valor equipment leases worth $6,633M and $6,587M beyond the first lease",
    plainEnglish: "Beyond the first xAI-Valor equipment lease, the filing describes a second lease providing for aggregate payments of $6,633 million and a third lease providing for $6,587 million, each for computing and related equipment leased from Valor. SpaceX or a subsidiary guarantees the lessees' payment and performance obligations under these agreements.",
    whyItMatters: "Valor is affiliated with SpaceX board member Antonio J. Gracias. The two additional leases roughly triple the total committed cash to a Gracias-affiliated counterparty versus the single lease an existing card covers, and SpaceX guarantees the obligations.",
    confidence: "high",
    extractionMethod: "gap-audit-related_party",
    requiredTerms: ["Valor","$6,633 million","$6,587 million"],
    },
    {
    topic: "related_party",
    title: "Investors' Rights Agreement grants Musk, Google, Valor and DFJ Growth registration rights",
    chunkId: "chunk-section51certainrelationshipsandrelatedpersontransactions-2",
    quoteNeedle: "Certain existing investors in our equity securities, including entities affiliated with Elon Musk, Google, Valor, and DFJ Growth, are party to an Amended and Restated Investors’ Rights Agreement, dated as of August 4, 2020",
    extractedText: "Investors' Rights Agreement grants Musk, Google, Valor and DFJ Growth registration rights",
    plainEnglish: "Existing investors, including entities affiliated with Elon Musk, Google, Valor and DFJ Growth, are party to an Amended and Restated Investors' Rights Agreement dated August 4, 2020 that gives them registration rights for their Class A shares. SpaceX pays all registration expenses other than underwriting discounts and commissions.",
    whyItMatters: "These contractual rights let large affiliated holders compel SpaceX to register and facilitate resale of their shares into the public market, with the company bearing most registration costs.",
    confidence: "medium",
    extractionMethod: "gap-audit-related_party",
    requiredTerms: ["Investors","Google","registration rights"],
    },
    {
    topic: "related_party",
    title: "Security services bought from a Musk-owned security company protecting Mr. Musk",
    chunkId: "chunk-section51certainrelationshipsandrelatedpersontransactions-1",
    quoteNeedle: "We are party to a services agreement with a security company owned by Mr. Musk and organized to provide security services concerning him",
    extractedText: "Security services bought from a Musk-owned security company protecting Mr. Musk",
    plainEnglish: "SpaceX has a services agreement with a security company owned by Elon Musk that provides security services concerning him, including in connection with his SpaceX duties. SpaceX incurred $2 million (2023), $3 million (2024), $4 million (2025) and $1 million (Jan 1 to Feb 28, 2026) for these services.",
    whyItMatters: "Payments flow to a company owned by SpaceX's own CEO, making this a direct transaction between the company and its controlling officer disclosed as a related-person transaction.",
    confidence: "medium",
    extractionMethod: "gap-audit-related_party",
    requiredTerms: ["security","Mr. Musk","services agreement"],
    },
    {
    topic: "related_party",
    title: "Boring Company office lease and Bastrop tunnel construction (Musk-affiliated)",
    chunkId: "chunk-section51certainrelationshipsandrelatedpersontransactions-1",
    quoteNeedle: "In 2024, X entered into a lease for office space with a subsidiary owned by The Boring Company (an entity affiliated with Mr. Musk). Under this agreement, X made lease payments of $0.1 million in 2024, $1 million in 2025",
    extractedText: "Boring Company office lease and Bastrop tunnel construction (Musk-affiliated)",
    plainEnglish: "X leases office space from a subsidiary of The Boring Company, an entity affiliated with Elon Musk, with payments of $0.1 million (2024), $1 million (2025) and $0.1 million (early 2026). SpaceX also incurred $1 million in 2025 for The Boring Company's construction of tunnels in Bastrop, Texas.",
    whyItMatters: "These are dealings with another Musk-affiliated company, illustrating the web of intercompany arrangements among entities the same individual controls.",
    confidence: "medium",
    extractionMethod: "gap-audit-related_party",
    requiredTerms: ["Boring Company","Mr. Musk","lease"],
    },

    // Curated risk-factor cards. Titles are hand-written complete sentences (the validator
    // golden-checks risk titles via isCleanRiskTitle); prose stays faithful to each needle.
    {
      topic: "risk",
      title: "SpaceX has incurred large recurring net losses and warns it may continue to do so.",
      chunkId: "chunk-section40riskfactors-27",
      quoteNeedle: "We incurred net losses of $(4,937) million and $(4,628) million for the years ended December 31, 2025 and 2023, respectively, and a net loss of $(4,276) million",
      extractedText: "Net losses of $4,937 million (2025), $4,628 million (2023), and $4,276 million (Q1 2026).",
      plainEnglish: "The company discloses net losses of $4,937 million for 2025 and $4,628 million for 2023, and a $4,276 million net loss for the three months ended March 31, 2026, and warns that it may continue to incur net losses.",
      whyItMatters: "A sustained history of net losses bears on whether and when the business can become profitable.",
      confidence: "high",
      extractionMethod: "gap-audit-risk",
      allowedTitles: ["RISK FACTORS"],
      requiredTerms: ["net losses", "4,937"],
    },
    {
      topic: "risk",
      title: "The business depends heavily on Elon Musk, and the company maintains no key-person life insurance on him.",
      chunkId: "chunk-section40riskfactors-30",
      quoteNeedle: "We do not maintain key- person life insurance on Mr. Musk.",
      extractedText: "No key-person life insurance is maintained on Mr. Musk.",
      plainEnglish: "In its risk factor on dependence on Elon Musk, the company states that it does not maintain key-person life insurance on Mr. Musk, so the loss of his services could harm the business.",
      whyItMatters: "Heavy reliance on a single individual is a key-person risk the filing itself flags.",
      confidence: "high",
      extractionMethod: "gap-audit-risk",
      allowedTitles: ["RISK FACTORS"],
      requiredTerms: ["key- person", "insurance"],
    },
    {
      topic: "risk",
      title: "The company is largely uninsured and may suffer material losses, including to its in-orbit satellites.",
      chunkId: "chunk-section40riskfactors-28",
      quoteNeedle: "As a general matter, we do not maintain as much insurance coverage as many other companies do, and in some cases, we do not maintain any at all, including with",
      extractedText: "Limited or no insurance coverage in some cases, including in-orbit satellites.",
      plainEnglish: "The company states that, as a general matter, it does not maintain as much insurance coverage as many other companies and in some cases none at all, including for certain in-orbit satellites, so an uninsured loss could be material.",
      whyItMatters: "Limited insurance means losses other companies would recover may fall directly on the company.",
      confidence: "high",
      extractionMethod: "gap-audit-risk",
      allowedTitles: ["RISK FACTORS"],
      requiredTerms: ["insurance coverage", "in-orbit"],
    },
    {
      topic: "risk",
      title: "About one-fifth of 2025 revenue depended on U.S. federal government agencies, a concentration risk.",
      chunkId: "chunk-section40riskfactors-17",
      quoteNeedle: "In 2025, approximately one-fifth of our revenue was attributable to agencies within the U.S. federal government.",
      extractedText: "Approximately one-fifth of 2025 revenue came from U.S. federal government agencies.",
      plainEnglish: "The company states that in 2025 approximately one-fifth of its revenue was attributable to agencies within the U.S. federal government, a concentration that exposes it to changes in government budgets, priorities, and contracting.",
      whyItMatters: "Revenue concentration in U.S. government agencies is a dependency the filing flags as a risk.",
      confidence: "high",
      extractionMethod: "gap-audit-risk",
      allowedTitles: ["RISK FACTORS"],
      requiredTerms: ["one-fifth", "federal government"],
    },
    {
      topic: "risk",
      title: "As a controlled company, SpaceX may rely on exemptions from board-independence requirements.",
      chunkId: "chunk-section40riskfactors-31",
      quoteNeedle: "As a result, we do not expect to have a compensation and nominating committee that is composed entirely of independent directors or that has a committee charter",
      extractedText: "Controlled-company exemptions from certain independent-committee requirements.",
      plainEnglish: "Because Mr. Musk and Class B holders will control a majority of voting power, the company expects to be a 'controlled company' and does not expect to have a compensation and nominating committee composed entirely of independent directors.",
      whyItMatters: "Controlled-company exemptions reduce the independent-oversight protections that otherwise apply to public companies.",
      confidence: "high",
      extractionMethod: "gap-audit-risk",
      allowedTitles: ["RISK FACTORS"],
      requiredTerms: ["compensation and nominating committee", "independent directors"],
    },
    {
      topic: "risk",
      title: "The AI segment has incurred significant operating losses and may not achieve or sustain profitability.",
      chunkId: "chunk-section40riskfactors-27",
      quoteNeedle: "Our AI segment has incurred significant operating losses since inception, and we may not achieve profitability in this segment, or, if achieved, sustain it, and",
      extractedText: "AI segment: significant operating losses since inception; profitability uncertain.",
      plainEnglish: "The company discloses that its AI segment has incurred significant operating losses since inception, that it may not achieve profitability in the segment or sustain it if achieved, and that the segment requires substantial ongoing investment.",
      whyItMatters: "The AI segment is a large, unproven, loss-making bet that consumes capital, which bears on overall profitability.",
      confidence: "high",
      extractionMethod: "gap-audit-risk",
      allowedTitles: ["RISK FACTORS"],
      requiredTerms: ["AI segment", "operating losses"],
    },
    {
      topic: "risk",
      title: "Launch and satellite operations depend on export-control and sanctions authorizations that could be revoked.",
      chunkId: "chunk-section40riskfactors-24",
      quoteNeedle: "The launch and satellite operations are subject to stringent export control and economic and trade sanctions laws, including the U.S. International Traffic in A",
      extractedText: "Operations subject to ITAR export-control and trade-sanctions laws and authorizations.",
      plainEnglish: "The company states that its launch and satellite operations are subject to stringent export-control and trade-sanctions laws, including the U.S. International Traffic in Arms Regulations, and that it must obtain and maintain authorizations that could be denied, suspended, or revoked.",
      whyItMatters: "Loss or denial of export and sanctions authorizations could halt or limit core operations.",
      confidence: "high",
      extractionMethod: "gap-audit-risk",
      allowedTitles: ["RISK FACTORS"],
      requiredTerms: ["export control", "sanctions"],
    },
    {
      topic: "risk",
      title: "Internal control over financial reporting does not yet meet Section 404 standards and may have weaknesses.",
      chunkId: "chunk-section40riskfactors-28",
      quoteNeedle: "Because we currently do not have comprehensive documentation of our internal controls and have not yet tested our internal controls in accordance with Section 4",
      extractedText: "Internal controls not yet tested under Section 404; material weakness cannot be ruled out.",
      plainEnglish: "The company states that, because it does not yet have comprehensive documentation of its internal controls and has not yet tested them in accordance with Section 404, it cannot currently conclude that no material weakness exists.",
      whyItMatters: "Untested internal controls raise the risk of a material weakness and of errors in financial reporting.",
      confidence: "high",
      extractionMethod: "gap-audit-risk",
      allowedTitles: ["RISK FACTORS"],
      requiredTerms: ["internal controls", "material weakness"],
    },
    {
      topic: "risk",
      title: "Foreign-government actions could restrict operations or freeze assets, as when Brazil froze Starlink's assets.",
      chunkId: "chunk-section40riskfactors-17",
      quoteNeedle: "For example, in August 2024, Starlink received an order from Brazil’s Supreme Court that froze Starlink’s Brazilian financial assets and prevented Starlink from",
      extractedText: "Example: Brazil's Supreme Court froze Starlink's Brazilian assets in August 2024.",
      plainEnglish: "The company cites, as an example, an August 2024 order from Brazil's Supreme Court that froze Starlink's Brazilian financial assets and prevented Starlink from operating there, illustrating that foreign-government action can disrupt or seize its operations and assets.",
      whyItMatters: "Cross-border operations expose the company to asset freezes and operating bans by foreign governments.",
      confidence: "high",
      extractionMethod: "gap-audit-risk",
      allowedTitles: ["RISK FACTORS"],
      requiredTerms: ["Brazil", "froze"],
    },
];

function buildManualEvidenceCards(chunks: FilingChunk[]): { accepted: EvidenceCard[]; rejected: RejectedEvidence[] } {
  const accepted: EvidenceCard[] = [];
  const rejected: RejectedEvidence[] = [];
  const add = (draft: DraftEvidence) => addEvidenceCard(draft, chunks, accepted, rejected);
  for (const draft of gapAuditDrafts) add(draft);

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
    quoteNeedle: "under the symbol “SPCX.”",
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
    requiredTerms: ["terrestrial networks", "30 countries"],
  });
  add({
    topic: "business",
    title: "Grok and X are part of the AI segment.",
    chunkId: "chunk-section48business-10",
    quoteNeedle: "our truth-seeking frontier AI model, Grok, AI solutions for consumer and enterprise customers, and X",
    extractedText: "The AI segment includes AI compute infrastructure, Grok, AI solutions, and X.",
    plainEnglish: "The Business section describes the AI segment as a vertically integrated AI platform spanning gigawatt-scale AI compute infrastructure, the Grok frontier model, consumer and enterprise AI solutions, and X.",
    whyItMatters: "This clarifies that the S-1 includes xAI/X-related operations inside the company being described.",
    extractionMethod: "business-ai-segment-extraction",
    requiredTerms: ["Grok", "X", "AI compute infrastructure"],
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
    quoteNeedle: "$4,694 $4,067",
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
    quoteNeedle: "Income (loss) from operations",
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
    quoteNeedle: "$15,852 $24,747",
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
    quoteNeedle: "$1,047 $727",
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
    quoteNeedle: "$(16,724) $(4,170)",
    extractedText: "Net cash used in investing activities: $(16,724) million for Q1 2026.",
    plainEnglish: "The cash flow summary reports $16.724 billion of net cash used in investing activities for the three months ended March 31, 2026.",
    whyItMatters: "Large investing cash outflows help explain the capital intensity of the strategy described elsewhere in the filing.",
    extractionMethod: "financial-value-investing-cash-flow",
    requiredTerms: ["Investing activities", "$(16,724)"],
  });
  add({
    topic: "debt",
    title: "Total long-term debt was $29.111 billion in the capitalization table.",
    chunkId: "chunk-section44capitalization-1",
    quoteNeedle: "$29,111 $29,111",
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
    requiredTerms: ["beneficially own", "5%"],
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

// Map a risk to a concrete subject phrase drawn from its own wording so per-card framing
// names the specific thing at issue rather than only its theme bucket. More specific
// patterns come first; returns undefined when nothing concrete matches.
const RISK_SUBJECTS: Array<[RegExp, string]> = [
  [/\bstarship\b/i, "the Starship program"],
  [/\blaunch pad/i, "launch-pad availability"],
  [/\b(falcon|launch vehicle|reusab|rocket|spacecraft)\b/i, "launch-vehicle operations"],
  [/\b(starlink|satellite|spectrum|broadband|connectivity)\b/i, "satellite connectivity and spectrum"],
  [/\b(internal control|accounting firm|attest|material weakness)\b/i, "internal controls over financial reporting"],
  [/\b(grok|xai|compute|data center|\bai\b|model)\b/i, "the AI segment and compute build-out"],
  [/\b(dividend|return on (?:their )?investment|appreciation of the price)\b/i, "dividends and return on investment"],
  [/\b(indebtedness|bridge loan|credit facility|\bdebt\b|leverage)\b/i, "the company's indebtedness"],
  [/\b(litigation|lawsuit|class action|legal proceeding|claims)\b/i, "pending litigation and legal claims"],
  [/\b(semiconductor|chip|supplier|supply chain|component|shortage)\b/i, "supplier and component concentration"],
  [/\btax\b/i, "tax exposure"],
  // Personnel must be an actual personnel context — a bare "retain" (e.g. "retain a portion
  // of his holdings") must NOT be read as a human-capital risk.
  [/\b(recruit|key personnel|key employees|retain (?:our |key )?(?:personnel|employees|engineers|talent|workforce))\b/i, "recruiting and retaining key personnel"],
  [/\b(regulat|license|permit|\bfcc\b|\bfaa\b|export control|sanctions)\b/i, "regulatory and licensing requirements"],
  [/\b(tboc|governing documents|controlled company|anti-takeover)\b/i, "the company's governing documents"],
  // Voting/control before Musk-affiliations: a Musk-named control risk is about control, not
  // about his competing time. The affiliations subject is reserved for competing-business wording.
  [/\b(voting (?:power|control)|controls? (?:the )?(?:election|removal|board|company)|board (?:selection|election|seats?)|controlled company)\b/i, "voting control and board influence"],
  [/\b(compet\w* with us|other businesses owned by|affiliated with him|dispose of their interests|other companies)\b/i, "Mr. Musk's competing time and affiliations"],
  [/\bcompet/i, "competition"],
];
// Prefer a subject inferred from the TITLE sentence; only fall back to the full body when the
// title yields nothing concrete. Keeps the framing aligned with the headline the reader sees.
function riskSubject(titleText: string, bodyText?: string): string | undefined {
  for (const source of [titleText, bodyText ?? ""]) {
    for (const [pattern, subject] of RISK_SUBJECTS) if (pattern.test(source)) return subject;
  }
  return undefined;
}

// Per-card "why it matters": a theme-specific, non-advisory reason that also names the
// card's concrete subject when one is found, so the line carries real per-card signal
// instead of one constant string shared by every risk.
function riskWhyItMatters(theme: string, subject?: string): string {
  const byTheme: Record<string, string> = {
    "launch/space operations": "It bears on the launch and space operations the filing ties to future growth.",
    "Starlink/connectivity": "It bears on the connectivity business the filing presents as a growth driver.",
    "AI/xAI": "It bears on the capital-intensive AI segment the filing highlights.",
    "government/regulatory": "It bears on the licenses and government relationships the operations depend on.",
    "financial/cash flow": "It bears on the revenue, losses, cash generation, and capital spending shown elsewhere in the filing.",
    "debt/liquidity": "It bears on the debt load and liquidity the filing discloses.",
    competition: "It bears on the competitive position the filing describes.",
    "governance/control": "It bears on how much influence public Class A holders have, given the control structure.",
    "dilution/share structure": "It bears on ownership economics and share supply after the offering.",
    "legal/litigation": "It bears on legal exposure that could create costs or constraints.",
    cybersecurity: "It bears on the systems, data, and trust the business relies on.",
    "supply chain/manufacturing": "It bears on the suppliers and manufacturing scale execution depends on.",
    "macro/geopolitical": "It bears on broader economic or geopolitical conditions that affect demand and costs.",
    other: "It is one of the uncertainties the company says could materially affect its business.",
  };
  const lead = byTheme[theme] ?? byTheme.other;
  return subject
    ? `Tied to ${subject}, this is one of the risks the company says could materially affect its business. ${lead}`
    : `This is one of the risks the company says could materially affect its business. ${lead}`;
}

// Split on the whitespace that follows sentence punctuation (keeping the punctuation
// attached to the sentence), except after abbreviations/initials (Mr./U.S./e.g.).
const SENTENCE_BOUNDARY = /(?<=[.!?])(?<!\b(?:Mr|Mrs|Ms|Dr|Jr|Sr|St|Inc|Co|Corp|Ltd|No|vs|e\.g|i\.e|[A-Z])\.)\s+(?=[A-Z(])/;
function splitSentences(text: string): string[] {
  // Split into sentences, but not on abbreviation periods (Mr./U.S./Inc./e.g.) or
  // single-letter initials, so "Mr. Musk ..." is not cut into "Mr." + "Musk ...".
  return normalizeWhitespace(text)
    .split(SENTENCE_BOUNDARY)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

// Trim to a whole-sentence-ish heading: cap length at a word boundary, append an
// ellipsis only when we actually had to cut.
function clampSentence(sentence: string, maxLength: number): string {
  const clean = normalizeWhitespace(sentence);
  if (clean.length <= maxLength) return clean;
  const cut = clean.slice(0, maxLength);
  return `${cut.slice(0, cut.lastIndexOf(" ")).trim()}…`;
}

// Global counterpart of RISK_SIGNAL for density counting.
const RISK_SIGNAL_G = new RegExp(RISK_SIGNAL.source, "gi");
// Concrete entities/figures that make a risk specific rather than generic boilerplate.
const RISK_SPECIFICS = /\b(Starship|Starlink|Falcon|Grok|xAI|Valor|Musk|Nasdaq|FCC|FAA|TBOC|semiconductor|spectrum|Bridge Loan|Credit Facility|indebtedness|litigation|class action|radiation|launch pad)\b/gi;

// Salience: rank candidate risks so the strongest (most specific, risk-loaded, well-sized)
// per theme wins selection instead of merely the first two in filing order.
function riskSalience(risk: RiskFactor, title: string): number {
  const text = `${title} ${risk.originalText}`;
  let score = 0;
  score += 3 * (text.match(RISK_SPECIFICS) ?? []).length; // named entities carry the most signal
  score += Math.min(3, (text.match(/\$|\d{2,}|%/g) ?? []).length); // concrete figures
  score += Math.min(4, (text.match(RISK_SIGNAL_G) ?? []).length); // risk-language density
  const len = risk.originalText.length;
  if (len >= 200 && len <= 1200) score += 2;
  else if (len < 120) score -= 2;
  if (isCleanRiskTitle(title)) score += 2;
  if (risk.specificity === "company_specific") score += 2;
  else if (risk.specificity === "generic") score -= 1;
  return score;
}

// Pick the most informative supporting sentence to quote in the body, preferring
// risk-loaded, concretely-worded, well-sized lines.
function sentenceSalience(sentence: string): number {
  let score = Math.min(3, (sentence.match(RISK_SIGNAL_G) ?? []).length);
  score += Math.min(2, (sentence.match(RISK_SPECIFICS) ?? []).length);
  if (sentence.length >= 60 && sentence.length <= 300) score += 1;
  return score;
}

type RiskCandidate = {
  risk: RiskFactor;
  chunk: FilingChunk;
  theme: string;
  title: string;
  titleSentence: string;
  sentences: string[];
  usedFirstSentence: boolean;
};

// Prefer a theme from the TITLE sentence (so the bucket matches the headline); fall back to
// the body only when the title is too generic to classify.
function riskThemeFor(titleText: string, bodyText: string): string {
  const fromTitle = riskTheme(titleText);
  return fromTitle !== "other" ? fromTitle : riskTheme(bodyText);
}

// Common words that carry no topical signal, so they are excluded when matching a supporting
// sentence to its title.
const RISK_STOPWORDS = new Set([
  "could",
  "would",
  "materially",
  "adversely",
  "business",
  "company",
  "financial",
  "results",
  "operations",
  "condition",
  "affect",
  "ability",
  "these",
  "those",
  "which",
  "their",
  "other",
  "including",
  "result",
  "future",
  "subject",
]);

// Build the reader-facing body from the risk's own follow-on sentences rather than a
// per-theme canned lead, so each card's "what the filing says" is genuinely specific.
// A short subject-anchored framing precedes one or two real, advice-free filing quotes.
// Supporting sentences that share a content word with the title are preferred, so the body
// elaborates the headline rather than the highest-salience sentence anywhere in the chunk.
function riskBody(candidate: RiskCandidate, subject?: string): string {
  const { sentences, titleSentence } = candidate;
  const titleKeywords = (titleSentence.toLowerCase().match(/\b[a-z]{5,}\b/g) ?? []).filter((word) => !RISK_STOPWORDS.has(word));
  const pool = sentences.slice(1).filter((sentence) => sentence.length > 40 && sentence !== titleSentence && !ADVICE_PATTERN.test(sentence));
  const related = pool.filter((sentence) => {
    const lower = sentence.toLowerCase();
    return titleKeywords.some((keyword) => lower.includes(keyword));
  });
  const supporting = (related.length ? related : pool).sort((a, b) => sentenceSalience(b) - sentenceSalience(a));
  const framing = subject ? `This risk concerns ${subject}.` : "This is one of the filing's stated risk factors.";
  if (supporting.length === 0) {
    // Single-sentence risk: fall back to quoting the (advice-free) title sentence itself.
    const fallback = ADVICE_PATTERN.test(titleSentence) ? "" : ` The filing states: "${clampSentence(titleSentence, 240)}"`;
    return `${framing}${fallback}`.trim();
  }
  let body = `${framing} The filing states: "${clampSentence(supporting[0], 240)}"`;
  if (supporting[1]) body += ` It adds: "${clampSentence(supporting[1], 200)}"`;
  return body;
}

// Calibrate QA signals from concrete quality cues so weak/heuristic extractions are
// honestly flagged instead of every card reading as a uniform "medium / no review".
// Risk cards are rule/regex extractions, so they never claim "high" (reserved for the
// curated manual cards): a clean extraction is "medium", a weak one is "low" + review.
function calibrateRisk(candidate: RiskCandidate, sourceQuote: string): { confidence: EvidenceCard["confidence"]; needsReview: boolean } {
  const supportingCount = candidate.sentences.slice(1).filter((sentence) => sentence.length > 40 && sentence !== candidate.titleSentence).length;
  const alphanumeric = sourceQuote.replace(/[^a-z0-9]/gi, "").length;
  const digits = (sourceQuote.match(/[0-9]/g) ?? []).length;
  const digitRatio = alphanumeric ? digits / alphanumeric : 0;
  // Weak signals: the heading is a fallback rather than a clean first sentence, the risk
  // has no follow-on sentence to explain itself, or the quote is mostly table digits.
  const weak = !candidate.usedFirstSentence || supportingCount === 0 || digitRatio > 0.25;
  if (weak) return { confidence: "low", needsReview: true };
  return { confidence: "medium", needsReview: false };
}

function addRiskEvidenceCards(risks: RiskFactor[], chunks: FilingChunk[], accepted: EvidenceCard[], rejected: RejectedEvidence[]) {
  // Build candidates, derive the reader-facing title, then rank by salience so the
  // strongest risk per theme is selected rather than the first two in filing order.
  const candidates: RiskCandidate[] = [];
  for (const risk of risks) {
    if (risk.riskExtractionType !== "full_text") continue;
    // Page-break furniture ("62 Table of Contents") embedded mid-text otherwise misplaces the
    // sentence split and orphans the title; strip it before splitting/titling.
    const cleanText = stripPageFurniture(risk.originalText);
    if (!isCleanRiskTitle(risk.title) && !isCleanRiskTitle(stripPageFurniture(risk.title))) continue;
    const chunk = chunkById(chunks, risk.sourceChunkIds[0]);
    if (!chunk || chunk.title.trim() !== "RISK FACTORS") continue;
    const sentences = splitSentences(cleanText);
    const usedFirstSentence = Boolean(sentences[0] && sentences[0].length >= 45 && isCleanRiskTitle(sentences[0]));
    const titleSentence = usedFirstSentence ? sentences[0] : stripPageFurniture(risk.title);
    const title = clampSentence(titleSentence, 180);
    // Never surface a fragmentary heading (the validator also golden-checks this).
    if (!isCleanRiskTitle(title) || ADVICE_PATTERN.test(title)) continue;
    candidates.push({ risk: { ...risk, originalText: cleanText }, chunk, theme: riskThemeFor(titleSentence, cleanText), title, titleSentence, sentences, usedFirstSentence });
  }
  candidates.sort((a, b) => riskSalience(b.risk, b.title) - riskSalience(a.risk, a.title));

  // Cap per theme AND per source chunk so one disclosure (e.g. the Musk-conflict chunk) cannot
  // occupy several slots under different theme buckets and crowd out other risks.
  const selectedByTheme = new Map<string, number>();
  const selectedByChunk = new Map<string, number>();
  for (const candidate of candidates) {
    if ((selectedByTheme.get(candidate.theme) ?? 0) >= 2) continue;
    if ((selectedByChunk.get(candidate.chunk.id) ?? 0) >= 2) continue;
    const { chunk, theme, title, titleSentence } = candidate;
    const subject = riskSubject(titleSentence, candidate.risk.originalText);
    const sourceQuote = quoteWindow(chunk, candidate.titleSentence.slice(0, 80));
    const { confidence, needsReview } = calibrateRisk(candidate, sourceQuote);

    addEvidenceCard(
      {
        topic: "risk",
        title,
        chunkId: chunk.id,
        quoteNeedle: titleSentence.slice(0, 80),
        extractedText: excerpt(candidate.risk.originalText, 900),
        plainEnglish: riskBody(candidate, subject),
        whyItMatters: riskWhyItMatters(theme, subject),
        confidence,
        needsReview,
        extractionMethod: `risk-full-text-${theme}`,
        requiredTerms: titleSentence
          .split(/\s+/)
          .map((word: string) => word.replace(/^[^\w$]+|[^\w%]+$/g, ""))
          .filter((word: string) => word.length > 5)
          .slice(0, 2),
        allowedTitles: ["RISK FACTORS"],
      },
      chunks,
      accepted,
      rejected,
    );
    selectedByTheme.set(theme, (selectedByTheme.get(theme) ?? 0) + 1);
    selectedByChunk.set(chunk.id, (selectedByChunk.get(chunk.id) ?? 0) + 1);
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

// "Still unclear" items cross-reference the full card shown in its home section instead
// of re-rendering it verbatim. Each carries its own citation, a distinct (non-duplicated)
// body keyed to the card title, and needsReview so the open items surface in the badge.
function unclearItem(card: EvidenceCard, homeSection: string, chunksById: Map<string, FilingChunk>): BriefItem {
  return {
    id: stableId(["review", card.id]),
    title: card.title,
    body: `The preliminary S-1 leaves this open; the full disclosure is shown under “${homeSection}.” The exact value or period is still blank and needs review once the company fills it in a later amendment.`,
    whyItMatters: "Collected here so the still-blank items are visible in one place without restating the full disclosure.",
    confidence: card.confidence,
    needsReview: true,
    citations: citationFromCard(card, chunksById),
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
  const riskThemesSelected = new Set(riskCards.map((card) => card.extractionMethod.replace(/^risk-full-text-/, ""))).size;
  // Defined structurally (a financial/debt/dilution card whose quoted text carries a real
  // number), not by an author-typed extractionMethod prefix; the validator counts the same way.
  const actualFinancialValueCount = accepted.filter(
    (card) => ["financial", "debt", "dilution"].includes(card.topic) && /\$\s?\d|\(\s?\d|\d[\d,]*(?:\.\d+)?\s*(?:million|billion|%)/.test(card.sourceQuote),
  ).length;

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
      sectionFromCards("what-spacex-says-it-does", "What SpaceX Says It Does", "The filing frames SpaceX as a business spanning launch, connectivity, and AI infrastructure.", byTopic("business"), chunksById, 12),
      sectionFromCards("offering-mechanics", "Offering Mechanics", "The offering section below sticks to terms that are actually visible in the preliminary filing.", byTopic("offering"), chunksById, 12),
      sectionFromCards("financial-snapshot", "Financial Snapshot", "These cards include deterministic financial values from MD&A, capitalization, and notes sections. Values are in millions where the filing table says so.", byTopic("financial"), chunksById, 20),
      sectionFromCards("use-of-proceeds", "Use of Proceeds", "The Use of Proceeds section is preliminary but gives a clear direction for the expected use of funds.", byTopic("proceeds"), chunksById, 8),
      sectionFromCards("dilution-capitalization", "Dilution and Capitalization", "These disclosures describe dilution placeholders and capital structure items that are visible in the current filing.", [...byTopic("dilution"), ...byTopic("debt").filter((card) => card.title.includes("long-term debt"))], chunksById, 10),
      sectionFromCards("control-governance", "Control and Governance", "Governance cards prioritize voting rights, control, and beneficial ownership disclosures.", byTopic("governance"), chunksById, 14),
      sectionFromCards("debt-liquidity", "Debt and Liquidity", "Debt and liquidity cards come from MD&A, Capitalization, and Notes rather than glossary matches. The total long-term debt figure is shown once, under Dilution and Capitalization.", byTopic("debt").filter((card) => !card.title.includes("long-term debt")), chunksById, 12),
      sectionFromCards("related-party-affiliated-transactions", "Related-Party / Affiliated Transactions", "These cards use the dedicated related-person transaction section and named transaction language.", byTopic("related_party"), chunksById, 12),
      sectionFromCards("lockup-share-overhang", "Lockup and Future Share Overhang", "These cards summarize future-sale and lock-up disclosures that may affect post-offering share supply.", byTopic("lockup"), chunksById, 8),
      sectionFromCards("key-risk-themes", "Key Risk Themes", "Only full-text risk records are used here; fragments, headings, and table-of-contents records are excluded.", riskCards, chunksById, riskCards.length),
      {
        id: "unclear-needs-review",
        title: "What Is Still Unclear or Needs Review",
        summary: "The current S-1 is preliminary, and some useful topics still require human review. These items cross-reference the full disclosure shown above rather than repeat it.",
        items: [
          ...byTopic("proceeds").map((card) => [card, "Use of Proceeds"] as const),
          ...byTopic("dilution").map((card) => [card, "Dilution and Capitalization"] as const),
          ...byTopic("lockup").map((card) => [card, "Lockup and Future Share Overhang"] as const),
        ]
          .filter(([card]) => /blank|placeholder|period remains blank|not specified/i.test(`${card.title} ${card.plainEnglish}`))
          .map(([card, homeSection]) => unclearItem(card, homeSection, chunksById)),
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
