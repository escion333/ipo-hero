import type { FilingChunk, FilingSection } from "../lib/schema";
import { citationForSection } from "../lib/citations";
import { estimateTokens, excerpt, normalizeTitle, normalizeWhitespace, stableId } from "../lib/normalize";

const MAX_CHARS = 6_000;

function chunkTypeFor(section: FilingSection): FilingChunk["chunkType"] {
  const title = normalizeTitle(section.title);
  if (title.includes("risk factors")) return "risk_factor";
  if (title.includes("financial") || title.includes("capitalization")) return "financial_statement";
  return "narrative";
}

export function chunkSections(sections: FilingSection[]): FilingChunk[] {
  const chunks: FilingChunk[] = [];
  for (const section of sections) {
    const clean = normalizeWhitespace(section.text);
    if (!clean) continue;
    const paragraphs = clean.split(/(?<=\.)\s+(?=[A-Z(])/);
    let buffer = "";
    let part = 1;

    function flush() {
      const text = normalizeWhitespace(buffer);
      if (!text) return;
      const id = stableId(["chunk", section.id, part]);
      chunks.push({
        id,
        sectionId: section.id,
        documentId: section.documentId,
        chunkType: chunkTypeFor(section),
        title: section.title,
        text,
        tokenEstimate: estimateTokens(text),
        sourceUrl: section.sourceUrl,
        sourceAnchor: section.sourceAnchor,
        citationLabel: `${citationForSection(section)}, chunk ${part}: "${excerpt(text, 140)}"`,
      });
      part += 1;
      buffer = "";
    }

    for (const paragraph of paragraphs) {
      if (`${buffer} ${paragraph}`.length > MAX_CHARS) flush();
      buffer = `${buffer} ${paragraph}`;
    }
    flush();
  }
  return chunks;
}
