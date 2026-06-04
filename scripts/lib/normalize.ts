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
