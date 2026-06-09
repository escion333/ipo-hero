import { AlertTriangle, ExternalLink, FileText, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "./components/ui/badge";
import { SpacexPriceTicker } from "./components/spacex-price-ticker";
import { ThemeToggle } from "./components/theme/theme-toggle";
import { filingData } from "./lib/filing-data";
import { formatNumber, titleCase } from "./lib/format";

type LoadState = "idle" | "loading" | "success" | "error" | "empty";
type ViewMode = "brief" | "workbench";

function App() {
  const [selectedSectionId, setSelectedSectionId] = useState(filingData.sections[0]?.id ?? "");
  const [riskCategory, setRiskCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("workbench");
  const state: LoadState = filingData.report.errors.length > 0 ? "error" : filingData.sections.length === 0 ? "empty" : "success";

  const riskCategories = useMemo(() => ["all", ...new Set(filingData.risks.map((risk) => risk.category))], []);
  const visibleRisks = filingData.risks.filter((risk) => riskCategory === "all" || risk.category === riskCategory);
  const selectedSection = filingData.sections.find((section) => section.id === selectedSectionId) ?? filingData.sections[0];
  const selectedChunks = filingData.chunks.filter((chunk) => chunk.sectionId === selectedSection?.id);
  const searchedChunks = filingData.chunks
    .filter((chunk) => !query || chunk.text.toLowerCase().includes(query.toLowerCase()) || chunk.title.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 12);

  return (
    <main className="app-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">IPO Hero · Reviewer / QA</p>
          <h1>SpaceX S-1 analysis workbench</h1>
          <p className="lede">Source-cited ingestion outputs for a single SEC filing. No recommendations, scores, or investment advice.</p>
        </div>
        <div className="flex items-center gap-2">
          <SpacexPriceTicker />
          <Link className="source-link" to="/" aria-label="Back to reader brief">
            ← Reader Brief
          </Link>
          <Link className="source-link" to="/forums" aria-label="Open community forums">
            Forums
          </Link>
          <a className="source-link" href={filingData.report.filingUrl} target="_blank" rel="noreferrer" aria-label="Open SEC filing source">
            SEC source <ExternalLink size={16} aria-hidden="true" />
          </a>
          <ThemeToggle />
        </div>
      </header>

      <section className="summary-grid" aria-label="Ingestion summary">
        <SummaryCard label="State" value={titleCase(state)} tone={state === "success" ? "good" : state === "error" ? "warn" : "muted"} />
        <SummaryCard label="Documents" value={formatNumber(filingData.report.documentCount)} />
        <SummaryCard label="Sections" value={formatNumber(filingData.report.sectionCount)} />
        <SummaryCard label="Chunks" value={formatNumber(filingData.report.chunkCount)} />
        <SummaryCard label="Facts" value={formatNumber(filingData.report.factCount)} />
        <SummaryCard label="Risk factors" value={formatNumber(filingData.report.riskFactorCount)} />
      </section>

      <nav className="tab-row" aria-label="Workbench views">
        <button className={viewMode === "brief" ? "tab-button is-active" : "tab-button"} type="button" onClick={() => setViewMode("brief")}>
          Brief
        </button>
        <button className={viewMode === "workbench" ? "tab-button is-active" : "tab-button"} type="button" onClick={() => setViewMode("workbench")}>
          Extraction Workbench
        </button>
      </nav>

      {viewMode === "brief" ? <BriefView /> : (
        <>

      <section className="panel warnings-panel" aria-label="Warnings and parser notes">
        <div className="section-title">
          <AlertTriangle size={18} aria-hidden="true" />
          <h2>Warnings</h2>
        </div>
        {filingData.report.warnings.length === 0 && filingData.report.errors.length === 0 ? (
          <p className="muted-text">No warnings or fatal parser errors were reported.</p>
        ) : (
          <ul>
            {[...filingData.report.errors, ...filingData.report.warnings].map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel warnings-panel" aria-label="Diagnostics summary">
        <h2>Diagnostics</h2>
        <div className="summary-grid">
          <SummaryCard label="Missing golden checks" value={formatNumber(filingData.diagnostics.missingExpectedSections.length)} tone={filingData.diagnostics.missingExpectedSections.length ? "warn" : "good"} />
          <SummaryCard label="Needs-review facts" value={formatNumber(filingData.diagnostics.factsMissingReview.length)} tone="muted" />
          <SummaryCard label="Suspicious risks" value={formatNumber(filingData.diagnostics.suspiciousRiskFactors.length)} tone="warn" />
          <SummaryCard label="Unassociated tables" value={formatNumber(filingData.diagnostics.tableExtractionSummary.unassociated)} tone={filingData.diagnostics.tableExtractionSummary.unassociated ? "warn" : "good"} />
        </div>
        {filingData.diagnostics.missingExpectedSections.length > 0 ? (
          <ul>
            {filingData.diagnostics.missingExpectedSections.map((check) => (
              <li key={check.id}>{check.label}: {check.diagnostic}</li>
            ))}
          </ul>
        ) : (
          <p className="muted-text">All hand-authored golden checks were found.</p>
        )}
      </section>

      <section className="workbench-grid">
        <aside className="panel section-browser" aria-label="Section browser">
          <div className="section-title">
            <FileText size={18} aria-hidden="true" />
            <h2>Sections</h2>
          </div>
          <div className="section-list" role="list">
            {filingData.sections.map((section) => (
              <button
                className={section.id === selectedSection?.id ? "section-button is-active" : "section-button"}
                key={section.id}
                onClick={() => setSelectedSectionId(section.id)}
                type="button"
              >
                <span>{section.title}</span>
                <small>{formatNumber(section.text.length)} chars</small>
              </button>
            ))}
          </div>
        </aside>

        <section className="panel source-viewer" aria-label="Source chunk viewer">
          <h2>{selectedSection?.title ?? "No section selected"}</h2>
          <p className="muted-text">{selectedSection?.sourceUrl}</p>
          {selectedChunks.length === 0 ? (
            <p className="empty-state">No chunks were generated for this section.</p>
          ) : (
            selectedChunks.map((chunk) => (
              <article className="chunk" key={chunk.id}>
                <div className="chunk-meta">
                  <Badge>{chunk.chunkType}</Badge>
                  <span>{chunk.tokenEstimate} estimated tokens</span>
                </div>
                <p>{chunk.text}</p>
              </article>
            ))
          )}
        </section>
      </section>

      <section className="panel" aria-label="Extracted facts">
        <h2>Extracted Facts</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Label</th>
                <th>Category</th>
                <th>Confidence</th>
                <th>Value</th>
                <th>Sources</th>
              </tr>
            </thead>
            <tbody>
              {filingData.facts.map((fact) => (
                <tr key={fact.id}>
                  <td>{fact.label}</td>
                  <td>{titleCase(fact.category)}</td>
                  <td>
                    <Badge tone={fact.confidence === "high" ? "good" : fact.confidence === "low" ? "warn" : "muted"}>{fact.confidence}</Badge>
                  </td>
                  <td>{fact.valueText}</td>
                  <td>{fact.sourceChunkIds.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" aria-label="Risk factor list">
        <div className="risk-toolbar">
          <h2>Risk Factors</h2>
          <label>
            <span>Category</span>
            <select value={riskCategory} onChange={(event) => setRiskCategory(event.target.value)}>
              {riskCategories.map((category) => (
                <option key={category} value={category}>
                  {titleCase(category)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="risk-list">
          {visibleRisks.map((risk) => (
            <article className="risk-item" key={risk.id}>
              <div className="chunk-meta">
                <Badge tone="muted">{risk.category}</Badge>
                <Badge tone={risk.specificity === "company_specific" ? "good" : risk.specificity === "generic" ? "warn" : "default"}>{risk.specificity}</Badge>
              </div>
              <h3>{risk.title}</h3>
              <p>{risk.plainEnglish}</p>
              <p className="muted-text">{risk.whyItMatters}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="panel" aria-label="Chunk search">
        <div className="search-box">
          <Search size={18} aria-hidden="true" />
          <label>
            <span>Search chunks</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search extracted source text" />
          </label>
        </div>
        <div className="risk-list">
          {searchedChunks.map((chunk) => (
            <article className="chunk" key={chunk.id}>
              <div className="chunk-meta">
                <Badge>{chunk.title}</Badge>
                <span>{chunk.id}</span>
              </div>
              <p>{chunk.text}</p>
            </article>
          ))}
        </div>
      </section>
        </>
      )}
    </main>
  );
}

function BriefView() {
  return (
    <section className="brief-stack" aria-label="Generated retail investor brief">
      <article className="panel">
        <h2>{filingData.brief.title}</h2>
        <p>{filingData.brief.disclaimer}</p>
        <div className="summary-grid">
          {Object.entries(filingData.brief.snapshot).map(([key, value]) => (
            <SummaryCard key={key} label={titleCase(key)} value={`${value ?? "unknown"}`} tone="muted" />
          ))}
        </div>
      </article>
      {filingData.brief.sections.map((section) => (
        <article className="panel" key={section.id}>
          <h2>{section.title}</h2>
          <p>{section.summary}</p>
          {section.warnings.length > 0 ? (
            <ul>
              {section.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
          <div className="risk-list">
            {section.items.map((item) => (
              <article className="chunk" key={item.id}>
                <div className="chunk-meta">
                  <Badge tone={item.confidence === "high" ? "good" : item.confidence === "low" ? "warn" : "muted"}>{item.confidence}</Badge>
                  {item.needsReview ? <Badge tone="warn">needs review</Badge> : null}
                </div>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
                {item.whyItMatters ? <p className="muted-text">{item.whyItMatters}</p> : null}
                {item.citations.map((citation) => (
                  <details className="citation-detail" key={`${item.id}-${citation.chunkId}`}>
                    <summary>{citation.chunkId}</summary>
                    <p>{citation.quote}</p>
                  </details>
                ))}
              </article>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}

function SummaryCard({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "good" | "warn" | "muted" }) {
  return (
    <article className="summary-card">
      <span>{label}</span>
      <strong>
        <Badge tone={tone}>{value}</Badge>
      </strong>
    </article>
  );
}

export default App;
