import path from "node:path";
import { chunkSections } from "./chunk-sections";
import { extractFacts } from "./extract-facts";
import { extractRisks } from "./extract-risks";
import { runGoldenChecks } from "./golden-checks";
import { findMainS1Document, parseFilingIndex } from "./parse-index";
import { validateGeneratedData } from "./validate-output";
import {
  ensureReviewedFiles,
  fileExists,
  GENERATED_DIR,
  hashFile,
  mergeReviewed,
  PARSER_VERSIONS,
  readJsonFile,
  sha256Text,
  writeJsonFile,
  REVIEWED_DIR,
} from "../lib/artifacts";
import { extractTables, parseS1Sections } from "../lib/html";
import { fetchWithCache, localRawPath, TARGETS } from "../lib/sec";
import type { ExtractionReport, FilingChunk, FilingDocument, FilingFact, RiskFactor } from "../lib/schema";
import { normalizeTitle, normalizeWhitespace, stableId } from "../lib/normalize";

function hasSection(sections: Array<{ normalizedTitle: string }>, needles: string[]): boolean {
  return sections.some((section) => needles.some((needle) => section.normalizedTitle.includes(normalizeTitle(needle))));
}

const principalStockholderAliases = [
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

type Snapshot = {
  generatedAt: string;
  counts: {
    documents: number;
    sections: number;
    chunks: number;
    risks: number;
    facts: number;
    tables: number;
  };
  coverage: ExtractionReport["coverage"];
};

function pctChange(previous: number, current: number): number {
  if (previous === 0) return current === 0 ? 0 : 1;
  return Math.abs(current - previous) / previous;
}

function compareSnapshot(previous: Snapshot | undefined, current: Snapshot): string[] {
  if (!previous) return ["No previous extraction snapshot found; current run is the baseline."];
  const warnings: string[] = [];
  for (const [label, threshold] of [
    ["sections", 0.25],
    ["chunks", 0.25],
    ["risks", 0.3],
    ["tables", 0.3],
  ] as const) {
    const prior = previous.counts[label];
    const next = current.counts[label];
    if (pctChange(prior, next) > threshold) warnings.push(`${label} count changed from ${prior} to ${next}; inspect parser drift.`);
  }
  if (current.counts.facts < previous.counts.facts) warnings.push(`Fact count dropped from ${previous.counts.facts} to ${current.counts.facts}.`);
  for (const key of Object.keys(current.coverage) as Array<keyof ExtractionReport["coverage"]>) {
    if (previous.coverage[key] !== current.coverage[key]) warnings.push(`Major section coverage changed for ${key}: ${previous.coverage[key]} -> ${current.coverage[key]}.`);
  }
  return warnings;
}

function riskDiagnostics(risks: RiskFactor[], chunks: FilingChunk[]) {
  const chunksById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const countBySourceSection = risks.reduce<Record<string, number>>((acc, risk) => {
    acc[risk.sourceSectionId] = (acc[risk.sourceSectionId] ?? 0) + 1;
    return acc;
  }, {});
  const categoryCounts = risks.reduce<Record<string, number>>((acc, risk) => {
    acc[risk.category] = (acc[risk.category] ?? 0) + 1;
    return acc;
  }, {});
  const typeCounts = risks.reduce<Record<string, number>>((acc, risk) => {
    acc[risk.riskExtractionType] = (acc[risk.riskExtractionType] ?? 0) + 1;
    return acc;
  }, {});
  const shortest = [...risks]
    .sort((a, b) => a.originalText.length - b.originalText.length)
    .slice(0, 50)
    .map((risk) => ({ id: risk.id, title: risk.title, length: risk.originalText.length, type: risk.riskExtractionType, warning: risk.extractionWarning }));
  const titleCounts = risks.reduce<Record<string, string[]>>((acc, risk) => {
    const key = normalizeTitle(risk.title).slice(0, 90);
    acc[key] = [...(acc[key] ?? []), risk.id];
    return acc;
  }, {});
  const duplicateTitles = Object.entries(titleCounts)
    .filter(([, ids]) => ids.length > 1)
    .map(([title, ids]) => ({ title, ids }));
  const suspicious = risks
    .filter((risk) => risk.needsReview || risk.extractionWarning)
    .map((risk) => ({ id: risk.id, title: risk.title, type: risk.riskExtractionType, length: risk.characterLength, warning: risk.extractionWarning ?? "Marked for review." }));
  return {
    totalRiskCount: risks.length,
    categoryCounts,
    typeCounts,
    countBySourceSection,
    belowLengthThresholds: {
      under150: risks.filter((risk) => risk.characterLength < 150).length,
      under300: risks.filter((risk) => risk.characterLength < 300).length,
      under500: risks.filter((risk) => risk.characterLength < 500).length,
    },
    shortestFifty: shortest,
    duplicateOrNearDuplicateTitles: duplicateTitles,
    missingTitleIds: risks.filter((risk) => !risk.title || risk.title === "Risk factor").map((risk) => risk.id),
    titleWithVeryLittleBodyIds: risks.filter((risk) => risk.riskExtractionType === "heading_only" || risk.characterLength < risk.title.length + 160).map((risk) => risk.id),
    tableOfContentsLikeIds: risks.filter((risk) => risk.riskExtractionType === "toc_entry").map((risk) => risk.id),
    belowMinimumLengthIds: risks.filter((risk) => risk.characterLength < 500).map((risk) => risk.id),
    outsideRiskFactorsSectionIds: risks
      .filter((risk) => risk.sourceChunkIds.some((id) => chunksById.get(id)?.title.trim() !== "RISK FACTORS"))
      .map((risk) => risk.id),
    normalLengthSample: risks.filter((risk) => risk.riskExtractionType === "full_text").slice(0, 20),
    suspiciousSample: risks.filter((risk) => risk.needsReview || risk.extractionWarning).slice(0, 20),
    suspicious,
  };
}

async function hashGeneratedArtifacts(filenames: string[]) {
  const entries = [];
  for (const filename of filenames) {
    const entry = await hashFile(path.join(GENERATED_DIR, filename));
    if (entry) entries.push(entry);
  }
  return entries;
}

async function main() {
  const force = process.argv.includes("--force");
  const warnings: string[] = [];
  const errors: string[] = [];
  await ensureReviewedFiles();

  const priorManifest = await readJsonFile<{ sourceFileHashes?: Record<string, string>; versions?: typeof PARSER_VERSIONS }>(path.join(GENERATED_DIR, "manifest.json"));
  const cachedIndexHash = await hashFile(localRawPath("0001628280-26-036936-index.htm"));
  const cachedMainHash = await hashFile(localRawPath("spaceexplorationtechnologi.htm"));
  const upstreamHashesUnchanged =
    priorManifest?.sourceFileHashes?.index === cachedIndexHash?.sha256 && priorManifest?.sourceFileHashes?.mainS1 === cachedMainHash?.sha256;
  const requiredGenerated = ["documents.json", "sections.json", "chunks.json", "facts.generated.json", "risks.generated.json", "tables.json", "risk-audit.json", "extraction-report.json"];
  const canReuseGenerated =
    !force &&
    priorManifest?.versions &&
    JSON.stringify(priorManifest.versions) === JSON.stringify(PARSER_VERSIONS) &&
    upstreamHashesUnchanged &&
    (await Promise.all(requiredGenerated.map((filename) => fileExists(path.join(GENERATED_DIR, filename))))).every(Boolean);
  if (canReuseGenerated) {
    console.log("Generated artifacts match extractor versions; reusing existing outputs. Use --force to regenerate.");
    const validation = await validateGeneratedData();
    for (const warning of validation.warnings) console.warn(`Warning: ${warning}`);
    if (validation.errors.length) {
      console.error("Validation failed:");
      for (const error of validation.errors) console.error(`- ${error}`);
      process.exit(1);
    }
    console.log("Ingestion skipped regeneration and validation passed.");
    return;
  }

  console.log("Fetching filing index...");
  const indexFetch = await fetchWithCache(TARGETS.indexUrl, localRawPath("0001628280-26-036936-index.htm"), force);
  console.log(indexFetch.cached ? "Using cached filing index." : "Downloaded filing index.");
  let documents = parseFilingIndex(indexFetch.text);
  documents = documents.map((document) => (document.filename === "0001628280-26-036936-index.htm" ? { ...document, sizeBytes: indexFetch.sizeBytes } : document));
  const mainDocument = findMainS1Document(documents);
  if (!mainDocument) {
    errors.push("Could not identify main S-1 document from filing index.");
  }

  let mainHtml = "";
  let enrichedDocuments: FilingDocument[] = documents;
  if (mainDocument) {
    console.log(`Fetching main S-1: ${mainDocument.filename}...`);
    const mainFetch = await fetchWithCache(mainDocument.sourceUrl, mainDocument.localPath, force);
    console.log(mainFetch.cached ? "Using cached main S-1 HTML." : "Downloaded main S-1 HTML.");
    mainHtml = mainFetch.text;
    enrichedDocuments = documents.map((document) =>
      document.id === mainDocument.id ? { ...document, localPath: mainDocument.localPath, sizeBytes: mainFetch.sizeBytes } : document,
    );
  }

  console.log("Parsing sections and tables...");
  const sections = mainDocument ? parseS1Sections(mainHtml, mainDocument.id, mainDocument.sourceUrl) : [];
  if (sections.length === 0) errors.push("No sections were extracted from the main S-1 HTML.");

  const chunks = chunkSections(sections);
  const rawTables = extractTables(mainHtml);
  const tables = rawTables.map((table) => ({
    id: stableId(["table", table.order]),
    order: table.order,
    text: normalizeWhitespace(table.text),
    html: table.html,
    sourceUrl: mainDocument?.sourceUrl ?? TARGETS.filingUrl,
    sectionId: sections.find((section) => table.text.slice(0, 80) && section.text.includes(table.text.slice(0, 80)))?.id,
  }));

  console.log("Extracting deterministic facts and risks...");
  const risks = extractRisks(chunks);
  const facts = extractFacts({ documents: enrichedDocuments, sections, chunks, riskFactorCount: risks.length, tableCount: tables.length });
  const reviewedFacts = (await readJsonFile<FilingFact[]>(path.join(REVIEWED_DIR, "facts.reviewed.json"))) ?? [];
  const reviewedRisks = (await readJsonFile<RiskFactor[]>(path.join(REVIEWED_DIR, "risks.reviewed.json"))) ?? [];
  const mergedFacts = mergeReviewed(facts, reviewedFacts);
  const mergedRisks = mergeReviewed(risks, reviewedRisks);
  const goldenChecks = runGoldenChecks(sections, chunks);

  if (risks.length === 0) warnings.push("Risk Factors section was not split into individual records.");
  if (sections.length < 10) warnings.push(`Only ${sections.length} sections were detected; parser may be missing filing heading structure.`);
  if (tables.length === 0) warnings.push("No tables were extracted from the main S-1 HTML.");
  if (!hasSection(sections, ["use of proceeds"])) warnings.push("Use of Proceeds section not detected.");
  if (!hasSection(sections, ["dilution"])) warnings.push("Dilution section not detected.");
  const missingGolden = goldenChecks.filter((check) => !check.found);
  if (missingGolden.length) warnings.push(`Golden checks missing: ${missingGolden.map((check) => check.label).join(", ")}.`);

  const coverage: ExtractionReport["coverage"] = {
    hasProspectusSummary: hasSection(sections, ["prospectus summary", "summary"]),
    hasRiskFactors: hasSection(sections, ["risk factors"]),
    hasUseOfProceeds: hasSection(sections, ["use of proceeds"]),
    hasDilution: hasSection(sections, ["dilution"]),
    hasCapitalization: hasSection(sections, ["capitalization"]),
    hasManagementDiscussion: hasSection(sections, ["managements discussion and analysis", "management's discussion and analysis"]),
    hasBusiness: hasSection(sections, ["business"]),
    hasPrincipalStockholders: hasSection(sections, principalStockholderAliases),
    hasRelatedPartyTransactions: hasSection(sections, ["certain relationships", "related party transactions"]),
    hasDescriptionOfCapitalStock: hasSection(sections, ["description of capital stock"]),
    hasUnderwriting: hasSection(sections, ["underwriting"]),
  };
  const priorSnapshot = await readJsonFile<Snapshot>(path.join(GENERATED_DIR, "extraction-snapshot.json"));
  const snapshot: Snapshot = {
    generatedAt: new Date().toISOString(),
    counts: {
      documents: enrichedDocuments.length,
      sections: sections.length,
      chunks: chunks.length,
      risks: mergedRisks.length,
      facts: mergedFacts.length,
      tables: tables.length,
    },
    coverage,
  };
  const snapshotWarnings = compareSnapshot(priorSnapshot, snapshot);
  warnings.push(...snapshotWarnings);
  const riskDiag = riskDiagnostics(mergedRisks, chunks);
  if (mergedFacts.length < 25) warnings.push(`Only ${mergedFacts.length} facts were extracted; add or review deterministic fact coverage.`);
  const fullTextRiskCount = mergedRisks.filter((risk) => risk.riskExtractionType === "full_text").length;
  if (mergedRisks.length > 220) warnings.push(`${mergedRisks.length} risk records were extracted, including ${fullTextRiskCount} full-text risks; inspect risk-audit.json for fragments and TOC entries.`);
  if (riskDiag.duplicateOrNearDuplicateTitles.length > 0) warnings.push(`${riskDiag.duplicateOrNearDuplicateTitles.length} duplicate or near-duplicate risk titles detected.`);
  if (tables.some((table) => !table.sectionId)) warnings.push("Some extracted tables are not associated with sections.");

  const report: ExtractionReport = {
    filingUrl: TARGETS.filingUrl,
    generatedAt: new Date().toISOString(),
    documentCount: enrichedDocuments.length,
    sectionCount: sections.length,
    chunkCount: chunks.length,
    factCount: mergedFacts.length,
    riskFactorCount: mergedRisks.length,
    warnings,
    errors,
    goldenChecks,
    coverage,
  };

  console.log("Writing generated artifacts...");
  await writeJsonFile(path.join(GENERATED_DIR, "filing-index.json"), { sourceUrl: TARGETS.indexUrl, cachedAt: new Date().toISOString(), documentCount: enrichedDocuments.length });
  await writeJsonFile(path.join(GENERATED_DIR, "documents.json"), enrichedDocuments);
  await writeJsonFile(path.join(GENERATED_DIR, "sections.json"), sections);
  await writeJsonFile(path.join(GENERATED_DIR, "chunks.json"), chunks);
  await writeJsonFile(path.join(GENERATED_DIR, "facts.generated.json"), facts);
  await writeJsonFile(path.join(GENERATED_DIR, "risks.generated.json"), risks);
  await writeJsonFile(path.join(GENERATED_DIR, "facts.json"), mergedFacts);
  await writeJsonFile(path.join(GENERATED_DIR, "risks.json"), mergedRisks);
  await writeJsonFile(path.join(GENERATED_DIR, "tables.json"), tables);
  await writeJsonFile(path.join(GENERATED_DIR, "extraction-report.json"), report);
  await writeJsonFile(path.join(GENERATED_DIR, "extraction-snapshot.json"), snapshot);
  await writeJsonFile(path.join(GENERATED_DIR, "risk-audit.json"), {
    generatedAt: new Date().toISOString(),
    totalRiskCount: mergedRisks.length,
    countByCategory: riskDiag.categoryCounts,
    countBySourceSection: riskDiag.countBySourceSection,
    countByExtractionType: riskDiag.typeCounts,
    countBelowLengthThresholds: riskDiag.belowLengthThresholds,
    shortestFiftyRisks: riskDiag.shortestFifty,
    duplicateOrNearDuplicateTitles: riskDiag.duplicateOrNearDuplicateTitles,
    risksWithNoTitle: riskDiag.missingTitleIds,
    risksWithTitleButVeryLittleBodyText: riskDiag.titleWithVeryLittleBodyIds,
    tableOfContentsLikeRisks: riskDiag.tableOfContentsLikeIds,
    risksExtractedOutsideMainRiskFactorsSection: riskDiag.outsideRiskFactorsSectionIds,
    normalLengthRiskSample: riskDiag.normalLengthSample,
    suspiciousRiskSample: riskDiag.suspiciousSample,
  });

  const rawHashes = {
    index: await hashFile(localRawPath("0001628280-26-036936-index.htm")),
    mainS1: mainDocument ? await hashFile(mainDocument.localPath) : undefined,
  };
  const generatedHashes = await hashGeneratedArtifacts([
    "documents.json",
    "sections.json",
    "chunks.json",
    "facts.generated.json",
    "risks.generated.json",
    "facts.json",
    "risks.json",
    "tables.json",
    "risk-audit.json",
    "extraction-report.json",
    "extraction-snapshot.json",
  ]);
  const diagnostics = {
    generatedAt: new Date().toISOString(),
    majorSectionCoverage: coverage,
    goldenChecks,
    lowConfidenceSections: sections.filter((section) => section.title.length < 3 || section.text.length < 80).map((section) => ({ id: section.id, title: section.title, textLength: section.text.length })),
    missingExpectedSections: goldenChecks.filter((check) => !check.found),
    factsMissingReview: mergedFacts.filter((fact) => fact.needsReview).map((fact) => ({ id: fact.id, label: fact.label, category: fact.category })),
    suspiciousRiskFactors: riskDiag.suspicious,
    riskDiagnostics: riskDiag,
    tableExtractionSummary: {
      count: tables.length,
      associatedWithSections: tables.filter((table) => table.sectionId).length,
      unassociated: tables.filter((table) => !table.sectionId).length,
    },
    duplicateIds: {},
    artifactHashes: { raw: rawHashes, generated: generatedHashes },
    warnings,
    fatalErrors: errors,
  };
  await writeJsonFile(path.join(GENERATED_DIR, "diagnostics.json"), diagnostics);
  const diagnosticsHash = await hashFile(path.join(GENERATED_DIR, "diagnostics.json"));
  const manifest = {
    filingUrl: TARGETS.filingUrl,
    accessionNumber: TARGETS.accessionNumber,
    generatedAt: new Date().toISOString(),
    sourceFileHashes: {
      index: rawHashes.index?.sha256,
      mainS1: rawHashes.mainS1?.sha256,
    },
    sourceFiles: rawHashes,
    versions: PARSER_VERSIONS,
    parserVersion: PARSER_VERSIONS.parser,
    sectionExtractorVersion: PARSER_VERSIONS.sectionExtractor,
    chunkerVersion: PARSER_VERSIONS.chunker,
    riskExtractorVersion: PARSER_VERSIONS.riskExtractor,
    factExtractorVersion: PARSER_VERSIONS.factExtractor,
    counts: snapshot.counts,
    warningsSummary: { count: warnings.length, items: warnings },
    errorsSummary: { count: errors.length, items: errors },
    generatedArtifactHashes: diagnosticsHash ? [...generatedHashes, diagnosticsHash] : generatedHashes,
    generatedDataHash: sha256Text(JSON.stringify({ sections, chunks, facts, risks, tables })),
  };
  await writeJsonFile(path.join(GENERATED_DIR, "manifest.json"), manifest);

  console.log(`Generated ${sections.length} sections, ${chunks.length} chunks, ${mergedFacts.length} facts, ${mergedRisks.length} risk factors, ${tables.length} tables.`);
  const validation = await validateGeneratedData();
  for (const warning of validation.warnings) console.warn(`Warning: ${warning}`);
  if (validation.errors.length) {
    console.error("Ingestion completed with validation failures:");
    for (const error of validation.errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log("Ingestion complete and validated.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
