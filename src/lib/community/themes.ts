// Forum discussion themes — a deliberately tiny, fixed taxonomy that replaces the
// ~18 raw EDGAR filing sections threads used to be scoped to. A thread's stored
// `sectionId` holds one of these theme keys, or null for general discussion. This
// is the single source of truth for the forum's topic options and labels.

export type ThemeKey = "business" | "financials" | "risks" | "governance" | "offering";

export const THEMES: { key: ThemeKey; label: string }[] = [
  { key: "business", label: "Business" },
  { key: "financials", label: "Financials" },
  { key: "risks", label: "Risks" },
  { key: "governance", label: "Governance & Ownership" },
  { key: "offering", label: "The Offering" },
];

const LABEL = new Map<string, string>(THEMES.map((t) => [t.key, t.label]));

/** Human label for a stored theme key. Null for general / unknown values. */
export function themeLabel(key: string | null | undefined): string | null {
  if (!key) return null;
  return LABEL.get(key) ?? null;
}

/** Whether a string is one of the canonical theme keys. */
export function isThemeKey(value: string | null | undefined): value is ThemeKey {
  return Boolean(value) && LABEL.has(value as string);
}

// Maps each brief reader-section id to its theme, so the Brief's "Discuss this
// section" buttons anchor into the right forum theme. Sections without an entry
// (overview, source notes) don't surface a Discuss link.
const BRIEF_SECTION_THEME: Record<string, ThemeKey> = {
  "what-spacex-says-it-does": "business",
  "offering-mechanics": "offering",
  "financial-snapshot": "financials",
  "use-of-proceeds": "offering",
  "dilution-capitalization": "offering",
  "control-governance": "governance",
  "debt-liquidity": "financials",
  "related-party-affiliated-transactions": "governance",
  "lockup-share-overhang": "offering",
  "key-risk-themes": "risks",
};

export function themeForBriefSection(briefSectionId: string): ThemeKey | null {
  return BRIEF_SECTION_THEME[briefSectionId] ?? null;
}

// Fallback bucketing for legacy/seed threads whose stored sectionId is still a raw
// filing-section id (e.g. "section-40-riskfactors") rather than a theme key. Order
// matters: more specific patterns win. New threads store theme keys directly, so
// this only covers pre-migration data.
const LEGACY_PATTERNS: { test: RegExp; theme: ThemeKey }[] = [
  { test: /risk/i, theme: "risks" },
  { test: /management|governance|ownership|relationship|relatedperson|capitalstock|director|control/i, theme: "governance" },
  { test: /proceeds|underwriting|dilution|capitalization|lockup|shareseligible|offering|prospectus/i, theme: "offering" },
  { test: /financ|dividend|debt|liquidity|notes/i, theme: "financials" },
  { test: /business|operations/i, theme: "business" },
];

/** Resolve any stored sectionId (a theme key OR a legacy filing id) to a theme. */
export function resolveTheme(sectionId: string | null | undefined): ThemeKey | null {
  if (!sectionId) return null;
  if (isThemeKey(sectionId)) return sectionId;
  for (const { test, theme } of LEGACY_PATTERNS) if (test.test(sectionId)) return theme;
  return null;
}
