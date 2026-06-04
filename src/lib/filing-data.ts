import brief from "../data/generated/brief.v1.generated.json";
import chunks from "../data/generated/chunks.json";
import diagnostics from "../data/generated/diagnostics.json";
import documents from "../data/generated/documents.json";
import facts from "../data/generated/facts.json";
import report from "../data/generated/extraction-report.json";
import risks from "../data/generated/risks.json";
import sections from "../data/generated/sections.json";
import tables from "../data/generated/tables.json";
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
import { makeMockFilingData } from "./mock-data";

const realFilingData: FilingData = {
  brief: brief as RetailInvestorBrief,
  chunks: chunks as FilingChunk[],
  diagnostics: diagnostics as DiagnosticsData,
  documents: documents as FilingDocument[],
  facts: facts as FilingFact[],
  report: report as ExtractionReport,
  risks: risks as RiskFactor[],
  sections: sections as FilingSection[],
  tables: tables as FilingTable[],
};

// Set VITE_USE_MOCK=true (e.g. `npm run dev:mock`) to build the UI against mock
// fixtures instead of the generated artifacts. VITE_MOCK_STATE picks the variant.
const useMock =
  import.meta.env.VITE_USE_MOCK === "true" || import.meta.env.VITE_USE_MOCK === "1";
const mockState: MockState = import.meta.env.VITE_MOCK_STATE ?? "success";

export const filingData: FilingData = useMock ? makeMockFilingData(mockState) : realFilingData;
