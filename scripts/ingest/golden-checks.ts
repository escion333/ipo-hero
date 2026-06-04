import type { FilingChunk, FilingSection } from "../lib/schema";
import { normalizeTitle } from "../lib/normalize";

export type GoldenCheck = {
  id: string;
  label: string;
  found: boolean;
  matchedId?: string;
  matchedType?: "section" | "chunk";
  confidence: "high" | "medium" | "low";
  diagnostic: string;
};

const expectedChecks: Array<{ id: string; label: string; needles: string[]; aliases?: string[] }> = [
  { id: "prospectus-summary", label: "Prospectus Summary", needles: ["prospectus summary", "summary"] },
  { id: "risk-factors", label: "Risk Factors", needles: ["risk factors"] },
  { id: "use-of-proceeds", label: "Use of Proceeds", needles: ["use of proceeds"] },
  { id: "dividend-policy", label: "Dividend Policy", needles: ["dividend policy"] },
  { id: "capitalization", label: "Capitalization", needles: ["capitalization"] },
  { id: "dilution", label: "Dilution", needles: ["dilution"] },
  { id: "mda", label: "Management's Discussion and Analysis", needles: ["managements discussion and analysis", "management's discussion and analysis"] },
  { id: "business", label: "Business", needles: ["business"] },
  { id: "management", label: "Management", needles: ["management"] },
  {
    id: "principal-stockholders",
    label: "Principal Stockholders",
    needles: [
      "principal stockholders",
      "principal and selling stockholders",
      "selling stockholders",
      "security ownership",
      "beneficial ownership",
      "ownership of securities",
      "certain beneficial owners",
      "management and principal stockholders",
      "principal shareholders",
      "security ownership of certain beneficial owners and management",
    ],
    aliases: [
      "Principal Stockholders",
      "Principal and Selling Stockholders",
      "Selling Stockholders",
      "Security Ownership",
      "Beneficial Ownership",
      "Ownership of Securities",
      "Certain Beneficial Owners",
      "Management and Principal Stockholders",
      "Principal Shareholders",
    ],
  },
  { id: "related-party", label: "Related Party Transactions", needles: ["certain relationships", "related party transactions"] },
  { id: "capital-stock", label: "Description of Capital Stock", needles: ["description of capital stock"] },
  { id: "future-sale", label: "Shares Eligible for Future Sale", needles: ["shares eligible for future sale"] },
  { id: "underwriting", label: "Underwriting", needles: ["underwriting"] },
];

function includesNeedle(value: string, needles: string[]): boolean {
  const normalized = normalizeTitle(value);
  return needles.some((needle) => normalized.includes(normalizeTitle(needle)));
}

export function runGoldenChecks(sections: FilingSection[], chunks: FilingChunk[]): GoldenCheck[] {
  return expectedChecks.map((check) => {
    const section = sections.find((item) => includesNeedle(item.title, check.needles));
    if (section) {
      return {
        id: check.id,
        label: check.label,
        found: true,
        matchedId: section.id,
        matchedType: "section",
        confidence: "high",
        diagnostic: `Matched section heading "${section.title}".`,
      };
    }

    const chunk = chunks.find((item) => includesNeedle(item.title, check.needles) || includesNeedle(item.text.slice(0, 800), check.needles));
    if (chunk) {
      return {
        id: check.id,
        label: check.label,
        found: true,
        matchedId: chunk.id,
        matchedType: "chunk",
        confidence: "medium",
        diagnostic: `No exact section heading; matched chunk titled "${chunk.title}".`,
      };
    }

    const searchedAliases = check.aliases?.join(", ") ?? check.needles.join(", ");
    return {
      id: check.id,
      label: check.label,
      found: false,
      confidence: "low",
      diagnostic: `No matching section heading or chunk text found after searching aliases: ${searchedAliases}.`,
    };
  });
}
