import { z } from "zod";

export const confidenceSchema = z.enum(["high", "medium", "low"]);

export const filingDocumentSchema = z.object({
  id: z.string(),
  sequence: z.number(),
  type: z.string(),
  description: z.string(),
  filename: z.string(),
  sourceUrl: z.string().url(),
  localPath: z.string(),
  sizeBytes: z.number().optional(),
});

export const filingSectionSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  title: z.string(),
  normalizedTitle: z.string(),
  level: z.number(),
  order: z.number(),
  parentId: z.string().nullable(),
  text: z.string(),
  html: z.string(),
  sourceUrl: z.string().url(),
  sourceAnchor: z.string().optional(),
  startOffset: z.number().optional(),
  endOffset: z.number().optional(),
});

export const filingChunkSchema = z.object({
  id: z.string(),
  sectionId: z.string(),
  documentId: z.string(),
  chunkType: z.enum([
    "narrative",
    "table",
    "risk_factor",
    "financial_statement",
    "exhibit",
    "graphic_caption",
    "unknown",
  ]),
  title: z.string(),
  text: z.string(),
  tokenEstimate: z.number(),
  sourceUrl: z.string().url(),
  sourceAnchor: z.string().optional(),
  citationLabel: z.string(),
});

export const filingFactSchema = z.object({
  id: z.string(),
  category: z.enum([
    "business",
    "offering",
    "financial",
    "governance",
    "dilution",
    "proceeds",
    "risk",
    "related_party",
    "legal",
    "debt",
    "lockup",
    "exhibit",
    "unknown",
  ]),
  label: z.string(),
  valueText: z.string(),
  valueNumber: z.number().optional(),
  plainEnglish: z.string(),
  investorRelevance: z.string(),
  confidence: confidenceSchema,
  sourceChunkIds: z.array(z.string()).min(1),
  sourceQuote: z.string(),
  needsReview: z.boolean(),
});

export const riskFactorSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  originalText: z.string(),
  plainEnglish: z.string(),
  whyItMatters: z.string(),
  specificity: z.enum(["generic", "company_specific", "mixed"]),
  confidence: confidenceSchema,
  sourceSectionId: z.string(),
  sourceChunkIds: z.array(z.string()).min(1),
  sourceQuote: z.string(),
  characterLength: z.number(),
  extractionMethod: z.string(),
  riskExtractionType: z.enum(["full_text", "heading_only", "toc_entry", "fragment", "unknown"]),
  needsReview: z.boolean().optional(),
  extractionWarning: z.string().optional(),
});

export const extractionReportSchema = z.object({
  filingUrl: z.string().url(),
  generatedAt: z.string(),
  documentCount: z.number(),
  sectionCount: z.number(),
  chunkCount: z.number(),
  factCount: z.number(),
  riskFactorCount: z.number(),
  warnings: z.array(z.string()),
  errors: z.array(z.string()),
  goldenChecks: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        found: z.boolean(),
        matchedId: z.string().optional(),
        matchedType: z.enum(["section", "chunk"]).optional(),
        confidence: confidenceSchema,
        diagnostic: z.string(),
      }),
    )
    .optional(),
  coverage: z.object({
    hasProspectusSummary: z.boolean(),
    hasRiskFactors: z.boolean(),
    hasUseOfProceeds: z.boolean(),
    hasDilution: z.boolean(),
    hasCapitalization: z.boolean(),
    hasManagementDiscussion: z.boolean(),
    hasBusiness: z.boolean(),
    hasPrincipalStockholders: z.boolean(),
    hasRelatedPartyTransactions: z.boolean(),
    hasDescriptionOfCapitalStock: z.boolean(),
    hasUnderwriting: z.boolean(),
  }),
});

export const briefCitationSchema = z.object({
  chunkId: z.string(),
  sectionId: z.string().optional(),
  sourceUrl: z.string().url(),
  quote: z.string(),
});

export const briefItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  whyItMatters: z.string().optional(),
  confidence: confidenceSchema,
  needsReview: z.boolean(),
  citations: z.array(briefCitationSchema).min(1),
});

export const briefSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  items: z.array(briefItemSchema),
  warnings: z.array(z.string()),
});

export const retailInvestorBriefSchema = z.object({
  id: z.string(),
  title: z.string(),
  generatedAt: z.string(),
  filing: z.object({
    companyName: z.string().optional(),
    formType: z.string().optional(),
    accessionNumber: z.string().optional(),
    filingDate: z.string().optional(),
    sourceUrl: z.string().url(),
  }),
  disclaimer: z.string(),
  snapshot: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  sections: z.array(briefSectionSchema),
  diagnostics: z.object({
    generatedFactCount: z.number(),
    reviewedFactCount: z.number(),
    generatedRiskCount: z.number(),
    reviewedRiskCount: z.number(),
    fullTextRiskCount: z.number(),
    excludedSuspiciousRiskCount: z.number(),
    evidenceCardCount: z.number().optional(),
    highConfidenceEvidenceCardCount: z.number().optional(),
    rejectedWeakCandidateCount: z.number().optional(),
    actualFinancialValueCount: z.number().optional(),
    riskThemesSelected: z.number().optional(),
    warnings: z.array(z.string()),
  }),
});

export const evidenceCardSchema = z.object({
  id: z.string(),
  topic: z.enum(["business", "offering", "financial", "proceeds", "dilution", "governance", "related_party", "debt", "lockup", "risk"]),
  title: z.string(),
  sourceSectionId: z.string(),
  sourceChunkIds: z.array(z.string()).min(1),
  sourceQuote: z.string(),
  extractedText: z.string(),
  plainEnglish: z.string(),
  whyItMatters: z.string(),
  confidence: confidenceSchema,
  needsReview: z.boolean(),
  extractionMethod: z.string(),
  qualityWarnings: z.array(z.string()),
});

export type FilingDocument = z.infer<typeof filingDocumentSchema>;
export type FilingSection = z.infer<typeof filingSectionSchema>;
export type FilingChunk = z.infer<typeof filingChunkSchema>;
export type FilingFact = z.infer<typeof filingFactSchema>;
export type RiskFactor = z.infer<typeof riskFactorSchema>;
export type ExtractionReport = z.infer<typeof extractionReportSchema>;
export type BriefCitation = z.infer<typeof briefCitationSchema>;
export type BriefItem = z.infer<typeof briefItemSchema>;
export type BriefSection = z.infer<typeof briefSectionSchema>;
export type RetailInvestorBrief = z.infer<typeof retailInvestorBriefSchema>;
export type EvidenceCard = z.infer<typeof evidenceCardSchema>;
