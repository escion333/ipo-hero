import type { FilingFact } from "../../lib/types";
import { titleCase } from "../../lib/format";
import { Badge } from "../ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";

const confidenceTone = { high: "good", medium: "muted", low: "warn" } as const;

export function FactsTable({ facts }: { facts: FilingFact[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Label</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Confidence</TableHead>
          <TableHead>Value</TableHead>
          <TableHead>Review</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {facts.map((fact) => (
          <TableRow key={fact.id}>
            <TableCell className="font-medium">{fact.label}</TableCell>
            <TableCell>{titleCase(fact.category)}</TableCell>
            <TableCell>
              <Badge tone={confidenceTone[fact.confidence]}>{fact.confidence}</Badge>
            </TableCell>
            <TableCell className="max-w-sm text-muted-foreground">{fact.valueText}</TableCell>
            <TableCell>
              {fact.needsReview ? (
                <Badge tone="warn">needs review</Badge>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
