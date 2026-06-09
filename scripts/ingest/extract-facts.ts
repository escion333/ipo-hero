import type { FilingChunk, FilingDocument, FilingFact, FilingSection } from "../lib/schema";
import { TARGETS } from "../lib/sec";
import { excerpt, normalizeTitle, normalizeWhitespace, stableId } from "../lib/normalize";

type FactInput = {
  documents: FilingDocument[];
  sections: FilingSection[];
  chunks: FilingChunk[];
  riskFactorCount: number;
  tableCount: number;
};

function findChunk(chunks: FilingChunk[], predicate: (chunk: FilingChunk) => boolean): FilingChunk | undefined {
  return chunks.find(predicate);
}

function sectionChunk(chunks: FilingChunk[], titleNeedle: string): FilingChunk | undefined {
  const normalizedNeedle = normalizeTitle(titleNeedle);
  return findChunk(chunks, (chunk) => normalizeTitle(chunk.title).includes(normalizedNeedle));
}

function makeFact(
  label: string,
  category: FilingFact["category"],
  valueText: string,
  plainEnglish: string,
  investorRelevance: string,
  chunk: FilingChunk,
  confidence: FilingFact["confidence"] = "medium",
  needsReview = false,
): FilingFact {
  const cleanText = normalizeWhitespace(chunk.text || chunk.title);
  return {
    id: stableId(["fact", label]),
    category,
    label,
    valueText: normalizeWhitespace(valueText),
    plainEnglish,
    investorRelevance,
    confidence,
    sourceChunkIds: [chunk.id],
    sourceQuote: cleanText.slice(0, 700),
    needsReview,
  };
}

function makeMetadataFact(label: string, valueText: string, firstChunk: FilingChunk): FilingFact {
  return makeFact(label, "offering", valueText, `The filing metadata records ${label.toLowerCase()} as ${valueText}.`, "This metadata helps keep the source package auditable.", firstChunk, "high");
}

function firstChunkForSection(chunks: FilingChunk[], section: FilingSection): FilingChunk | undefined {
  return chunks.find((chunk) => chunk.sectionId === section.id);
}

function presenceFact(
  label: string,
  category: FilingFact["category"],
  sections: FilingSection[],
  chunks: FilingChunk[],
  needles: string[],
  relevance: string,
): FilingFact | undefined {
  const section = sections.find((item) => needles.some((needle) => item.normalizedTitle.includes(normalizeTitle(needle))));
  if (!section) return undefined;
  const chunk = firstChunkForSection(chunks, section) ?? chunks.find((item) => item.sectionId === section.id);
  if (!chunk) return undefined;
  return makeFact(
    `${label} section presence`,
    category,
    "Present",
    `The parser found a ${label} section in the filing.`,
    relevance,
    chunk,
    "high",
  );
}

function keywordFact(
  label: string,
  category: FilingFact["category"],
  chunks: FilingChunk[],
  pattern: RegExp,
  relevance: string,
): FilingFact | undefined {
  const chunk = findChunk(chunks, (item) => pattern.test(item.text));
  if (!chunk) return undefined;
  return makeFact(
    `${label} keyword candidate`,
    category,
    excerpt(chunk.text, 450),
    `The parser found source text related to ${label.toLowerCase()}.`,
    relevance,
    chunk,
    "medium",
    true,
  );
}

function keywordFacts(
  label: string,
  category: FilingFact["category"],
  chunks: FilingChunk[],
  pattern: RegExp,
  relevance: string,
  limit = 2,
): FilingFact[] {
  return chunks
    .filter((item) => pattern.test(item.text))
    .slice(0, limit)
    .map((chunk, index) =>
      makeFact(
        `${label} candidate ${index + 1}`,
        category,
        excerpt(chunk.text, 450),
        `The parser found candidate source text for ${label.toLowerCase()}.`,
        relevance,
        chunk,
        "medium",
        true,
      ),
    );
}

const ownershipAliases = [
  "principal stockholders",
  "principal and selling stockholders",
  "selling stockholders",
  "security ownership",
  "beneficial ownership",
  "ownership of securities",
  "certain beneficial owners",
  "management and principal stockholders",
  "principal shareholders",
  "security ownership of certain beneficial owners and management",
];

export function extractFacts({ documents, sections, chunks, riskFactorCount, tableCount }: FactInput): FilingFact[] {
  const facts: FilingFact[] = [];
  const firstChunk = chunks[0];
  const mainDocument = documents.find((document) => /^s-?1$/i.test(document.type)) ?? documents[0];
  if (!firstChunk || !mainDocument) return facts;

  facts.push(makeFact("Company name", "business", "Space Exploration Technologies Corp.", "The filing identifies Space Exploration Technologies Corp. as the issuer.", "This anchors the analysis to the company named in the filing.", firstChunk, "high"));
  facts.push(makeMetadataFact("Form type", TARGETS.formType, firstChunk));
  facts.push(makeMetadataFact("Filing date", TARGETS.filedAt, firstChunk));
  facts.push(makeMetadataFact("Accession number", TARGETS.accessionNumber, firstChunk));
  facts.push(makeMetadataFact("Document count", `${documents.length}`, firstChunk));
  facts.push(makeFact("Extracted risk factor count", "risk", `${riskFactorCount}`, "The ingestion run counted extracted risk factor records.", "This count is a parser diagnostic and should be reviewed for possible over-splitting or under-splitting.", firstChunk, "medium", true));
  facts.push(makeFact("Extracted table count", "financial", `${tableCount}`, "The ingestion run counted table candidates extracted from the S-1 HTML.", "Tables are likely sources for financial and capitalization data, but they are not normalized yet.", firstChunk, "medium", true));

  const presenceFacts = [
    presenceFact("Prospectus Summary", "business", sections, chunks, ["prospectus summary", "summary"], "The summary is usually the fastest source for the company's own high-level framing."),
    presenceFact("Risk Factors", "risk", sections, chunks, ["risk factors"], "Risk Factors is the source section for company-disclosed risks."),
    presenceFact("Use of Proceeds", "proceeds", sections, chunks, ["use of proceeds"], "Use of Proceeds is the source for how offering proceeds may be used."),
    presenceFact("Dilution", "dilution", sections, chunks, ["dilution"], "Dilution is the source for new investor ownership economics."),
    presenceFact("Capitalization", "financial", sections, chunks, ["capitalization"], "Capitalization can show debt, cash, and equity structure around the offering."),
    presenceFact("MD&A", "financial", sections, chunks, ["managements discussion and analysis", "management's discussion and analysis"], "MD&A is the source for management's discussion of operating results and liquidity."),
    presenceFact("Business", "business", sections, chunks, ["business"], "Business is the source for product, market, and operating descriptions."),
    presenceFact("Beneficial Ownership / Principal Stockholders", "governance", sections, chunks, ownershipAliases, "This ownership section is the source for beneficial ownership and control concentration."),
    presenceFact("Related Party Transactions", "related_party", sections, chunks, ["certain relationships", "related party transactions"], "Related-party disclosures can matter for governance and conflicts analysis."),
    presenceFact("Description of Capital Stock", "governance", sections, chunks, ["description of capital stock"], "This section is the source for share rights and capital structure terms."),
    presenceFact("Underwriting", "offering", sections, chunks, ["underwriting"], "Underwriting is the source for distribution mechanics and offering arrangements."),
  ].filter((fact): fact is FilingFact => Boolean(fact));
  facts.push(...presenceFacts);

  const summaryChunk = sectionChunk(chunks, "prospectus summary") ?? sectionChunk(chunks, "summary");
  if (summaryChunk) {
    facts.push(makeFact("Business summary candidate", "business", excerpt(summaryChunk.text, 450), "The prospectus summary appears to contain the company's own summary of its business.", "This should be reviewed before turning it into consumer-facing analysis.", summaryChunk, "medium", true));
  }

  const proceedsChunk = sectionChunk(chunks, "use of proceeds");
  if (proceedsChunk) {
    facts.push(makeFact("Use of proceeds", "proceeds", excerpt(proceedsChunk.text, 500), "The Use of Proceeds section is present and should be the source for how IPO proceeds may be used.", "This is a key offering detail, especially when terms are preliminary or unspecified.", proceedsChunk, "medium", true));
  }

  const tickerChunk = findChunk(chunks, (chunk) => /nasdaq|nyse|ticker|symbol/i.test(chunk.text));
  if (tickerChunk) {
    // Allow straight OR typographic (curly) quotes, and let the symbol follow the quote
    // directly — the filing writes it as under the symbol “SPCX.” with a curly quote.
    const match = tickerChunk.text.match(/(?:ticker|symbol|under the symbol)\s*["'“”‘’]?\s*([A-Z]{2,6})/i);
    facts.push(makeFact("Ticker/exchange candidate", "offering", match?.[1] ?? excerpt(tickerChunk.text, 300), "The parser found language that may refer to a ticker or exchange.", "Offering terms can change across amendments, so this candidate needs review.", tickerChunk, match ? "medium" : "low", true));
  }

  const shareClassChunk = findChunk(chunks, (chunk) => /class\s+[abc]\s+common|voting power|votes per share/i.test(chunk.text));
  if (shareClassChunk) {
    facts.push(makeFact("Share classes / voting structure candidate", "governance", excerpt(shareClassChunk.text, 450), "The filing appears to describe share classes or voting rights.", "Voting structure affects governance and control but requires exact source wording.", shareClassChunk, "medium", true));
  }

  for (const fact of [
    keywordFact("share, voting, or control", "governance", chunks, /\b(class\s+[abc]\s+common|voting power|votes per share|controlled company|control)\b/i, "Voting and control language can affect governance analysis."),
    keywordFact("debt or liquidity", "debt", chunks, /\b(debt|liquidity|borrowings|credit facility|cash flow|cash flows|indebtedness)\b/i, "Debt and liquidity language can affect financial-condition analysis."),
    keywordFact("related-party", "related_party", chunks, /\b(related party|related-party|certain relationships|affiliates?)\b/i, "Related-party language can identify potential governance or conflict disclosures."),
    keywordFact("proceeds", "proceeds", chunks, /\b(use of proceeds|net proceeds|proceeds from this offering)\b/i, "Proceeds language is the source for how offering funds may be used."),
    keywordFact("dilution", "dilution", chunks, /\b(dilution|net tangible book value)\b/i, "Dilution language helps explain ownership economics for new shares."),
    keywordFact("lockup or shares eligible for future sale", "lockup", chunks, /\b(lock-up|lockup|shares eligible for future sale|market standoff)\b/i, "Lockup and future-sale language can affect post-offering share supply."),
  ]) {
    if (fact) facts.push(fact);
  }

  facts.push(
    ...keywordFacts("class structure", "governance", chunks, /\b(Class A common stock|Class B common stock|Class C common stock|Class D common stock|classes of common stock)\b/i, "Class structure affects voting rights and ownership economics.", 3),
    ...keywordFacts("voting power", "governance", chunks, /\b(voting power|votes per share|ten votes per share|one vote per share)\b/i, "Voting-power language is relevant to governance and control analysis.", 3),
    ...keywordFacts("controlled company", "governance", chunks, /\bcontrolled company\b/i, "Controlled-company language affects governance requirements and board independence context.", 2),
    ...keywordFacts("founder or insider control", "governance", chunks, /\b(Musk|founder|executive officers?|directors?).{0,120}\b(control|voting power|beneficially own|majority)\b/i, "Founder or insider control language can identify who may influence shareholder votes.", 3),
    ...keywordFacts("beneficial ownership", "governance", chunks, /\b(beneficial ownership|beneficially own|security ownership of certain beneficial owners)\b/i, "Beneficial ownership language supports ownership-concentration review.", 3),
    ...keywordFacts("dilution table", "dilution", chunks, /\b(net tangible book value|dilution|as adjusted)\b/i, "Dilution table candidates need review before presenting exact figures.", 3),
    ...keywordFacts("public offering price", "dilution", chunks, /\b(public offering price|initial public offering price|assumed offering price)\b/i, "Offering price language is often preliminary and should be reviewed carefully.", 2),
    ...keywordFacts("general corporate purposes", "proceeds", chunks, /\b(general corporate purposes|working capital)\b/i, "General corporate purposes language describes broad intended use of proceeds.", 2),
    ...keywordFacts("debt repayment from proceeds", "proceeds", chunks, /\b(repay|repayment|retire).{0,80}\b(debt|borrowings|indebtedness|loan)\b/i, "Debt repayment language can affect how proceeds are expected to be used.", 2),
    ...keywordFacts("capex or investment from proceeds", "proceeds", chunks, /\b(capital expenditures|investments?|infrastructure|manufacturing|compute)\b/i, "Investment or capex language can describe growth spending needs.", 3),
    ...keywordFacts("lock-up", "lockup", chunks, /\b(lock-up|lockup|market standoff)\b/i, "Lock-up language can affect future share supply.", 2),
    ...keywordFacts("shares eligible for future sale", "lockup", chunks, /\bshares eligible for future sale\b/i, "Future-sale language is relevant to market overhang review.", 2),
    ...keywordFacts("resale or selling stockholder", "lockup", chunks, /\b(resale|selling stockholders?|selling shareholders?)\b/i, "Resale or selling-stockholder language can identify possible future supply.", 2),
    ...keywordFacts("credit agreement", "debt", chunks, /\bcredit agreement|credit facility\b/i, "Credit agreement language is relevant to debt and liquidity analysis.", 2),
    ...keywordFacts("bridge loan", "debt", chunks, /\bbridge loan\b/i, "Bridge loan language is relevant to near-term debt structure.", 2),
    ...keywordFacts("indebtedness", "debt", chunks, /\bindebtedness\b/i, "Indebtedness language supports debt-risk review.", 2),
    ...keywordFacts("liquidity and capital resources", "debt", chunks, /\b(liquidity|capital resources)\b/i, "Liquidity and capital resources language is relevant to funding needs.", 3),
    ...keywordFacts("xAI or affiliated entity", "related_party", chunks, /\b(xAI|affiliated entity|affiliate|affiliates)\b/i, "Affiliate references may be relevant to related-party and common-control review.", 3),
    ...keywordFacts("insider or founder transactions", "related_party", chunks, /\b(Musk|director|executive officer|founder).{0,140}\b(transaction|agreement|loan|purchase|sale|merger)\b/i, "Insider or founder transaction language needs source-level review.", 3),
    ...keywordFacts("income statement table", "financial", chunks, /\b(consolidated statements of operations|cost of revenue|operating loss|net income|net loss)\b/i, "Income statement table candidates should be reviewed before extracting exact figures.", 3),
    ...keywordFacts("balance sheet table", "financial", chunks, /\b(consolidated balance sheets|total assets|cash and cash equivalents|total liabilities)\b/i, "Balance sheet table candidates should be reviewed before extracting exact figures.", 3),
    ...keywordFacts("cash flow table", "financial", chunks, /\b(consolidated statements of cash flows|net cash provided|net cash used|operating activities)\b/i, "Cash-flow table candidates should be reviewed before extracting exact figures.", 3),
    ...keywordFacts("revenue", "financial", chunks, /\brevenue\b/i, "Revenue mentions are financial candidates, not final extracted metrics.", 2),
    ...keywordFacts("net income or loss", "financial", chunks, /\b(net income|net loss)\b/i, "Net income/loss mentions are financial candidates, not final extracted metrics.", 2),
    ...keywordFacts("cash and cash equivalents", "financial", chunks, /\bcash and cash equivalents\b/i, "Cash and cash equivalents mentions are financial candidates, not final extracted metrics.", 2),
  );

  const dilutionChunk = sectionChunk(chunks, "dilution");
  if (dilutionChunk) {
    facts.push(makeFact("Dilution section presence", "dilution", "Present", "The filing includes a Dilution section.", "Dilution explains how new investors' ownership economics compare with existing stockholders.", dilutionChunk, "high"));
  }

  const stockholderChunk = ownershipAliases.map((alias) => sectionChunk(chunks, alias)).find(Boolean);
  if (stockholderChunk) {
    facts.push(makeFact("Beneficial ownership section presence", "governance", "Present", "The filing includes a beneficial ownership or principal stockholders equivalent section.", "This section is the source for ownership concentration analysis.", stockholderChunk, "high"));
  }

  const relatedPartyChunk = sectionChunk(chunks, "certain relationships") ?? sectionChunk(chunks, "related party");
  if (relatedPartyChunk) {
    facts.push(makeFact("Related-party transactions section presence", "related_party", "Present", "The filing includes a related-party transactions section.", "Related-party disclosures can matter for governance and conflicts analysis.", relatedPartyChunk, "high"));
  }

  const debtChunk = findChunk(chunks, (chunk) => /\b(debt|liquidity|borrowings|credit facility|cash flow|cash flows)\b/i.test(chunk.text));
  if (debtChunk) {
    facts.push(makeFact("Debt/liquidity mention", "debt", excerpt(debtChunk.text, 450), "The parser found debt, liquidity, borrowing, or cash-flow language.", "This is a candidate source for future liquidity analysis and needs section-level review.", debtChunk, "medium", true));
  }

  const financialTableChunk = findChunk(chunks, (chunk) => /\b(revenue|net loss|net income|cash and cash equivalents|total assets)\b/i.test(chunk.text));
  if (financialTableChunk) {
    facts.push(makeFact("Financial table candidate", "financial", excerpt(financialTableChunk.text, 450), "The parser found financial-statement-like terms.", "This should be cross-checked against extracted table artifacts before presenting exact figures.", financialTableChunk, "low", true));
  }

  const existingIds = new Set<string>();
  return facts.map((fact, index) => {
    if (!existingIds.has(fact.id)) {
      existingIds.add(fact.id);
      return fact;
    }
    return { ...fact, id: `${fact.id}-${index}` };
  });
}
