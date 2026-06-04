import { Badge } from "../ui/badge";
import { Card } from "../ui/card";

type Tone = "default" | "good" | "warn" | "muted";

type SummaryStatProps = {
  label: string;
  value: string;
  tone?: Tone;
  hint?: string;
};

export function SummaryStat({ label, value, tone = "default", hint }: SummaryStatProps) {
  return (
    <Card className="gap-2 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <Badge tone={tone} className="text-sm">
        {value}
      </Badge>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </Card>
  );
}
