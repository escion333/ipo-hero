import { useMemo, useState } from "react";

import type { RiskFactor } from "../../lib/types";
import { titleCase } from "../../lib/format";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

const specificityTone = { company_specific: "good", generic: "warn", mixed: "default" } as const;
const confidenceTone = { high: "good", medium: "muted", low: "warn" } as const;

export function RiskFactorList({ risks }: { risks: RiskFactor[] }) {
  const [category, setCategory] = useState("all");
  const categories = useMemo(
    () => ["all", ...new Set(risks.map((risk) => risk.category))],
    [risks],
  );
  const visible = category === "all" ? risks : risks.filter((risk) => risk.category === category);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4">
        <CardTitle>Risk Factors</CardTitle>
        <div className="flex items-center gap-2">
          <Label htmlFor="risk-category">Category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger id="risk-category" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categories.map((option) => (
                <SelectItem key={option} value={option}>
                  {option === "all" ? "All categories" : titleCase(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">No risks in this category.</p>
        ) : (
          visible.map((risk) => (
            <article
              key={risk.id}
              className="flex flex-col gap-1.5 border-t border-border pt-4 first:border-t-0 first:pt-0"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="muted">{risk.category}</Badge>
                <Badge tone={specificityTone[risk.specificity]}>
                  {risk.specificity.replace("_", " ")}
                </Badge>
                <Badge tone={confidenceTone[risk.confidence]}>{risk.confidence}</Badge>
                {risk.needsReview ? <Badge tone="warn">needs review</Badge> : null}
              </div>
              <h3 className="font-semibold">{risk.title}</h3>
              <p className="text-sm">{risk.plainEnglish}</p>
              <p className="text-sm text-muted-foreground">{risk.whyItMatters}</p>
            </article>
          ))
        )}
      </CardContent>
    </Card>
  );
}
