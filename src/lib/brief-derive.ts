// Derivations for the redesigned Brief reader. Pure functions over the existing
// generated brief data — no new data sources, nothing invented. Everything here
// is traceable back to a high-confidence evidence card.
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
  return { section, items: section.items };
}

export function bodySections(): BriefSection[] {
  return briefData.sections.filter((s) => !/10 things/i.test(s.title));
}

export function needsReviewCount(): number {
  return briefData.sections.reduce(
    (sum, s) => sum + s.items.filter((i) => i.needsReview).length,
    0,
  );
}
