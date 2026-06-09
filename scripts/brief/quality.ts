// Shared quality predicates for the brief generator AND validator. Keeping these in one
// place is deliberate: the validator previously re-implemented weaker copies of the
// generator's gates (a looser fragment check, an incomplete topic allow-list), so a card
// the generator accepted could be one the validator never re-checked. Both sides now import
// the SAME rules from here, so they cannot drift.
import type { EvidenceCard } from "../lib/schema";
import { normalizeTitle, normalizeWhitespace } from "../lib/normalize";

export type EvidenceTopic = EvidenceCard["topic"];

// Sections that are never an acceptable citation source (front-matter / index / glossary).
export const badCitationTitles = [
  "document preamble",
  "table of contents",
  "glossary of terms",
  "index to financial statements",
  "under the securities act of 1933",
];

// A card of a given topic may only cite a chunk whose (normalized) section title is in this
// list. This is the single source of truth for the topic→section policy.
export const topicAllowedTitles: Record<EvidenceTopic, string[]> = {
  business: ["PROSPECTUS SUMMARY", "BUSINESS"],
  offering: ["PRELIMINARY PROSPECTUS", "UNDERWRITING"],
  financial: ["OPERATIONS", "CAPITALIZATION", "NOTES TO THE CONSOLIDATED FINANCIAL STATEMENTS", "DIVIDEND POLICY"],
  proceeds: ["USE OF PROCEEDS"],
  dilution: ["DILUTION", "CAPITALIZATION"],
  governance: [
    "SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS AND MANAGEMENT",
    "DESCRIPTION OF CAPITAL STOCK",
    "PROSPECTUS SUMMARY",
    "MANAGEMENT",
    "TBOC.",
  ],
  related_party: ["CERTAIN RELATIONSHIPS AND RELATED PERSON TRANSACTIONS", "UNDERWRITING"],
  debt: ["OPERATIONS", "CAPITALIZATION", "NOTES TO THE CONSOLIDATED FINANCIAL STATEMENTS", "UNDERWRITING", "RISK FACTORS"],
  lockup: ["SHARES ELIGIBLE FOR FUTURE SALE", "UNDERWRITING"],
  risk: ["RISK FACTORS"],
};

// True when `chunkTitle` is an allowed source section for `topic`.
export function isAllowedSectionForTopic(topic: EvidenceTopic, chunkTitle: string): boolean {
  const normalized = normalizeTitle(chunkTitle);
  return topicAllowedTitles[topic].some((title) => normalizeTitle(title) === normalized);
}

// Advice guard. The product rules forbid the brief from MAKING a recommendation; they do not
// forbid the filing's own prose from containing words like "sell" or "hold" ("agreed not to
// sell", "we hold"). The previous bare-word pattern (\bbuy|sell|hold\b) both produced false
// positives on quoted filing text and gave false confidence. This matches advice INTENT
// instead, and is applied to evidence-card prose as well as derived brief items.
export const ADVICE_PATTERN =
  /\b(should\s+(?:buy|sell|hold|invest)|buy\s+(?:now|the\s+(?:dip|stock|ipo|offering))|time\s+to\s+(?:buy|sell)|we\s+recommend|our\s+recommendation|recommend(?:ation)?\s+to\s+(?:buy|sell|hold)|strong\s+(?:buy|sell)|must[-\s]buy|attractive\s+valuation|under-?valued|over-?valued|guaranteed(?:\s+returns?)?|safe\s+investment|(?:price|profit|return)\s+targets?)\b/i;

// Risk/uncertainty language a real risk headline must carry.
export const RISK_SIGNAL =
  /(could|may|might|adversely|materially|harm|fail|unable|risk|uncertain|subject to|loss|decline|negativ|delay|disrupt|litigation|breach|violat|depend|prevent|impair)/i;

// SEC HTML embeds page-break furniture ("62 Table of Contents") mid-sentence. Left in, it
// makes the sentence splitter fire in the wrong place and produces orphan titles like
// "Act (or the rules ...)". Strip it before splitting/titling.
export function stripPageFurniture(text: string): string {
  return normalizeWhitespace(
    text
      .replace(/\b\d{1,4}\s*Table of Contents\b/gi, " ")
      .replace(/\bTable of Contents\b/gi, " "),
  );
}

const LEADING_CONNECTIVE =
  /^(Additionally|Moreover|Furthermore|However|Also|In addition|As a result|Accordingly|Therefore|Consequently|Separately|Similarly|Finally|Conversely|Thus|Hence)\b,?\s/i;
// Clausal connectors that make "<clause>, we may ..." a complete sentence rather than a fragment.
const SUBORDINATOR = /^(If|Although|Because|While|When|As|Should|Unless|Given|To|Even|Despite|Since|Where|Whereas|Until|Before|After|Provided)\b/;

// A risk heading is reader-grade only if it is a complete-looking statement: starts with a
// capital, is not an orphaned fragment (mid-sentence continuation, dangling clause, broken
// subject chain, mid-parenthetical stub), and carries real risk language. Both the generator
// (to select cards) and the validator (golden check) use THIS function — no parallel copy.
export function isCleanRiskTitle(title: string): boolean {
  const t = title.trim();
  if (t.length < 45 || t.length > 220) return false;
  if (!/^[A-Z]/.test(t)) return false;
  if (/^[A-Z]{2,},/.test(t)) return false; // orphaned all-caps stub from a mid-word split
  if (LEADING_CONNECTIVE.test(t)) return false; // "Additionally, ..." depends on a prior sentence
  if (/^(Any such|Such|These|Those|This)\b/i.test(t)) return false; // opens with a back-reference to an unseen antecedent
  if (/^[A-Z][a-zA-Z.&/'-]*\s+\((?:or|the|i\.e|e\.g|including|a|an)\b/i.test(t)) return false; // "Act (or the rules ..." mid-parenthetical orphan
  if (/^[^(]*\)/.test(t)) return false; // a closing paren before any opening one -> started mid-parenthetical
  if (/^.{1,40},\s*(which|that)\b/i.test(t)) return false; // leading relative clause
  if (/,\s+and\s+such\s+(persons|entities)\b/i.test(t)) return false; // broken enumerated subject chain
  if (/\bsuch allegations\b/i.test(t)) return false; // dangling back-reference to an unseen antecedent
  if (/\bthe foregoing\b/i.test(t)) return false; // ditto
  // Dangling-verb fragment: a noun phrase, a comma, then a bare verb with no subject
  // ("Arbitration Rules to the extent they will apply, are different ...") — unless the title
  // opens with a clausal connector, which makes it a complete sentence.
  // Note: a bare verb only — NOT "including", which almost always introduces a normal
  // appositive ("... material losses, including its satellites ...") rather than a fragment.
  if (
    !SUBORDINATOR.test(t) &&
    /^[A-Z][\w&/-]*(?:\s+[\w&/.,'-]+){0,10}?,\s+(?:have|has|had|are|is|was|were|will|would|may|might|could|should|can|do|does)\b/.test(t)
  )
    return false;
  // Comma-splice: "<clause>, he/it/they could ..." with no subordinating conjunction.
  if (!SUBORDINATOR.test(t) && /,\s+(?:he|she|it|they|we|you)\s+(?:could|may|might|will|would|can|should)\b/i.test(t)) return false;
  if (/^additional risks|if any of the following risks/i.test(t)) return false; // boilerplate catch-all
  return RISK_SIGNAL.test(t);
}
