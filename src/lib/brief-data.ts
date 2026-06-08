import brief from "../data/generated/brief.v1.generated.json";
import type { RetailInvestorBrief } from "./types";

// Reader-facing data only. Keep this separate from filing-data.ts so the public
// brief does not eagerly bundle reviewer-only sections, tables, risks, and chunks.
export const briefData = brief as RetailInvestorBrief;
