import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowUpRight, FileText, MessagesSquare } from "lucide-react";

import "./styles.css";
import "./preview.css";
import "./brief-redesign.css";
import { ThemeToggle } from "./components/theme/theme-toggle";
import { BriefForumShell } from "./components/community";
import type { BriefForumApi } from "./components/community";
import type { ThreadListItem, VoteValue } from "./lib/community/types";
import {
  mockCurrentUser,
  mockPosts,
  mockSections,
  mockThreads,
} from "./components/community/mock-community";

// Discussion counts per filing section, derived from the mock threads — this is the
// data the real Brief would read to render "Discuss (N)" next to each section.
const COUNT_BY_SECTION = mockThreads.reduce<Record<string, number>>((acc, t) => {
  if (t.sectionId) acc[t.sectionId] = (acc[t.sectionId] ?? 0) + 1;
  return acc;
}, {});

// A trimmed stand-in for the real Brief (BriefRedesign.tsx). It exists only so this
// preview can demonstrate the segmented-toggle + per-section "Discuss" cross-link
// WITHOUT editing BriefRedesign.tsx, which the data-layer agent is actively in.
// The real wiring is a small additive prop on the Brief once that file settles.
const DEMO_SECTIONS = [
  {
    id: "sec-summary",
    title: "Control and Governance",
    summary: "Founder voting control and the dual-class structure after the offering.",
    items: [
      "Founder keeps majority voting power via high-vote Class B stock.",
      "Public Class A holders have limited say in governance decisions.",
    ],
  },
  {
    id: "sec-proceeds",
    title: "Use of Proceeds",
    summary: "What the company says it will do with the money raised.",
    items: [
      "Net proceeds earmarked for working capital and general corporate purposes.",
      "No specific split disclosed between Starship and Starlink.",
    ],
  },
  {
    id: "sec-risk",
    title: "Key Risk Themes",
    summary: "Selected, source-cited risk disclosures.",
    items: [
      "Launch failures could cause significant losses and schedule delays.",
      "Extensive FAA/FCC licensing dependence gates launch cadence.",
    ],
  },
];

function DiscussButton({ sectionId, api }: { sectionId: string; api: BriefForumApi }) {
  const count = COUNT_BY_SECTION[sectionId] ?? 0;
  return (
    <button
      type="button"
      onClick={() => api.openDiscussion(sectionId)}
      className="ml-auto inline-flex shrink-0 items-center gap-1.5 self-start rounded-full border border-border bg-secondary px-3 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary"
    >
      <MessagesSquare className="size-3.5" aria-hidden="true" />
      Discuss
      {count > 0 ? (
        <span className="rounded-full bg-primary/10 px-1.5 text-primary tabular-nums">{count}</span>
      ) : null}
    </button>
  );
}

function DemoBrief({ api }: { api: BriefForumApi }) {
  return (
    <div className="bx">
      <header className="bx-hero">
        <div className="bx-hero-inner">
          <p className="bx-eyebrow">IPO Hero · S-1 Brief (demo)</p>
          <h1 className="bx-hero-title">Space Exploration Technologies Corp.</h1>
          <p className="bx-hero-sub">
            A plain-English, source-cited read of the SpaceX Form S-1 — every claim links back to the
            filing. No ratings, no recommendations.
          </p>
          <div className="bx-pills">
            <span className="bx-pill">Form S-1</span>
            <span className="bx-pill bx-pill-warn">Offering price: not yet set</span>
          </div>
          <a className="bx-source" href="#" onClick={(e) => e.preventDefault()}>
            <FileText size={15} aria-hidden="true" /> Read the original filing on SEC.gov
            <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </div>
      </header>

      <div className="bx-layout">
        <nav className="bx-toc" aria-label="Brief contents">
          <p className="bx-toc-title">On this page</p>
          {DEMO_SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="bx-toc-link">
              <span>{s.title}</span>
            </a>
          ))}
        </nav>

        <main className="bx-main">
          {DEMO_SECTIONS.map((section) => (
            <section id={section.id} className="bx-section" key={section.id}>
              <div className="bx-section-head">
                <div>
                  <h2 className="bx-section-title">{section.title}</h2>
                  <p className="bx-section-sub">{section.summary}</p>
                </div>
                <DiscussButton sectionId={section.id} api={api} />
              </div>
              <div className="bx-grid">
                {section.items.map((text, i) => (
                  <article className="bx-card" key={i}>
                    <h3 className="bx-card-title">{text}</h3>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </main>
      </div>
    </div>
  );
}

function Preview() {
  const [signedIn, setSignedIn] = useState(true);
  const [votes, setVotes] = useState<Record<string, VoteValue>>({});

  const currentUser = signedIn ? mockCurrentUser : null;
  const threadListItems = useMemo<ThreadListItem[]>(
    () =>
      mockThreads.map(({ body, ...thread }) => ({
        ...thread,
        bodyPreview: body.slice(0, 280),
      })),
    [],
  );
  const getPosts = useMemo(() => (id: string) => mockPosts[id] ?? [], []);
  const getThread = useMemo(
    () => (id: string) => mockThreads.find((thread) => thread.id === id) ?? null,
    [],
  );
  const castVote = (id: string, value: VoteValue) =>
    setVotes((prev) => ({ ...prev, [id]: prev[id] === value ? (0 as VoteValue) : value }));

  return (
    <>
      <div className="fixed right-3 top-2 z-50 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setSignedIn((v) => !v)}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium shadow-panel transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          {signedIn ? "Signed in: Delta-V" : "Signed out"}
        </button>
        <ThemeToggle />
      </div>

      <BriefForumShell
        renderBrief={(api) => <DemoBrief api={api} />}
        threads={threadListItems}
        sections={mockSections}
        getPosts={getPosts}
        getThread={getThread}
        currentUser={currentUser}
        myVotes={votes}
        sectionHref={(id) => `#${id}`}
        onVoteThread={castVote}
        onVotePost={castVote}
        onReply={(threadId, parentPostId, body) =>
          console.log("reply", { threadId, parentPostId, body })
        }
        onCreateThread={(input) => console.log("createThread", input)}
      />
    </>
  );
}

createRoot(document.getElementById("shell-preview-root")!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
