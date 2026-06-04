import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";
import "./preview.css";
import { ThemeToggle } from "./components/theme/theme-toggle";
import { AsyncState } from "./components/views/async-state";
import { SummaryStat } from "./components/views/summary-stat";
import { FactsTable } from "./components/views/facts-table";
import { RiskFactorList } from "./components/views/risk-factor-list";
import { makeMockFilingData } from "./lib/mock-data";
import { formatNumber } from "./lib/format";

const data = makeMockFilingData("success");

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Preview() {
  return (
    <div className="preview-root mx-auto flex w-full max-w-5xl flex-col gap-10 p-8">
      <header className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Preview harness</p>
          <h1 className="text-2xl font-bold">shadcn view components · mock data</h1>
        </div>
        <ThemeToggle />
      </header>

      <Section title="Async states (idle / loading / error / empty / success)">
        <div className="grid gap-3 sm:grid-cols-2">
          <AsyncState status="loading" loadingLabel="Loading filing…">
            <div />
          </AsyncState>
          <AsyncState status="empty" empty="No sections were extracted yet.">
            <div />
          </AsyncState>
          <AsyncState status="error" error="Could not identify the main S-1 document.">
            <div />
          </AsyncState>
          <AsyncState status="success">
            <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
              Success — content renders here.
            </div>
          </AsyncState>
        </div>
      </Section>

      <Section title="Summary stats">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <SummaryStat label="State" value="Success" tone="good" />
          <SummaryStat label="Documents" value={formatNumber(data.report.documentCount)} />
          <SummaryStat label="Sections" value={formatNumber(data.report.sectionCount)} />
          <SummaryStat label="Facts" value={formatNumber(data.report.factCount)} />
          <SummaryStat label="Risk factors" value={formatNumber(data.report.riskFactorCount)} />
          <SummaryStat
            label="Needs review"
            value={formatNumber(data.facts.filter((fact) => fact.needsReview).length)}
            tone="warn"
            hint="Facts flagged for human review"
          />
        </div>
      </Section>

      <Section title="Extracted facts">
        <FactsTable facts={data.facts} />
      </Section>

      <Section title="Risk factors (with category filter)">
        <RiskFactorList risks={data.risks} />
      </Section>
    </div>
  );
}

createRoot(document.getElementById("preview-root")!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
