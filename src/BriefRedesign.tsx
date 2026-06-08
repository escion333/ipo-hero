import {
  AlertTriangle,
  ArrowUpRight,
  Banknote,
  BookOpen,
  Building2,
  CircleHelp,
  FileText,
  Landmark,
  Lock,
  MessagesSquare,
  Quote,
  Scale,
  ShieldAlert,
  Users,
  Wallet,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ThemeToggle } from "./components/theme/theme-toggle";
import { briefData } from "./lib/brief-data";
import {
  bodySections,
  deriveKpis,
  heroItems,
  needsReviewCount,
  prettifySection,
} from "./lib/brief-derive";
import "./brief-redesign.css";

type BriefSection = (typeof briefData.sections)[number];
type BriefItem = BriefSection["items"][number];
type BriefDiscussion = { count: number; onDiscuss: () => void };

type BriefProps = {
  getSectionDiscussion?: (section: BriefSection) => BriefDiscussion | null;
};

const SECTION_ICON: Record<string, typeof FileText> = {
  "What SpaceX Says It Does": Building2,
  "Offering Mechanics": FileText,
  "Financial Snapshot": Banknote,
  "Use of Proceeds": Wallet,
  "Dilution and Capitalization": Scale,
  "Control and Governance": Landmark,
  "Debt and Liquidity": Banknote,
  "Related-Party / Affiliated Transactions": Users,
  "Lockup and Future Share Overhang": Lock,
  "Key Risk Themes": ShieldAlert,
  "What Is Still Unclear or Needs Review": CircleHelp,
  "Source Notes": BookOpen,
};

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function ConfidenceDot({ level }: { level: BriefItem["confidence"] }) {
  const color =
    level === "high" ? "var(--good)" : level === "low" ? "var(--warn)" : "var(--muted-foreground)";
  return (
    <span className="bx-conf" title={`${level} confidence`}>
      <span className="bx-conf-dot" style={{ background: color }} />
      {level}
    </span>
  );
}

function Citation({ citation }: { citation: BriefItem["citations"][number] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={open ? "bx-cite is-open" : "bx-cite"}>
      <button
        className="bx-cite-trigger"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Quote size={13} aria-hidden="true" />
        <span>{prettifySection(citation.sectionId || citation.chunkId)}</span>
        <span className="bx-cite-caret" aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open ? (
        <div className="bx-cite-body">
          <p>“{citation.quote.trim()}”</p>
          <a href={citation.sourceUrl} target="_blank" rel="noreferrer" className="bx-cite-link">
            View in filing <ArrowUpRight size={13} aria-hidden="true" />
          </a>
        </div>
      ) : null}
    </div>
  );
}

function EvidenceCard({ item }: { item: BriefItem }) {
  const [showSource, setShowSource] = useState(false);
  return (
    <article className="bx-card">
      <div className="bx-card-head">
        <ConfidenceDot level={item.confidence} />
        {item.needsReview ? (
          <span className="bx-flag">
            <AlertTriangle size={12} aria-hidden="true" /> needs review
          </span>
        ) : null}
      </div>
      <h3 className="bx-card-title">{item.title}</h3>
      {item.whyItMatters ? (
        <div className="bx-takeaway">
          <span className="bx-takeaway-label">Why it matters</span>
          <p>{item.whyItMatters}</p>
        </div>
      ) : null}
      <button
        className="bx-disclosure"
        type="button"
        aria-expanded={showSource}
        onClick={() => setShowSource((v) => !v)}
      >
        {showSource ? "Hide" : "What the filing says"}
      </button>
      {showSource ? <p className="bx-card-body">{item.body}</p> : null}
      {item.citations.length > 0 ? (
        <div className="bx-cites">
          {item.citations.map((c) => (
            <Citation key={`${item.id}-${c.chunkId}`} citation={c} />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function App({ getSectionDiscussion }: BriefProps = {}) {
  const brief = briefData;
  const snap = {
    companyName: String(brief.snapshot.companyName ?? "This company"),
    formType: String(brief.snapshot.formType ?? "S-1"),
    filingDate: String(brief.snapshot.filingDate ?? "—"),
    sourceFilingUrl: String(brief.snapshot.sourceFilingUrl ?? "#"),
  };
  const kpis = deriveKpis();
  const hero = heroItems();
  const sections = bodySections();
  const reviewCount = needsReviewCount();
  const [active, setActive] = useState<string>("notice");

  useEffect(() => {
    const ids = ["notice", ...sections.map((s) => slug(s.title))];
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 },
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, [sections]);

  const navItems = [
    { id: "notice", label: hero?.section.title ?? "10 Things to Notice", review: 0 },
    ...sections.map((s) => ({
      id: slug(s.title),
      label: s.title,
      review: s.items.filter((i) => i.needsReview).length,
    })),
  ];

  return (
    <div className="bx">
      {/* ---------- Hero ---------- */}
      <header className="bx-hero">
        <div className="bx-hero-inner">
          <div className="bx-topbar">
            <p className="bx-eyebrow">IPO Hero · S-1 Brief</p>
            <div className="bx-topbar-actions">
              <Link className="bx-reviewer-top" to="/reviewer">
                Reviewer mode
              </Link>
              <Link className="bx-reviewer-top" to="/forums">
                Forums
              </Link>
              <ThemeToggle />
            </div>
          </div>
          <h1 className="bx-hero-title">{snap.companyName}</h1>
          <p className="bx-hero-sub">
            A plain-English, source-cited read of the SpaceX Form S-1 — every claim links back to the
            filing. No ratings, no recommendations.
          </p>
          <div className="bx-pills">
            <span className="bx-pill">Form {snap.formType}</span>
            <span className="bx-pill">Filed {snap.filingDate}</span>
            <span className="bx-pill bx-pill-muted">Class A common stock</span>
            <span className="bx-pill bx-pill-warn">Offering price: not yet set</span>
            <span className="bx-pill bx-pill-warn">No public market yet</span>
          </div>
          <a className="bx-source" href={snap.sourceFilingUrl} target="_blank" rel="noreferrer">
            <FileText size={15} aria-hidden="true" /> Read the original filing on SEC.gov
            <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </div>
      </header>

      {/* ---------- KPI strip ---------- */}
      {kpis.length > 0 ? (
        <section className="bx-kpis" aria-label="Headline financials">
          {kpis.map((k) => (
            <div className="bx-kpi" key={k.label} style={{ ["--kpi-accent" as string]: k.accent }}>
              <span className="bx-kpi-label">{k.label}</span>
              <span className="bx-kpi-value">{k.value}</span>
              <span className="bx-kpi-period">{k.period}</span>
            </div>
          ))}
          <p className="bx-kpi-note">
            High-confidence figures from MD&A &amp; notes. Quarterly, not annual — early-stage scale.
          </p>
        </section>
      ) : null}

      <div className="bx-layout">
        {/* ---------- Sticky TOC ---------- */}
        <nav className="bx-toc" aria-label="Brief contents">
          <p className="bx-toc-title">On this page</p>
          {navItems.map((n) => (
            <a
              key={n.id}
              href={`#${n.id}`}
              aria-current={active === n.id ? "true" : undefined}
              className={active === n.id ? "bx-toc-link is-active" : "bx-toc-link"}
            >
              <span>{n.label}</span>
              {n.review > 0 ? <span className="bx-toc-badge">{n.review}</span> : null}
            </a>
          ))}
          {reviewCount > 0 ? (
            <p className="bx-toc-foot">
              <AlertTriangle size={12} aria-hidden="true" /> {reviewCount} items flagged for human review
            </p>
          ) : null}
        </nav>

        <main className="bx-main">
          {/* ---------- Hero feed: 10 Things ---------- */}
          {hero ? (
            <section id="notice" className="bx-notice">
              <div className="bx-notice-head">
                <h2 className="bx-notice-title">{hero.section.title}</h2>
                <p className="bx-notice-sub">{hero.section.summary}</p>
              </div>
              <ol className="bx-notice-list">
                {hero.items.map((item, i) => (
                  <li className="bx-notice-item" key={item.id}>
                    <span className="bx-notice-num">{String(i + 1).padStart(2, "0")}</span>
                    <div className="bx-notice-content">
                      <h3 className="bx-notice-headline">{item.title}</h3>
                      <p className="bx-notice-why">{item.whyItMatters || item.body}</p>
                      {item.citations[0] ? (
                        <div className="bx-cites">
                          <Citation citation={item.citations[0]} />
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {/* ---------- Remaining sections ---------- */}
          {sections.map((section, idx) => {
            const Icon = SECTION_ICON[section.title] ?? FileText;
            const accent = `var(--chart-${(idx % 5) + 1})`;
            const discussion = getSectionDiscussion?.(section);
            return (
              <section id={slug(section.title)} className="bx-section" key={section.id}>
                <div className="bx-section-head">
                  <span className="bx-section-icon" style={{ color: accent }}>
                    <Icon size={18} aria-hidden="true" />
                  </span>
                  <div>
                    <h2 className="bx-section-title">{section.title}</h2>
                    {section.summary ? <p className="bx-section-sub">{section.summary}</p> : null}
                  </div>
                  {discussion ? (
                    <button className="bx-discuss" type="button" onClick={discussion.onDiscuss}>
                      <MessagesSquare size={13} aria-hidden="true" />
                      Discuss
                      {discussion.count > 0 ? (
                        <span className="bx-discuss-count">{discussion.count}</span>
                      ) : null}
                    </button>
                  ) : null}
                </div>
                {section.warnings.length > 0 ? (
                  <div className="bx-warnbox">
                    <AlertTriangle size={14} aria-hidden="true" />
                    <ul>
                      {section.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="bx-grid">
                  {section.items.map((item) => (
                    <EvidenceCard key={item.id} item={item} />
                  ))}
                </div>
              </section>
            );
          })}

          <footer className="bx-footer">
            <p className="bx-disclaimer">{brief.disclaimer}</p>
            <Link className="bx-reviewer-link" to="/reviewer">
              Switch to Reviewer / QA workbench →
            </Link>
          </footer>
        </main>
      </div>
    </div>
  );
}

export default App;
