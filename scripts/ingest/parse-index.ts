import * as cheerio from "cheerio";
import { archiveUrlFor, localRawPath } from "../lib/sec";
import type { FilingDocument } from "../lib/schema";
import { normalizeWhitespace, slugify } from "../lib/normalize";

export function parseFilingIndex(indexHtml: string): FilingDocument[] {
  const $ = cheerio.load(indexHtml);
  const documents: FilingDocument[] = [];

  $("table.tableFile tr").each((_, row) => {
    const cells = $(row).find("td").toArray();
    if (cells.length < 4) return;
    const sequence = Number(normalizeWhitespace($(cells[0]).text()));
    const description = normalizeWhitespace($(cells[1]).text());
    const link = $(cells[2]).find("a").attr("href") ?? normalizeWhitespace($(cells[2]).text());
    const type = normalizeWhitespace($(cells[3]).text());
    if (!sequence || !link || link === "#") return;
    const filename = link.split("/").at(-1) ?? link;
    documents.push({
      id: `${sequence}-${slugify(type || description || filename)}`,
      sequence,
      type,
      description,
      filename,
      sourceUrl: archiveUrlFor(filename),
      localPath: localRawPath(filename),
    });
  });

  return documents;
}

export function findMainS1Document(documents: FilingDocument[]): FilingDocument | undefined {
  return (
    documents.find((document) => /^s-?1$/i.test(document.type) && /\.html?$/i.test(document.filename)) ??
    documents.find((document) => /s-?1/i.test(document.type) && /\.html?$/i.test(document.filename)) ??
    documents.find((document) => /spaceexplorationtechnologi\.htm/i.test(document.filename))
  );
}
