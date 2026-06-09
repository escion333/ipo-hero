import {
  ArrowUpRight,
  Banknote,
  Building2,
  FileText,
  Landmark,
  MessagesSquare,
  Quote,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import { useEffect, useState } from "react";
import { briefData } from "./lib/brief-data";
import {
  deriveKpis,
  heroItems,
  prettifySection,
  readerSections,
  type ReaderSection,
} from "./lib/brief-derive";
import "./brief-redesign.css";

type BriefSection = (typeof briefData.sections)[number];
type BriefItem = BriefSection["items"][number];
type BriefDiscussion = { count: number; onDiscuss: () => void };

type BriefProps = {
  getSectionDiscussion?: (section: ReaderSection) => BriefDiscussion | null;
};

const SECTION_ICON: Record<string, typeof FileText> = {
  overview: Building2,
  offering: FileText,
  financials: Banknote,
  ownership: Landmark,
  capital: Wallet,
  risks: ShieldAlert,
};

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
        <span>Source: {prettifySection(citation.sectionId || citation.chunkId)}</span>
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

function BriefEntry({ item }: { item: BriefItem }) {
  const [open, setOpen] = useState(false);
  const lead = item.whyItMatters || item.body;
  const hasFilingText = Boolean(item.whyItMatters && item.body);
  return (
    <article className="bx-item">
      <h3 className="bx-item-title">{item.title}</h3>
      {lead ? <p className="bx-item-lead">{lead}</p> : null}
      {hasFilingText ? (
        <>
          <button
            className="bx-disclosure"
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Hide filing text" : "From the filing"}
          </button>
          {open ? <p className="bx-item-body">{item.body}</p> : null}
        </>
      ) : null}
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
  const sections = readerSections();
  const [active, setActive] = useState<string>("takeaways");

  useEffect(() => {
    const ids = ["takeaways", ...sections.map((s) => s.id)];
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
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
    { id: "takeaways", label: "Key takeaways" },
    ...sections.map((s) => ({ id: s.id, label: s.title })),
  ];

  return (
    <div className="bx">
      {/* ---------- Hero ---------- */}
      <header className="bx-hero">
        <div className="bx-hero-inner">
          <h1 className="bx-hero-title">{snap.companyName}</h1>
          <p className="bx-hero-sub">
            A plain-English read of the SpaceX Form {snap.formType}. Every point links back to the
            filing.
          </p>
          <div className="bx-meta">
            <span className="bx-chip">Form {snap.formType}</span>
            <span className="bx-chip">Filed {snap.filingDate}</span>
            <span className="bx-chip">Not yet priced</span>
          </div>
          <a className="bx-source" href={snap.sourceFilingUrl} target="_blank" rel="noreferrer">
            <FileText size={15} aria-hidden="true" /> View the filing on SEC.gov
            <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </div>
      </header>

      {/* ---------- KPI strip ---------- */}
      {kpis.length > 0 ? (
        <section className="bx-kpis" aria-label="Headline financials">
          {kpis.map((k) => (
            <div className="bx-kpi" key={k.label}>
              <span className="bx-kpi-label">{k.label}</span>
              <span className="bx-kpi-value">{k.value}</span>
              <span className="bx-kpi-period">{k.period}</span>
            </div>
          ))}
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
              {n.label}
            </a>
          ))}
        </nav>

        <main className="bx-main">
          {/* ---------- Key takeaways ---------- */}
          {hero ? (
            <section id="takeaways" className="bx-notice">
              <div className="bx-notice-head">
                <h2 className="bx-notice-title">Key takeaways</h2>
                <p className="bx-notice-sub">
                  The points most worth knowing — each links straight to the filing.
                </p>
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

          {/* ---------- Reader sections ---------- */}
          {sections.map((section) => {
            const Icon = SECTION_ICON[section.id] ?? FileText;
            const discussion = getSectionDiscussion?.(section);
            return (
              <section id={section.id} className="bx-section" key={section.id}>
                <div className="bx-section-head">
                  <span className="bx-section-icon">
                    <Icon size={18} aria-hidden="true" />
                  </span>
                  <div className="bx-section-heading">
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
                <div className="bx-items">
                  {section.items.map((item) => (
                    <BriefEntry key={item.id} item={item} />
                  ))}
                </div>
              </section>
            );
          })}

          <footer className="bx-footer">
            <p className="bx-disclaimer">{brief.disclaimer}</p>
          </footer>
        </main>
      </div>
    </div>
  );
}

export default App;
