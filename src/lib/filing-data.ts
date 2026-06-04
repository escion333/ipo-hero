import brief from "../data/generated/brief.generated.json";
import chunks from "../data/generated/chunks.json";
import diagnostics from "../data/generated/diagnostics.json";
import documents from "../data/generated/documents.json";
import facts from "../data/generated/facts.json";
import report from "../data/generated/extraction-report.json";
import risks from "../data/generated/risks.json";
import sections from "../data/generated/sections.json";
import tables from "../data/generated/tables.json";
import type { ExtractionReport, FilingChunk, FilingDocument, FilingFact, FilingSection, RetailInvestorBrief, RiskFactor } from "./types";

type DiagnosticsData = {
  missingExpectedSections: Array<{ id: string; label: string; diagnostic: string }>;
  factsMissingReview: Array<{ id: string; label: string; category: string }>;
  suspiciousRiskFactors: Array<{ id: string; title: string; warning: string }>;
  tableExtractionSummary: { count: number; associatedWithSections: number; unassociated: number };
};

export const filingData = {
  brief: brief as RetailInvestorBrief,
  chunks: chunks as FilingChunk[],
  diagnostics: diagnostics as DiagnosticsData,
  documents: documents as FilingDocument[],
  facts: facts as FilingFact[],
  report: report as ExtractionReport,
  risks: risks as RiskFactor[],
  sections: sections as FilingSection[],
  tables: tables as Array<{ id: string; order: number; text: string; html: string; sourceUrl: string }>,
};
