import type {
  ExtractionReport,
  FilingChunk,
  FilingDocument,
  FilingFact,
  FilingSection,
  RetailInvestorBrief,
  RiskFactor,
} from "./types";

/** Shape of diagnostics.json as consumed by the app (subset of the full file). */
export type DiagnosticsData = {
  missingExpectedSections: Array<{ id: string; label: string; diagnostic: string }>;
  factsMissingReview: Array<{ id: string; label: string; category: string }>;
  suspiciousRiskFactors: Array<{ id: string; title: string; warning: string }>;
  tableExtractionSummary: { count: number; associatedWithSections: number; unassociated: number };
};

export type FilingTable = {
  id: string;
  order: number;
  text: string;
  html: string;
  sourceUrl: string;
};

/** The single object the entire UI reads from (real artifacts or mock fixtures). */
export type FilingData = {
  brief: RetailInvestorBrief;
  chunks: FilingChunk[];
  diagnostics: DiagnosticsData;
  documents: FilingDocument[];
  facts: FilingFact[];
  report: ExtractionReport;
  risks: RiskFactor[];
  sections: FilingSection[];
  tables: FilingTable[];
};

/** Mock dataset variants, selectable via VITE_MOCK_STATE for state testing. */
export type MockState = "success" | "empty" | "error";
