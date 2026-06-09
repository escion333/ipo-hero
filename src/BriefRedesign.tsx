import {
  ArrowUpRight,
  Banknote,
  Building2,
  Clock,
  FileText,
  Landmark,
  MessagesSquare,
  Quote,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import { useEffect, useState } from "react";
import starshipUrl from "./assets/starship.webp";
import { useSpacexPrice } from "./hooks/use-spacex-price";
import { briefData } from "./lib/brief-data";
import {
  deriveKpis,
  heroItems,
  prettifySection,
  readerSections,
  type ReaderSection,
} from "./lib/brief-derive";
import "./brief-redesign.css";

/**
 * SPCX IPO offering price, fixed at $135.00/share — the same constant the chrome
 * price pills use. A disclosed figure, not a quote, valuation, or recommendation.
 */
const IPO_PRICE_USD = 135;

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Format a filing date string ("2026-05-20") as "May 20, 2026" without going
// through Date() (avoids timezone drift on a date-only value).
function formatFilingDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const [, year, month, day] = m;
  const name = MONTHS[Number(month) - 1];
  return name ? `${name} ${Number(day)}, ${year}` : iso;
}

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

// ---- Market-open countdown (next Friday 9:30 AM America/New_York) ----
const NY_TZ = "America/New_York";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Wall-clock parts of an absolute instant as seen in New York.
function etParts(instant: number) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: NY_TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });
  const m: Record<string, string> = {};
  for (const p of dtf.formatToParts(instant)) m[p.type] = p.value;
  return {
    year: Number(m.year),
    month: Number(m.month),
    day: Number(m.day),
    hour: m.hour === "24" ? 0 : Number(m.hour),
    minute: Number(m.minute),
    second: Number(m.second),
    weekday: WEEKDAYS.indexOf(m.weekday),
  };
}

// Absolute instant for an ET wall-clock time, DST-correct via offset refinement.
function etInstant(y: number, mo: number, d: number, h: number, mi: number): number {
  const base = Date.UTC(y, mo - 1, d, h, mi, 0);
  let instant = base;
  for (let i = 0; i < 2; i++) {
    const p = etParts(instant);
    const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    instant = base - (asUTC - instant);
  }
  return instant;
}

// Next Friday 9:30 AM ET strictly in the future of `nowMs`.
function nextFridayOpen(nowMs: number): number {
  const p = etParts(nowMs);
  const dayUTC = Date.UTC(p.year, p.month - 1, p.day);
  let addDays = (5 - p.weekday + 7) % 7;
  for (let i = 0; i < 2; i++) {
    const cal = new Date(dayUTC + addDays * 86_400_000);
    const target = etInstant(cal.getUTCFullYear(), cal.getUTCMonth() + 1, cal.getUTCDate(), 9, 30);
    if (target > nowMs) return target;
    addDays += 7;
  }
  return nowMs;
}

// Ticking countdown to the next Friday market open. A neutral clock — not a
// trading signal or event claim, just time until US markets next open.
function MarketCountdown() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const diff = Math.max(0, nextFridayOpen(now) - now);
  const total = Math.floor(diff / 1000);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <div
      className="bx-countdown"
      role="timer"
      aria-label={`US markets open Friday in ${days} days, ${hours} hours, ${mins} minutes`}
    >
      <Clock size={13} aria-hidden="true" />
      <span className="bx-countdown-label">Markets open Friday</span>
      <span className="bx-countdown-time" aria-hidden="true">
        {days > 0 ? `${days}d ` : ""}
        {pad(hours)}h {pad(mins)}m {pad(secs)}s
      </span>
    </div>
  );
}

// Hero pricing strip: the disclosed IPO offering price alongside the live
// pre-market mid (Hyperliquid xyz DEX). Disclosed + market data only — never a
// recommendation. Mirrors the framing of the chrome SpacexPrice pill.
function HeroStats() {
  const { price, direction, status } = useSpacexPrice();
  const hasPrice = price != null;
  const note =
    status === "live" ? "Hyperliquid · live" : status === "stale" ? "Hyperliquid · delayed" : "Hyperliquid · connecting";
  return (
    <dl className="bx-stats">
      <div className="bx-stat">
        <dt className="bx-stat-label">IPO price</dt>
        <dd className="bx-stat-value">{usd.format(IPO_PRICE_USD)}</dd>
        <span className="bx-stat-note">Fixed per share</span>
      </div>
      <div className="bx-stat" data-dir={direction}>
        <dt className="bx-stat-label">
          <span className={`bx-stat-dot is-${status}`} aria-hidden="true" />
          Pre-market
        </dt>
        <dd className="bx-stat-value bx-stat-live">
          {hasPrice ? usd.format(price) : "—"}
          {hasPrice && direction !== "flat" ? (
            <span className="bx-stat-arrow" aria-hidden="true">
              {direction === "up" ? "▲" : "▼"}
            </span>
          ) : null}
        </dd>
        <span className="bx-stat-note">{note}</span>
      </div>
    </dl>
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
      {/* ---------- Hero — cosmic banner ---------- */}
      <header className="bx-hero">
        <div className="bx-hero-bg" aria-hidden="true" />
        <img className="bx-hero-rocket" src={starshipUrl} alt="" aria-hidden="true" />
        <div className="bx-hero-inner">
          <div className="bx-hero-content">
            <div className="bx-meta">
              <span className="bx-chip">Form {snap.formType}</span>
              <span className="bx-chip">Filed {formatFilingDate(snap.filingDate)}</span>
            </div>
            <h1 className="bx-hero-title">SpaceX</h1>
            <p className="bx-hero-legal">{snap.companyName}</p>
            <HeroStats />
            <MarketCountdown />
            <a className="bx-source" href={snap.sourceFilingUrl} target="_blank" rel="noreferrer">
              <FileText size={15} aria-hidden="true" /> View the filing on SEC.gov
              <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          </div>
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
