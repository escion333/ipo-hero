import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const SEC_ARCHIVE_BASE = "https://www.sec.gov/Archives/edgar/data/1181412/000162828026036936";
const USER_AGENT = "ipo-hero research workbench contact@example.com";

export const TARGETS = {
  filingUrl: `${SEC_ARCHIVE_BASE}/spaceexplorationtechnologi.htm`,
  indexUrl: `${SEC_ARCHIVE_BASE}/0001628280-26-036936-index.htm`,
  accessionNumber: "0001628280-26-036936",
  filedAt: "2026-05-20",
  formType: "S-1",
  baseUrl: SEC_ARCHIVE_BASE,
};

export function archiveUrlFor(filename: string): string {
  return `${SEC_ARCHIVE_BASE}/${filename}`;
}

export function localRawPath(filename: string): string {
  return path.join("raw", filename);
}

export async function fetchWithCache(url: string, localPath: string, force = false): Promise<{ text: string; sizeBytes: number; cached: boolean }> {
  await mkdir(path.dirname(localPath), { recursive: true });
  if (!force) {
    try {
      const existing = await readFile(localPath, "utf8");
      const info = await stat(localPath);
      return { text: existing, sizeBytes: info.size, cached: true };
    } catch {
      // Cache miss: fetch below.
    }
  }

  {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!response.ok) {
      throw new Error(`SEC fetch failed ${response.status} ${response.statusText}: ${url}`);
    }
    const text = await response.text();
    await writeFile(localPath, text);
    return { text, sizeBytes: Buffer.byteLength(text), cached: false };
  }
}
