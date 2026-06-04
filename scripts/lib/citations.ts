import type { FilingChunk, FilingSection } from "./schema";

export function citationForSection(section: FilingSection): string {
  return `${section.title || "Untitled section"} (${section.documentId}, section ${section.order})`;
}

export function citationForChunk(chunk: FilingChunk): string {
  return chunk.citationLabel;
}
