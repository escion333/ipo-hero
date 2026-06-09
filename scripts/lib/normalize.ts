export function normalizeWhitespace(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

export function normalizeTitle(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugify(value: string): string {
  const slug = normalizeTitle(value).replace(/\s+/g, "-").slice(0, 80);
  return slug || "untitled";
}

export function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(normalizeWhitespace(value).length / 4));
}

// True when `quote` is a contiguous excerpt of `source` on an alphanumeric basis.
// We compare on letters+digits only so that display-time whitespace/punctuation reflow
// (collapsing dotted table leaders, spacing glued table cells) does not break the
// "this quote really is in the filing" guarantee — the alphanumeric stream is unchanged.
export function isSourceExcerpt(source: string, quote: string): boolean {
  const signature = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return signature(source).includes(signature(quote));
}

export function excerpt(value: string, maxLength = 500): string {
  const clean = normalizeWhitespace(value);
  return clean.length <= maxLength ? clean : `${clean.slice(0, maxLength - 1).trim()}...`;
}

export function stableId(parts: Array<string | number | undefined | null>): string {
  return parts
    .filter((part) => part !== undefined && part !== null && `${part}`.length > 0)
    .map((part) => slugify(`${part}`))
    .join("-");
}
