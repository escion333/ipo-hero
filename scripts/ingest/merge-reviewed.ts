import path from "node:path";
import { ensureReviewedFiles, GENERATED_DIR, mergeReviewed, readJsonFile, REVIEWED_DIR, writeJsonFile } from "../lib/artifacts";
import type { FilingFact, RiskFactor } from "../lib/schema";

async function main() {
  await ensureReviewedFiles();
  const generatedFacts = (await readJsonFile<FilingFact[]>(path.join(GENERATED_DIR, "facts.generated.json"))) ?? [];
  const generatedRisks = (await readJsonFile<RiskFactor[]>(path.join(GENERATED_DIR, "risks.generated.json"))) ?? [];
  const reviewedFacts = (await readJsonFile<FilingFact[]>(path.join(REVIEWED_DIR, "facts.reviewed.json"))) ?? [];
  const reviewedRisks = (await readJsonFile<RiskFactor[]>(path.join(REVIEWED_DIR, "risks.reviewed.json"))) ?? [];

  await writeJsonFile(path.join(GENERATED_DIR, "facts.json"), mergeReviewed(generatedFacts, reviewedFacts));
  await writeJsonFile(path.join(GENERATED_DIR, "risks.json"), mergeReviewed(generatedRisks, reviewedRisks));
  console.log(`Merged ${generatedFacts.length} generated facts with ${reviewedFacts.length} reviewed facts.`);
  console.log(`Merged ${generatedRisks.length} generated risks with ${reviewedRisks.length} reviewed risks.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
