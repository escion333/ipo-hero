import path from "node:path";
import { GENERATED_DIR, readJsonFile } from "../lib/artifacts";
import {
  extractionReportSchema,
  filingChunkSchema,
  filingDocumentSchema,
  filingFactSchema,
  filingSectionSchema,
  riskFactorSchema,
} from "../lib/schema";
import { normalizeTitle, normalizeWhitespace } from "../lib/normalize";

export type ValidationResult = {
  errors: string[];
  warnings: string[];
};

async function readRequiredJson<T>(filename: string, errors: string[]): Promise<T | undefined> {
  const filePath = path.join(GENERATED_DIR, filename);
  try {
    const data = await readJsonFile<T>(filePath);
    if (data === undefined) errors.push(`Missing required generated artifact: ${filename}`);
    return data;
  } catch (error) {
    errors.push(`Malformed generated artifact ${filename}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function duplicateIds(items: Array<{ id: string }>): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) dupes.add(item.id);
    seen.add(item.id);
  }
  return [...dupes];
}

function concentrationWarnings(categories: string[]): string[] {
  const counts = categories.reduce<Record<string, number>>((acc, category) => {
    acc[category] = (acc[category] ?? 0) + 1;
    return acc;
  }, {});
  const active = Object.keys(counts).length;
  if (active <= 2 && categories.length >= 10) return [`Facts are concentrated in only ${active} categories.`];
  return [];
}

function hasRiskFactorsSection(sections: Array<{ normalizedTitle: string }>): boolean {
  return sections.some((section) => section.normalizedTitle.includes("risk factors"));
}

export async function validateGeneratedData(): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const documents = await readRequiredJson<unknown[]>("documents.json", errors);
  const sections = await readRequiredJson<unknown[]>("sections.json", errors);
  const chunks = await readRequiredJson<unknown[]>("chunks.json", errors);
  const facts = await readRequiredJson<unknown[]>("facts.json", errors);
  const risks = await readRequiredJson<unknown[]>("risks.json", errors);
  const riskAudit = await readRequiredJson<Record<string, unknown>>("risk-audit.json", errors);
  const report = await readRequiredJson<unknown>("extraction-report.json", errors);
  const manifest = await readRequiredJson<unknown>("manifest.json", errors);
  const diagnostics = await readRequiredJson<Record<string, unknown>>("diagnostics.json", errors);
  const snapshot = await readRequiredJson<unknown>("extraction-snapshot.json", errors);

  if (errors.length) return { errors, warnings };

  const parsedDocuments = filingDocumentSchema.array().safeParse(documents);
  const parsedSections = filingSectionSchema.array().safeParse(sections);
  const parsedChunks = filingChunkSchema.array().safeParse(chunks);
  const parsedFacts = filingFactSchema.array().safeParse(facts);
  const parsedRisks = riskFactorSchema.array().safeParse(risks);
  const parsedReport = extractionReportSchema.safeParse(report);

  for (const [label, result] of [
    ["documents", parsedDocuments],
    ["sections", parsedSections],
    ["chunks", parsedChunks],
    ["facts", parsedFacts],
    ["risks", parsedRisks],
    ["report", parsedReport],
  ] as const) {
    if (!result.success) errors.push(`${label} schema failed: ${result.error.message}`);
  }
  if (!manifest) errors.push("Missing manifest artifact.");
  if (!diagnostics) errors.push("Missing diagnostics artifact.");
  if (!snapshot) errors.push("Missing extraction snapshot artifact.");
  if (!riskAudit) errors.push("Missing risk audit artifact.");

  if (!parsedDocuments.success || !parsedSections.success || !parsedChunks.success || !parsedFacts.success || !parsedRisks.success || !parsedReport.success) {
    return { errors, warnings };
  }

  const docs = parsedDocuments.data;
  const secs = parsedSections.data;
  const chs = parsedChunks.data;
  const fts = parsedFacts.data;
  const rks = parsedRisks.data;
  const rpt = parsedReport.data;
  const chunksById = new Map(chs.map((chunk) => [chunk.id, chunk]));
  const sectionsById = new Map(secs.map((section) => [section.id, section]));

  if (!docs.some((document) => /^s-?1$/i.test(document.type))) errors.push("No main S-1 was found.");
  if (secs.length === 0) errors.push("Zero sections were extracted.");
  if (chs.length === 0) errors.push("Zero chunks were extracted.");
  if (!hasRiskFactorsSection(secs)) errors.push("No Risk Factors section was detected.");
  if (docs.some((document) => !document.sourceUrl) || secs.some((section) => !section.sourceUrl) || chs.some((chunk) => !chunk.sourceUrl)) errors.push("One or more source URLs are missing.");
  if (fts.some((fact) => fact.sourceChunkIds.length === 0)) errors.push("Generated facts have no source references.");
  if (rks.some((risk) => risk.sourceChunkIds.length === 0)) errors.push("Generated risk factors have no source references.");
  if (chs.some((chunk) => chunk.text.trim().length === 0)) errors.push("One or more chunks have empty text.");

  for (const [label, items] of [
    ["documents", docs],
    ["sections", secs],
    ["chunks", chs],
    ["facts", fts],
    ["risks", rks],
  ] as const) {
    const dupes = duplicateIds(items);
    if (dupes.length) errors.push(`Duplicate ${label} IDs: ${dupes.join(", ")}`);
  }

  for (const fact of fts) {
    for (const sourceChunkId of fact.sourceChunkIds) {
      const chunk = chunksById.get(sourceChunkId);
      if (!chunk) {
        errors.push(`Fact ${fact.id} references missing chunk ${sourceChunkId}.`);
        continue;
      }
      const quote = normalizeWhitespace(fact.sourceQuote);
      if (quote && !normalizeWhitespace(chunk.text).includes(quote)) {
        errors.push(`Fact ${fact.id} sourceQuote was not found in referenced chunk ${sourceChunkId}.`);
      }
    }
  }

  for (const risk of rks) {
    if (!risk.sourceSectionId || !sectionsById.has(risk.sourceSectionId)) warnings.push(`Risk ${risk.id} has weak source section provenance.`);
    if (!risk.sourceQuote) warnings.push(`Risk ${risk.id} has weak source quote provenance.`);
    for (const sourceChunkId of risk.sourceChunkIds) {
      const chunk = chunksById.get(sourceChunkId);
      if (!chunk) {
        errors.push(`Risk ${risk.id} references missing chunk ${sourceChunkId}.`);
        continue;
      }
      if (risk.sourceQuote && !normalizeWhitespace(chunk.text).includes(normalizeWhitespace(risk.sourceQuote))) {
        warnings.push(`Risk ${risk.id} sourceQuote was not found in referenced chunk ${sourceChunkId}.`);
      }
    }
  }

  if (rpt.errors.length > 0) errors.push(`Extraction report contains fatal errors: ${rpt.errors.join("; ")}`);
  if (fts.some((fact) => /\b(buy|sell|hold)\b|recommendation|investment advice|score/i.test(`${fact.plainEnglish} ${fact.investorRelevance}`))) {
    errors.push("Generated facts include prohibited advice-like language.");
  }

  const missingGolden = rpt.goldenChecks?.filter((check) => !check.found) ?? [];
  if (missingGolden.length > 0) warnings.push(`Missing expected S-1 checks: ${missingGolden.map((check) => check.label).join(", ")}.`);
  if (secs.length < 50) warnings.push(`Only ${secs.length} sections were detected; this may be low for a large S-1.`);
  if (fts.length < 25) warnings.push(`Only ${fts.length} facts were extracted; deterministic fact coverage is probably sparse.`);
  const riskTypeCounts = rks.reduce<Record<string, number>>((acc, risk) => {
    acc[risk.riskExtractionType] = (acc[risk.riskExtractionType] ?? 0) + 1;
    return acc;
  }, {});
  const fullTextRisks = riskTypeCounts.full_text ?? 0;
  const suspiciousRiskRecords = rks.length - fullTextRisks;
  if (fullTextRisks < 40 || fullTextRisks > 220) warnings.push(`${fullTextRisks} full-text risk factors were extracted from ${rks.length} total risk records; inspect risk-audit.json.`);
  if (suspiciousRiskRecords > 0) warnings.push(`${suspiciousRiskRecords} risk records are fragments, headings, TOC entries, or unknown type.`);
  const lowConfidenceSections = secs.filter((section) => section.text.length < 80 || section.title.length < 3);
  if (lowConfidenceSections.length > 10) warnings.push(`${lowConfidenceSections.length} low-confidence or very short sections detected.`);
  const untitledLargeChunks = chs.filter((chunk) => (!chunk.title || normalizeTitle(chunk.title) === "untitled") && chunk.text.length > 2500);
  if (untitledLargeChunks.length) warnings.push(`${untitledLargeChunks.length} large chunks have no useful section title.`);
  if (diagnostics && typeof diagnostics === "object") {
    const tableSummary = diagnostics.tableExtractionSummary as { unassociated?: number } | undefined;
    if ((tableSummary?.unassociated ?? 0) > 0) warnings.push(`${tableSummary?.unassociated} extracted tables are not associated with sections.`);
  }
  warnings.push(...concentrationWarnings(fts.map((fact) => fact.category)));
  const shortRisks = rks.filter((risk) => risk.characterLength < 500);
  if (shortRisks.length) warnings.push(`${shortRisks.length} risk records are below the minimum source-text review threshold.`);
  const titleCounts = rks.reduce<Record<string, number>>((acc, risk) => {
    const key = normalizeTitle(risk.title).slice(0, 90);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const duplicateRiskTitles = Object.values(titleCounts).filter((count) => count > 1).length;
  if (duplicateRiskTitles) warnings.push(`${duplicateRiskTitles} duplicate or near-duplicate risk factor titles detected.`);
  for (const warning of rpt.warnings) warnings.push(`Report: ${warning}`);

  return { errors, warnings: [...new Set(warnings)] };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  validateGeneratedData()
    .then((result) => {
      for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
      if (result.errors.length) {
        console.error("Data validation failed:");
        for (const error of result.errors) console.error(`- ${error}`);
        process.exit(1);
      }
      console.log("Data validation passed.");
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
