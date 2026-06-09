import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import type { FilingSection } from "./schema";
import { normalizeTitle, normalizeWhitespace, slugify, stableId } from "./normalize";

const majorSectionPatterns = [
  /^prospectus summary$/,
  /^summary$/,
  /^risk factors$/,
  /^use of proceeds$/,
  /^dividend policy$/,
  /^capitalization$/,
  /^dilution$/,
  /^selected financial data$/,
  /^summary financial data$/,
  /^managements discussion and analysis/,
  /^business$/,
  /^management$/,
  /^principal stockholders$/,
  /^certain relationships and related/,
  /^description of capital stock$/,
  /^shares eligible for future sale$/,
  /^material us federal income tax/,
  /^underwriting$/,
];

function looksLikeHeading(text: string): boolean {
  const clean = normalizeWhitespace(text);
  if (clean.length < 3 || clean.length > 180) return false;
  const normalized = normalizeTitle(clean);
  if (majorSectionPatterns.some((pattern) => pattern.test(normalized))) return true;
  if (/^item\s+\d+[a-z]?\.?\s+/i.test(clean)) return true;
  if (/^part\s+[ivx]+/i.test(clean)) return true;
  const letters = clean.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 4 && clean === clean.toUpperCase()) return true;
  return false;
}

function levelForHeading(text: string): number {
  const normalized = normalizeTitle(text);
  if (majorSectionPatterns.some((pattern) => pattern.test(normalized))) return 1;
  if (/^item\s+\d+/i.test(text)) return 1;
  return 2;
}

// Flatten a node to text. cheerio's .text() concatenates adjacent table cells with no
// separator ("$4,694$4,067", "2026December"), destroying column boundaries. When the node
// contains a table, clone it and inject a space after every cell and row so the flattened
// text keeps cell boundaries. The original DOM (and stored html fragments) is untouched.
function nodeText($: cheerio.CheerioAPI, node: Element): string {
  const $node = $(node);
  if ($node.is("table") || $node.find("table").length > 0) {
    const $clone = $node.clone();
    $clone.find("td, th").append(" ");
    $clone.find("tr").append(" ");
    return normalizeWhitespace($clone.text());
  }
  return normalizeWhitespace($node.text());
}

// Same cell/row separation for standalone table extraction.
function tableText($: cheerio.CheerioAPI, node: Element): string {
  const $clone = $(node).clone();
  $clone.find("td, th").append(" ");
  $clone.find("tr").append(" ");
  return normalizeWhitespace($clone.text());
}

export function parseS1Sections(html: string, documentId: string, sourceUrl: string): FilingSection[] {
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();
  const bodyChildren = $("body")
    .find("div, p, h1, h2, h3, h4, h5, h6, table")
    .filter((_, element) => {
      const tag = element.tagName?.toLowerCase();
      if (tag === "div") {
        return $(element).children("div, p, h1, h2, h3, h4, h5, h6, table").length === 0;
      }
      return $(element).parents("p, h1, h2, h3, h4, h5, h6, table").length === 0;
    })
    .toArray() as Element[];
  const sections: FilingSection[] = [];
  let current: FilingSection | null = null;
  let order = 0;
  const seenHeadingKeys = new Set<string>();

  function pushCurrent() {
    if (!current) return;
    current.text = normalizeWhitespace(current.text);
    if (current.text.length > 0 || current.title !== "Document Preamble") {
      sections.push(current);
    }
  }

  current = {
    id: "section-document-preamble",
    documentId,
    title: "Document Preamble",
    normalizedTitle: "document preamble",
    level: 1,
    order: order++,
    parentId: null,
    text: "",
    html: "",
    sourceUrl,
    sourceAnchor: undefined,
  };

  for (const node of bodyChildren) {
    const tag = node.tagName?.toLowerCase();
    const text = nodeText($, node);
    if (!text) continue;
    const htmlFragment = $.html(node);
    const isHeading = tag?.startsWith("h") || looksLikeHeading(text);
    const headingKey = `${normalizeTitle(text)}:${order}`;

    if (isHeading && !seenHeadingKeys.has(headingKey)) {
      seenHeadingKeys.add(headingKey);
      pushCurrent();
      const level = tag?.startsWith("h") ? Number(tag.replace("h", "")) || levelForHeading(text) : levelForHeading(text);
      const priorParent = [...sections].reverse().find((section) => section.level < level);
      const anchor = $(node).attr("id") || $(node).find("[id]").first().attr("id") || undefined;
      current = {
        id: stableId(["section", order, slugify(text)]),
        documentId,
        title: text,
        normalizedTitle: normalizeTitle(text),
        level,
        order: order++,
        parentId: priorParent?.id ?? null,
        text: "",
        html: htmlFragment,
        sourceUrl,
        sourceAnchor: anchor,
      };
      continue;
    }

    if (!current) continue;
    current.text = `${current.text}\n\n${text}`;
    current.html = `${current.html}\n${htmlFragment}`;
  }

  pushCurrent();
  return mergeTinySections(sections);
}

function mergeTinySections(sections: FilingSection[]): FilingSection[] {
  const merged: FilingSection[] = [];
  for (const section of sections) {
    const previous = merged.at(-1);
    if (
      previous &&
      section.text.length < 120 &&
      section.level > previous.level &&
      !majorSectionPatterns.some((pattern) => pattern.test(section.normalizedTitle))
    ) {
      previous.text = normalizeWhitespace(`${previous.text}\n\n${section.title}\n${section.text}`);
      previous.html = `${previous.html}\n${section.html}`;
      continue;
    }
    merged.push(section);
  }
  return merged.map((section, index) => ({ ...section, order: index }));
}

export function extractTables(html: string): Array<{ order: number; text: string; html: string }> {
  const $ = cheerio.load(html);
  return $("table")
    .toArray()
    .map((node, order) => ({
      order,
      text: tableText($, node),
      html: $.html(node),
    }))
    .filter((table) => table.text.length > 0);
}
