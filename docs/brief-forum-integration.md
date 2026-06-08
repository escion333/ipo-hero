# Brief + Forum Integration — Handoff (frontend → data/routing agent)

Status: **implemented; integrated shell mounted in router**
Last updated: 2026-06-08

This is a handoff from the frontend/presentation work to the agent owning routing
(`src/main.tsx`) and the Brief data refactor (`src/lib/brief-data.ts`,
`BriefRedesign.tsx`). It supersedes the "forums as a separate page" assumption in
[community-platform-plan.md](community-platform-plan.md) §8 — see the decision below.

---

## 1. Decision: forum is a *tab on the Brief page*, not a separate route

The product direction is a **single page with a segmented Brief / Community toggle**
(plan §9's "surface forum activity in the reader" question, resolved toward merge).

What this changes vs. your current direction:

- **Drop the standalone `/forums` page** as a *separate view*. The "Forums" topbar
  link you added in `BriefRedesign.tsx` and the `/forums` route should now mount the
  **same shell** with its Community tab active (see §3 routing map). Deep-linkable
  thread URLs are preserved — the shell accepts `initialTab` / `initialThreadId`.
- The Brief and Forum are never on screen at the same time (full width each), so the
  voice boundary stays crisp; the forum carries a persistent `ForumDisclaimer`.

If you disagree with the merge, flag it — but the components below work either way; a
separate `/forums` page can just render `<BriefForumShell initialTab="forum" .../>`.

## 2. What's already built (frontend lane — done, typecheck + lint green)

All under `src/components/community/` (presentational; props + callbacks only):

| Component | Role |
| --- | --- |
| `BriefForumShell` | The segmented-toggle shell. Owns view state (tab, list/thread/new, section filter). Exposes `openDiscussion(sectionId)` to the Brief via a render prop. |
| `ThreadList` / `ThreadCard` | Thread list (sort + section filter, **controlled filter** supported) and cards (`density="compact"` available). |
| `ThreadView` / `PostItem` | Thread detail + recursive nested replies (`buildPostTree`). |
| `NewThreadForm` / `ReplyForm` | Write-path forms (validate input, emit `NewThreadInput` / body). |
| `SignInPrompt` | Auth gate (X primary + email/OTP fallback). Shown in place of write controls when logged out. |
| `ForumDisclaimer`, `VoteControl`, `UserChip`, `SectionAnchor` | Primitives. |

All import domain types from your `src/lib/community/types.ts` — no shape drift.

**Live preview** (mock data, no backend): run `npm run dev` →
`http://localhost:5173/community-shell-preview.html`. Demonstrates the toggle, the
per-section "Discuss (N) →" cross-link, the pre-filtered forum, and the logged-out
write gate. The standalone forum components have their own harness at
`/community-preview.html`.

## 3. Implemented wiring

### a) Mount the shell in the router (`src/main.tsx` — your lane)

```tsx
import { BriefForumShell } from "./components/community";
import { getCommunityClient } from "./lib/community/client";

function CommunityPage({ initialTab, initialThreadId }: {
  initialTab?: "brief" | "forum"; initialThreadId?: string;
}) {
  // load threads / posts / current user from getCommunityClient() here
  // (or a thin hook), then:
  return (
    <BriefForumShell
      initialTab={initialTab}
      initialThreadId={initialThreadId}
      renderBrief={(api) => <BriefRedesign getSectionDiscussion={mkDiscussion(api)} />}
      threads={threads}
      sections={sections}               // FilingSection[] mapped to { id, title }
      getPosts={(id) => postsByThread[id] ?? []}
      currentUser={user}
      myVotes={myVotes}
      sectionHref={(id) => `/#${id}`}    // or your reader anchor
      onVoteThread={(id, v) => client.vote({ type: "thread", id }, v)}
      onVotePost={(id, v) => client.vote({ type: "post", id }, v)}
      onReply={(threadId, parentPostId, body) =>
        client.createPost({ threadId, parentPostId, body })}
      onCreateThread={(input) => client.createThread(input)}
      onSignInWithX={() => client.signInWithX()}
      onSignInWithEmail={(email) => client.signInWithEmail(email)}
      onTabChange={(tab) => navigate(tab === "forum" ? "/forums" : "/")}
    />
  );
}
```

Suggested route map (one page, deep-linkable):

| Route | Mount |
| --- | --- |
| `/` | `<CommunityPage initialTab="brief" />` |
| `/forums` | `<CommunityPage initialTab="forum" />` |
| `/forums/thread/:id` | `<CommunityPage initialTab="forum" initialThreadId={id} />` |

`onTabChange` is the hook to keep the URL in sync when the user clicks the toggle.
(Two-way URL↔state sync beyond initial mount is yours to add if you want it.)

### b) One additive, backwards-compatible edit to `BriefRedesign.tsx` (your lane now)

The Brief just needs to *optionally* render a "Discuss" affordance per section. When
the prop is absent, the Brief renders exactly as today.

**Add to the Brief's props (it currently takes none):**

```tsx
type BriefDiscussion = { count: number; onDiscuss: () => void };

type BriefProps = {
  /** Per-section Discuss affordance, or null to hide it. Absent → no buttons. */
  getSectionDiscussion?: (section: { id: string; title: string }) => BriefDiscussion | null;
};

function App({ getSectionDiscussion }: BriefProps = {}) { /* ... */ }
```

**Render it inside the existing `.bx-section-head`** (it's already a flex row):

```tsx
<div className="bx-section-head">
  <span className="bx-section-icon" style={{ color: accent }}><Icon size={18} /></span>
  <div>
    <h2 className="bx-section-title">{section.title}</h2>
    {section.summary ? <p className="bx-section-sub">{section.summary}</p> : null}
  </div>
  {(() => {
    const d = getSectionDiscussion?.({ id: section.id, title: section.title });
    return d ? (
      <button type="button" className="bx-discuss" onClick={d.onDiscuss}>
        <MessagesSquare size={13} aria-hidden="true" /> Discuss
        {d.count > 0 ? <span className="bx-discuss-count">{d.count}</span> : null}
      </button>
    ) : null;
  })()}
</div>
```

Suggested CSS for `src/brief-redesign.css` (scoped, matches the existing token style):

```css
.bx-discuss {
  margin-left: auto; align-self: flex-start;
  display: inline-flex; align-items: center; gap: 0.35rem;
  padding: 0.3rem 0.7rem; border-radius: 999px;
  border: 1px solid var(--border); background: var(--secondary);
  color: var(--muted-foreground); font-size: 0.76rem; font-weight: 600;
  cursor: pointer; white-space: nowrap;
  transition: border-color var(--duration-fast) var(--ease-emphasized),
    color var(--duration-fast) var(--ease-emphasized);
}
.bx-discuss:hover { border-color: var(--primary); color: var(--primary); }
.bx-discuss-count {
  padding: 0 0.4rem; border-radius: 999px;
  background: color-mix(in srgb, var(--primary) 12%, transparent);
  color: var(--primary); font-variant-numeric: tabular-nums;
}
```

### c) The one real data question: brief section → forum section mapping

This is yours because it depends on the `brief-data` refactor you did. The taxonomies
differ:

- **Brief sections** are editorial groupings (e.g. "Key Risk Themes", "Use of
  Proceeds") with their own ids.
- **Forum threads** are scoped to `FilingSection.id` (`section_id` in the schema).

So `mkDiscussion(api)` (used in §3a) must map a brief section to the filing section(s)
its content cites, and count threads for that filing section:

```tsx
const mkDiscussion = (api: BriefForumApi) =>
  (section: { id: string; title: string }) => {
    const filingSectionId = mapBriefSectionToFilingSection(section); // your call
    if (!filingSectionId) return null;
    const count = threads.filter((t) => t.sectionId === filingSectionId).length;
    return { count, onDiscuss: () => api.openDiscussion(filingSectionId) };
  };
```

A brief section's items carry `citations[].sectionId`, so the simplest mapping is "the
most-cited filing section in this brief section." Pick whatever fits `brief-data`.

## 4. Boundaries (so we don't collide)

- **Mine (done, don't need to touch):** everything in `src/components/community/`,
  the two preview harnesses + their HTML.
- **Yours:** `src/main.tsx` routing, `src/lib/community/*` (client/auth/data), the
  `BriefRedesign.tsx` prop edit above, the `brief-redesign.css` snippet, and the
  brief→filing section mapping.
- The shell never imports `BriefRedesign` or the router — it stays presentational, so
  it can't fight your routing work.

Ping me if the prop contract needs to change shape and I'll adjust the shell.
