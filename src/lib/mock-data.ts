import type {
  ExtractionReport,
  FilingChunk,
  FilingDocument,
  FilingFact,
  FilingSection,
  RetailInvestorBrief,
  RiskFactor,
} from "./types";
import type { DiagnosticsData, FilingData, FilingTable, MockState } from "./filing-data.types";

// ---------------------------------------------------------------------------
// Mock fixtures. These conform to the same types as the generated artifacts so
// the UI can be built without depending on (or bundling) the real 28 MB data.
// Records intentionally span confidence levels and needsReview to exercise the
// low-confidence / review-needed UI paths. SpaceX-flavored but illustrative.
// ---------------------------------------------------------------------------

const FILING_URL =
  "https://www.sec.gov/Archives/edgar/data/1181412/000162828026036936/spaceexplorationtechnologi.htm";
const GENERATED_AT = "2026-06-01T12:00:00.000Z";

const documents: FilingDocument[] = [
  {
    id: "doc-main",
    sequence: 1,
    type: "S-1",
    description: "Form S-1 Registration Statement",
    filename: "spaceexplorationtechnologi.htm",
    sourceUrl: FILING_URL,
    localPath: "raw/spaceexplorationtechnologi.htm",
    sizeBytes: 4_812_004,
  },
  {
    id: "doc-index",
    sequence: 2,
    type: "index",
    description: "Filing index",
    filename: "0001628280-26-036936-index.htm",
    sourceUrl:
      "https://www.sec.gov/Archives/edgar/data/1181412/000162828026036936/0001628280-26-036936-index.htm",
    localPath: "raw/0001628280-26-036936-index.htm",
    sizeBytes: 12_004,
  },
];

const sections: FilingSection[] = [
  {
    id: "sec-summary",
    documentId: "doc-main",
    title: "Prospectus Summary",
    normalizedTitle: "prospectus summary",
    level: 1,
    order: 1,
    parentId: null,
    text: "This summary highlights selected information about Space Exploration Technologies Corp. and this offering. It does not contain all of the information you should consider before investing in our common stock.",
    html: "<p>This summary highlights selected information…</p>",
    sourceUrl: FILING_URL,
  },
  {
    id: "sec-risk",
    documentId: "doc-main",
    title: "Risk Factors",
    normalizedTitle: "risk factors",
    level: 1,
    order: 2,
    parentId: null,
    text: "Investing in our common stock involves a high degree of risk. You should carefully consider the risks described below.",
    html: "<p>Investing in our common stock involves a high degree of risk…</p>",
    sourceUrl: FILING_URL,
  },
  {
    id: "sec-proceeds",
    documentId: "doc-main",
    title: "Use of Proceeds",
    normalizedTitle: "use of proceeds",
    level: 1,
    order: 3,
    parentId: null,
    text: "We intend to use the net proceeds from this offering for working capital and other general corporate purposes, including continued development of Starship and Starlink.",
    html: "<p>We intend to use the net proceeds…</p>",
    sourceUrl: FILING_URL,
  },
  {
    id: "sec-mdna",
    documentId: "doc-main",
    title: "Management's Discussion and Analysis",
    normalizedTitle: "managements discussion and analysis",
    level: 1,
    order: 4,
    parentId: null,
    text: "The following discussion of our financial condition and results of operations should be read together with our consolidated financial statements and the related notes.",
    html: "<p>The following discussion…</p>",
    sourceUrl: FILING_URL,
  },
];

const chunks: FilingChunk[] = [
  {
    id: "chunk-summary-1",
    sectionId: "sec-summary",
    documentId: "doc-main",
    chunkType: "narrative",
    title: "Prospectus Summary",
    text: "We design, manufacture, and launch advanced rockets and spacecraft, and operate the Starlink satellite-based connectivity network. This is a preliminary prospectus and the offering terms are not yet final.",
    tokenEstimate: 48,
    sourceUrl: FILING_URL,
    citationLabel: "Prospectus Summary, ¶1",
  },
  {
    id: "chunk-summary-2",
    sectionId: "sec-summary",
    documentId: "doc-main",
    chunkType: "narrative",
    title: "Prospectus Summary — Corporate structure",
    text: "Following this offering, our founder will continue to control a majority of the combined voting power of our outstanding capital stock through high-vote Class B common stock.",
    tokenEstimate: 41,
    sourceUrl: FILING_URL,
    citationLabel: "Prospectus Summary, ¶6",
  },
  {
    id: "chunk-risk-1",
    sectionId: "sec-risk",
    documentId: "doc-main",
    chunkType: "risk_factor",
    title: "Risk Factors — Launch operations",
    text: "Launch failures, vehicle anomalies, or loss of a mission could result in significant losses, reputational harm, and delays that could materially and adversely affect our business and operating results.",
    tokenEstimate: 44,
    sourceUrl: FILING_URL,
    citationLabel: "Risk Factors, Launch operations",
  },
  {
    id: "chunk-risk-2",
    sectionId: "sec-risk",
    documentId: "doc-main",
    chunkType: "risk_factor",
    title: "Risk Factors — Regulatory",
    text: "We are subject to extensive government regulation, including licensing by the FAA and FCC. Failure or delay in obtaining or maintaining required licenses could limit or prohibit our operations.",
    tokenEstimate: 42,
    sourceUrl: FILING_URL,
    citationLabel: "Risk Factors, Regulatory",
  },
  {
    id: "chunk-proceeds-1",
    sectionId: "sec-proceeds",
    documentId: "doc-main",
    chunkType: "narrative",
    title: "Use of Proceeds",
    text: "We currently intend to use the net proceeds for working capital and general corporate purposes, including continued development of Starship and expansion of the Starlink constellation.",
    tokenEstimate: 38,
    sourceUrl: FILING_URL,
    citationLabel: "Use of Proceeds, ¶1",
  },
  {
    id: "chunk-mdna-1",
    sectionId: "sec-mdna",
    documentId: "doc-main",
    chunkType: "narrative",
    title: "MD&A — Overview",
    text: "Our revenue is derived primarily from launch services and Starlink subscriptions. We have incurred significant capital expenditures to develop our launch vehicles and satellite network.",
    tokenEstimate: 40,
    sourceUrl: FILING_URL,
    citationLabel: "MD&A, Overview",
  },
];

const facts: FilingFact[] = [
  {
    id: "fact-offering-status",
    category: "offering",
    label: "Offering status",
    valueText: "Preliminary — number of shares and price range not yet disclosed",
    plainEnglish:
      "The filing is a preliminary prospectus; the share count and price range are not set yet.",
    investorRelevance: "Offering size and dilution cannot be assessed until terms are filed.",
    confidence: "high",
    sourceChunkIds: ["chunk-summary-1"],
    sourceQuote: "This is a preliminary prospectus and the offering terms are not yet final.",
    needsReview: false,
  },
  {
    id: "fact-dual-class",
    category: "governance",
    label: "Voting control",
    valueText: "Founder retains majority voting power via Class B high-vote stock",
    plainEnglish:
      "After the IPO, the founder still controls most of the votes through a dual-class structure.",
    investorRelevance:
      "Public investors will have limited influence over corporate decisions.",
    confidence: "high",
    sourceChunkIds: ["chunk-summary-2"],
    sourceQuote:
      "our founder will continue to control a majority of the combined voting power",
    needsReview: false,
  },
  {
    id: "fact-use-of-proceeds",
    category: "proceeds",
    label: "Use of proceeds",
    valueText: "Working capital and general corporate purposes; Starship and Starlink",
    plainEnglish:
      "The company plans to use the money for general operations and building Starship and Starlink.",
    investorRelevance:
      "No specific allocation is given, which is common but limits visibility into spending.",
    confidence: "medium",
    sourceChunkIds: ["chunk-proceeds-1"],
    sourceQuote:
      "use the net proceeds for working capital and general corporate purposes",
    needsReview: false,
  },
  {
    id: "fact-revenue-mix",
    category: "financial",
    label: "Primary revenue sources",
    valueText: "Launch services and Starlink subscriptions",
    plainEnglish: "Most revenue comes from launches and Starlink subscriptions.",
    investorRelevance:
      "Concentration in two segments; exact figures not extracted from this excerpt.",
    confidence: "low",
    sourceChunkIds: ["chunk-mdna-1"],
    sourceQuote: "revenue is derived primarily from launch services and Starlink subscriptions",
    needsReview: true,
  },
  {
    id: "fact-capex",
    category: "financial",
    label: "Capital intensity",
    valueText: "Significant capital expenditures on vehicles and satellite network",
    plainEnglish: "The business requires heavy ongoing investment in hardware.",
    investorRelevance: "High capex can pressure cash flow and may require future financing.",
    confidence: "medium",
    sourceChunkIds: ["chunk-mdna-1"],
    sourceQuote: "significant capital expenditures to develop our launch vehicles and satellite network",
    needsReview: false,
  },
];

function risk(
  partial: Omit<RiskFactor, "characterLength"> & { characterLength?: number },
): RiskFactor {
  return { ...partial, characterLength: partial.characterLength ?? partial.originalText.length };
}

const risks: RiskFactor[] = [
  risk({
    id: "risk-launch",
    title: "Launch failures could materially harm our business",
    category: "launch/space operations",
    originalText:
      "Launch failures, vehicle anomalies, or loss of a mission could result in significant losses, reputational harm, and delays that could materially and adversely affect our business and operating results.",
    plainEnglish:
      "If a launch fails or a mission is lost, the company could face large costs, reputational damage, and schedule delays.",
    whyItMatters:
      "Launch reliability is core to both revenue and customer trust; a single high-profile failure can ripple across the manifest.",
    specificity: "company_specific",
    confidence: "medium",
    sourceSectionId: "sec-risk",
    sourceChunkIds: ["chunk-risk-1"],
    sourceQuote: "Launch failures, vehicle anomalies, or loss of a mission could result in significant losses",
    extractionMethod: "risk-splitter-v2",
    riskExtractionType: "full_text",
    needsReview: false,
  }),
  risk({
    id: "risk-regulatory",
    title: "Extensive government regulation and licensing dependence",
    category: "government/regulatory",
    originalText:
      "We are subject to extensive government regulation, including licensing by the FAA and FCC. Failure or delay in obtaining or maintaining required licenses could limit or prohibit our operations.",
    plainEnglish:
      "The company needs FAA and FCC licenses; losing or being delayed on them could restrict or stop operations.",
    whyItMatters:
      "Regulatory approvals gate launch cadence and spectrum use, so delays can directly cap growth.",
    specificity: "company_specific",
    confidence: "high",
    sourceSectionId: "sec-risk",
    sourceChunkIds: ["chunk-risk-2"],
    sourceQuote: "subject to extensive government regulation, including licensing by the FAA and FCC",
    extractionMethod: "risk-splitter-v2",
    riskExtractionType: "full_text",
    needsReview: false,
  }),
  risk({
    id: "risk-competition",
    title: "We face competition",
    category: "competition",
    originalText:
      "We operate in competitive markets and may face increased competition that could adversely affect our business, financial condition, and results of operations.",
    plainEnglish: "Competition could hurt the business — stated in general terms.",
    whyItMatters: "Generic competition language offers little company-specific signal.",
    specificity: "generic",
    confidence: "low",
    sourceSectionId: "sec-risk",
    sourceChunkIds: ["chunk-risk-1"],
    sourceQuote: "may face increased competition that could adversely affect our business",
    extractionMethod: "risk-splitter-v2",
    riskExtractionType: "fragment",
    needsReview: false,
  }),
  risk({
    id: "risk-dilution",
    title: "Risks Related to Ownership",
    category: "dilution/share structure",
    originalText:
      "Risks Related to Ownership of Our Common Stock and This Offering.",
    plainEnglish: "Heading-only fragment captured by the splitter; body text is missing.",
    whyItMatters: "Flagged for review because it looks like a section heading, not a full risk.",
    specificity: "mixed",
    confidence: "low",
    sourceSectionId: "sec-risk",
    sourceChunkIds: ["chunk-risk-2"],
    sourceQuote: "Risks Related to Ownership of Our Common Stock and This Offering.",
    extractionMethod: "risk-splitter-v2",
    riskExtractionType: "heading_only",
    needsReview: true,
    extractionWarning: "Title looks like a section heading instead of an individual risk.",
  }),
];

const tables: FilingTable[] = [
  {
    id: "table-1",
    order: 1,
    text: "Capitalization as of March 31, 2026 ... Total stockholders' equity ...",
    html: "<table><tr><td>Total stockholders' equity</td><td>—</td></tr></table>",
    sourceUrl: FILING_URL,
  },
  {
    id: "table-2",
    order: 2,
    text: "Selected quarterly data (unassociated with a parsed section)",
    html: "<table><tr><td>Q1</td><td>—</td></tr></table>",
    sourceUrl: FILING_URL,
  },
];

const coverageAllTrue: ExtractionReport["coverage"] = {
  hasProspectusSummary: true,
  hasRiskFactors: true,
  hasUseOfProceeds: true,
  hasDilution: true,
  hasCapitalization: true,
  hasManagementDiscussion: true,
  hasBusiness: true,
  hasPrincipalStockholders: true,
  hasRelatedPartyTransactions: true,
  hasDescriptionOfCapitalStock: true,
  hasUnderwriting: true,
};

const coverageAllFalse: ExtractionReport["coverage"] = {
  hasProspectusSummary: false,
  hasRiskFactors: false,
  hasUseOfProceeds: false,
  hasDilution: false,
  hasCapitalization: false,
  hasManagementDiscussion: false,
  hasBusiness: false,
  hasPrincipalStockholders: false,
  hasRelatedPartyTransactions: false,
  hasDescriptionOfCapitalStock: false,
  hasUnderwriting: false,
};

const report: ExtractionReport = {
  filingUrl: FILING_URL,
  generatedAt: GENERATED_AT,
  documentCount: documents.length,
  sectionCount: sections.length,
  chunkCount: chunks.length,
  factCount: facts.length,
  riskFactorCount: risks.length,
  warnings: [
    "Mock dataset — not generated from the live filing.",
    "Some extracted tables are not associated with sections.",
  ],
  errors: [],
  goldenChecks: [
    { id: "gc-summary", label: "Prospectus Summary", found: true, matchedId: "sec-summary", matchedType: "section", confidence: "high", diagnostic: "Matched section title." },
    { id: "gc-risk", label: "Risk Factors", found: true, matchedId: "sec-risk", matchedType: "section", confidence: "high", diagnostic: "Matched section title." },
    { id: "gc-dilution", label: "Dilution", found: false, confidence: "low", diagnostic: "No dilution section detected in mock data." },
  ],
  coverage: coverageAllTrue,
};

const diagnostics: DiagnosticsData = {
  missingExpectedSections: [
    { id: "gc-dilution", label: "Dilution", diagnostic: "No dilution section detected in mock data." },
  ],
  factsMissingReview: [{ id: "fact-revenue-mix", label: "Primary revenue sources", category: "financial" }],
  suspiciousRiskFactors: [
    { id: "risk-dilution", title: "Risks Related to Ownership", warning: "Title looks like a section heading instead of an individual risk." },
  ],
  tableExtractionSummary: { count: tables.length, associatedWithSections: 1, unassociated: 1 },
};

const brief: RetailInvestorBrief = {
  id: "brief-spacex-mock",
  title: "SpaceX S-1 — Plain-English Brief (Mock)",
  generatedAt: GENERATED_AT,
  filing: {
    companyName: "Space Exploration Technologies Corp.",
    formType: "S-1",
    accessionNumber: "0001628280-26-036936",
    filingDate: "2026-05-20",
    sourceUrl: FILING_URL,
  },
  disclaimer:
    "This brief summarizes disclosures in the filing. It is not investment advice and contains no recommendation, score, or price target.",
  snapshot: {
    offeringStatus: "Preliminary — terms not yet set",
    votingControl: "Founder-controlled (dual-class)",
    primaryRevenue: "Launch services + Starlink",
    riskFactorsExtracted: risks.length,
    termsDisclosed: false,
  },
  sections: [
    {
      id: "brief-business",
      title: "Business & Offering",
      summary: "What the company does and the current state of the offering.",
      warnings: [],
      items: [
        {
          id: "brief-item-offering",
          title: "The offering terms are not set yet",
          body: "This is a preliminary prospectus; share count and price range are not disclosed.",
          whyItMatters: "You cannot evaluate valuation or dilution until terms are filed.",
          confidence: "high",
          needsReview: false,
          citations: [
            {
              chunkId: "chunk-summary-1",
              sectionId: "sec-summary",
              sourceUrl: FILING_URL,
              quote: "This is a preliminary prospectus and the offering terms are not yet final.",
            },
          ],
        },
        {
          id: "brief-item-control",
          title: "Founder keeps voting control",
          body: "A dual-class structure leaves the founder with majority voting power after the IPO.",
          whyItMatters: "Public shareholders will have limited say in governance.",
          confidence: "high",
          needsReview: false,
          citations: [
            {
              chunkId: "chunk-summary-2",
              sectionId: "sec-summary",
              sourceUrl: FILING_URL,
              quote: "our founder will continue to control a majority of the combined voting power",
            },
          ],
        },
      ],
    },
    {
      id: "brief-risks",
      title: "Key Risks",
      summary: "Selected, source-cited risk disclosures.",
      warnings: ["One extracted risk was a heading-only fragment and is excluded pending review."],
      items: [
        {
          id: "brief-item-launch",
          title: "Launch reliability is a core risk",
          body: "Launch failures or lost missions could cause significant losses, reputational harm, and delays.",
          whyItMatters: "Reliability underpins both revenue and customer trust.",
          confidence: "medium",
          needsReview: false,
          citations: [
            {
              chunkId: "chunk-risk-1",
              sectionId: "sec-risk",
              sourceUrl: FILING_URL,
              quote: "Launch failures, vehicle anomalies, or loss of a mission could result in significant losses",
            },
          ],
        },
      ],
    },
  ],
  diagnostics: {
    generatedFactCount: facts.length,
    reviewedFactCount: 0,
    generatedRiskCount: risks.length,
    reviewedRiskCount: 0,
    fullTextRiskCount: 2,
    excludedSuspiciousRiskCount: 1,
    warnings: ["Mock brief — illustrative content only."],
  },
};

const successData: FilingData = {
  brief,
  chunks,
  diagnostics,
  documents,
  facts,
  report,
  risks,
  sections,
  tables,
};

const emptyBrief: RetailInvestorBrief = {
  ...brief,
  title: "SpaceX S-1 — Brief unavailable (Mock empty state)",
  snapshot: { offeringStatus: "unknown", termsDisclosed: null },
  sections: [],
  diagnostics: { ...brief.diagnostics, generatedFactCount: 0, generatedRiskCount: 0, fullTextRiskCount: 0, excludedSuspiciousRiskCount: 0 },
};

const emptyDiagnostics: DiagnosticsData = {
  missingExpectedSections: [],
  factsMissingReview: [],
  suspiciousRiskFactors: [],
  tableExtractionSummary: { count: 0, associatedWithSections: 0, unassociated: 0 },
};

const emptyData: FilingData = {
  brief: emptyBrief,
  chunks: [],
  diagnostics: emptyDiagnostics,
  documents,
  facts: [],
  report: {
    ...report,
    documentCount: documents.length,
    sectionCount: 0,
    chunkCount: 0,
    factCount: 0,
    riskFactorCount: 0,
    warnings: ["No sections were extracted from the main S-1 HTML."],
    errors: [],
    goldenChecks: [],
    coverage: coverageAllFalse,
  },
  risks: [],
  sections: [],
  tables: [],
};

const errorData: FilingData = {
  ...emptyData,
  brief: { ...emptyBrief, title: "SpaceX S-1 — Brief unavailable (Mock error state)" },
  report: {
    ...emptyData.report,
    warnings: [],
    errors: ["Could not identify main S-1 document from filing index."],
  },
};

const BY_STATE: Record<MockState, FilingData> = {
  success: successData,
  empty: emptyData,
  error: errorData,
};

/** Returns the mock dataset for a given state (defaults to the success path). */
export function makeMockFilingData(state: MockState = "success"): FilingData {
  return BY_STATE[state] ?? successData;
}

export const mockFilingData = successData;
