// Derivations for the Brief reader. Pure functions over the generated brief
// data — no new data sources, nothing invented. Every claim shown traces back
// to the filing via its citations.
import { briefData } from "./brief-data";

type BriefSection = (typeof briefData.sections)[number];
type BriefItem = BriefSection["items"][number];

export type Kpi = {
  label: string;
  value: string;
  period: string;
  accent: string; // chart-ramp css var
};

const CHART = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

function shortDollars(billions: number, negative: boolean): string {
  const sign = negative ? "-" : "";
  return `${sign}$${billions.toFixed(2)}B`;
}

// Pull headline financials out of the "Financial Snapshot" section's high-confidence
// item titles (e.g. "Revenue was $4.694 billion for the three months ended ...").
export function deriveKpis(): Kpi[] {
  const section = briefData.sections.find((s) => s.title === "Financial Snapshot");
  if (!section) return [];
  const kpis: Kpi[] = [];
  for (const item of section.items) {
    if (item.confidence !== "high") continue;
    const match = item.title.match(/\$([\d.]+)\s*billion/i);
    if (!match) continue;
    const negative = /negative|loss/i.test(item.title);
    const value = shortDollars(Number(match[1]), negative);
    const label = item.title
      .replace(/\s+(was|were)\b.*$/i, "")
      .replace(/^The\s+/i, "")
      .trim();
    const period = /\bat\b|\bas of\b/i.test(item.title) ? "as of Mar 31, 2026" : "Q1 2026";
    kpis.push({ label, value, period, accent: CHART[kpis.length % CHART.length] });
    if (kpis.length >= 5) break;
  }
  return kpis;
}

// Color a taxonomy category consistently using the reserved chart ramp.
const CATEGORY_ACCENT: Record<string, string> = {
  financial: "var(--chart-1)",
  offering: "var(--chart-1)",
  business: "var(--chart-2)",
  proceeds: "var(--chart-2)",
  debt: "var(--chart-3)",
  lockup: "var(--chart-3)",
  dilution: "var(--chart-4)",
  related_party: "var(--chart-4)",
  governance: "var(--chart-5)",
  risk: "var(--destructive)",
};

export function categoryAccent(category?: string): string {
  return (category && CATEGORY_ACCENT[category]) || "var(--muted-foreground)";
}

// Turn a chunk/section id like "section-8-preliminaryprospectus" into a human label.
export function prettifySection(sectionId: string): string {
  const raw = sectionId.replace(/^section-\d+-?/i, "").replace(/^chunk-section\d+/i, "");
  const cleaned = raw.replace(/[-_]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  if (!cleaned) return "Filing source";
  return cleaned
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function heroItems(): { section: BriefSection; items: BriefItem[] } | null {
  const section = briefData.sections.find((s) => /10 things/i.test(s.title));
  if (!section) return null;
  return { section, items: section.items.map(cleanItem) };
}

export type ReaderSection = {
  id: string;
  title: string;
  summary: string;
  items: BriefItem[];
};

// Reader-facing information architecture: the generated brief has 12 granular
// sections (plus two internal QA sections); the reader collapses them into six
// plain-language groups. Generated section titles are matched exactly and merged
// in order. QA sections ("…Needs Review", "Source Notes") are intentionally
// omitted from the public reader — they live only in the reviewer workbench.
const READER_GROUPS: { id: string; title: string; summary: string; sources: string[] }[] = [
  {
    id: "overview",
    title: "Overview",
    summary: "What the company tells the market it does, in its own words.",
    sources: ["What SpaceX Says It Does"],
  },
  {
    id: "offering",
    title: "The Offering",
    summary: "How the share sale is structured — and what hasn't been set yet.",
    sources: ["Offering Mechanics"],
  },
  {
    id: "financials",
    title: "Financials",
    summary: "The headline numbers from the filing's statements and notes.",
    sources: ["Financial Snapshot"],
  },
  {
    id: "ownership",
    title: "Ownership & Control",
    summary: "Who holds the shares, who controls the votes, and how that shifts after the IPO.",
    sources: [
      "Dilution and Capitalization",
      "Control and Governance",
      "Lockup and Future Share Overhang",
      "Related-Party / Affiliated Transactions",
    ],
  },
  {
    id: "capital",
    title: "Capital & Liquidity",
    summary: "Where the money raised is meant to go, and how the company is funded today.",
    sources: ["Use of Proceeds", "Debt and Liquidity"],
  },
  {
    id: "risks",
    title: "Key Risks",
    summary: "The risks SpaceX itself flags as most material to the business.",
    sources: ["Key Risk Themes"],
  },
];

// The generated brief sometimes refers to its own extraction units as "cards"
// (a pipeline term). Scrub that vocabulary at read time so the reader never sees
// internal jargon — meaning is preserved. The durable fix lives in the brief
// generator (scripts/brief/generate-brief.ts); this guards the reader meanwhile.
function sanitizeProse<T extends string | undefined>(text: T): T {
  if (!text) return text;
  const scrubbed = text
    .replace(/\bexisting (?:financial |business |segment-framing |governance |)cards\b/gi, "the figures already shown")
    .replace(/\bevidence cards?\b/gi, "figures")
    .replace(/\b(?:financial |business |governance )?cards\b/gi, "figures");
  // Re-capitalize the sentence start in case a replacement landed there.
  return (scrubbed.charAt(0).toUpperCase() + scrubbed.slice(1)) as T;
}

function cleanItem(item: BriefItem): BriefItem {
  return { ...item, whyItMatters: sanitizeProse(item.whyItMatters), body: sanitizeProse(item.body) };
}

export function readerSections(): ReaderSection[] {
  const byTitle = new Map(briefData.sections.map((s) => [s.title, s]));
  const out: ReaderSection[] = [];
  for (const group of READER_GROUPS) {
    const items = group.sources.flatMap((title) => byTitle.get(title)?.items ?? []).map(cleanItem);
    if (items.length === 0) continue;
    out.push({ id: group.id, title: group.title, summary: group.summary, items });
  }
  return out;
}
