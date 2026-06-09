import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const GENERATED_DIR = path.join("src", "data", "generated");
export const REVIEWED_DIR = path.join("src", "data", "reviewed");

export const PARSER_VERSIONS = {
  parser: "2026-06-04.3",
  sectionExtractor: "section-heuristic-v3",
  chunker: "section-aware-v2",
  riskExtractor: "risk-splitter-v3",
  factExtractor: "deterministic-facts-v3",
};

export type HashEntry = {
  path: string;
  sha256: string;
  sizeBytes: number;
};

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export async function hashFile(filePath: string): Promise<HashEntry | undefined> {
  if (!(await fileExists(filePath))) return undefined;
  const buffer = await readFile(filePath);
  return {
    path: filePath,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    sizeBytes: buffer.byteLength,
  };
}

export async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  if (!(await fileExists(filePath))) return undefined;
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

export async function ensureReviewedFiles(): Promise<void> {
  await mkdir(REVIEWED_DIR, { recursive: true });
  for (const filename of ["facts.reviewed.json", "risks.reviewed.json"]) {
    const target = path.join(REVIEWED_DIR, filename);
    if (!(await fileExists(target))) {
      await writeJsonFile(target, []);
    }
  }
}

export function mergeReviewed<T extends { id: string }>(generated: T[], reviewed: T[]): T[] {
  const reviewedById = new Map(reviewed.map((item) => [item.id, item]));
  const merged = generated.map((item) => reviewedById.get(item.id) ?? item);
  const generatedIds = new Set(generated.map((item) => item.id));
  for (const item of reviewed) {
    if (!generatedIds.has(item.id)) merged.push(item);
  }
  return merged;
}
