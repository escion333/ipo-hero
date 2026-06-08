import { useEffect, useState, type ReactNode } from "react";
import { BookOpen, MessagesSquare } from "lucide-react";

import type {
  CommunityUser,
  NewThreadInput,
  Post,
  Thread,
  VoteValue,
} from "../../lib/community/types";
import { cn } from "../../lib/utils";
import { ForumDisclaimer } from "./forum-disclaimer";
import { NewThreadForm } from "./new-thread-form";
import { SignInPrompt } from "./sign-in-prompt";
import { ThreadList } from "./thread-list";
import { ThreadView } from "./thread-view";

/** API handed to the Brief so section "Discuss" links can drive the forum. */
export type BriefForumApi = {
  /** Jump to the forum filtered to a section (null = general discussion). */
  openDiscussion: (sectionId: string | null) => void;
};

type Tab = "brief" | "forum";
type ForumView = { name: "list" } | { name: "thread"; id: string } | { name: "new" };

export type BriefForumShellProps = {
  /** Render the Brief; receives the API to cross-link into the forum. */
  renderBrief: (api: BriefForumApi) => ReactNode;

  // ---- forum data ----
  threads: Thread[];
  sections?: { id: string; title: string }[];
  getPosts?: (threadId: string) => Post[];
  sectionHref?: (sectionId: string) => string;
  currentUser?: CommunityUser | null;
  /** threadId/postId -> the viewer's vote. */
  myVotes?: Record<string, VoteValue>;
  /** Total discussion count shown on the Forum tab badge. */
  threadCount?: number;

  // ---- forum handlers (all optional → renders read-only) ----
  onVoteThread?: (threadId: string, value: VoteValue) => void;
  onVotePost?: (postId: string, value: VoteValue) => void;
  onReply?: (threadId: string, parentPostId: string | null, body: string) => void;
  onCreateThread?: (input: NewThreadInput) => Thread | void | Promise<Thread | void>;
  onSignInWithX?: () => void;
  onSignInWithEmail?: (email: string) => void;

  // ---- route-driven mount (lets a router deep-link into the single page) ----
  /** Which tab to open on mount. Map "/" → "brief", "/forums" → "forum". */
  initialTab?: "brief" | "forum";
  /** Open straight to a thread (e.g. "/forums/thread/:id"); implies the forum tab. */
  initialThreadId?: string;
  /** Pre-apply a section filter ("all" | "general" | sectionId). */
  initialFilter?: string;
  /** Fires when the active tab changes, so the router can sync the URL if desired. */
  onTabChange?: (tab: "brief" | "forum") => void;
  /** Fires when the forum section filter changes. */
  onFilterChange?: (filter: string) => void;
  /** Fires when the user opens a thread from the list or creates a new thread. */
  onThreadOpen?: (threadId: string) => void;
  /** Fires when the user returns from a thread detail to the forum list. */
  onThreadBack?: () => void;

  className?: string;
};

/**
 * Single-page Brief + Forum shell using the segmented-toggle arrangement: one view
 * at a time, full width, with the Brief's per-section "Discuss" links jumping into
 * a pre-filtered forum. Presentational — view state lives here; data + auth come
 * from props (wired to CommunityClient by the consumer).
 *
 * Mounting/routing is intentionally not handled here: a parent decides whether this
 * is the index route or how thread deep-links map in. See the community plan §8.
 */
export function BriefForumShell({
  renderBrief,
  threads,
  sections = [],
  getPosts,
  sectionHref,
  currentUser,
  myVotes,
  threadCount,
  onVoteThread,
  onVotePost,
  onReply,
  onCreateThread,
  onSignInWithX,
  onSignInWithEmail,
  initialTab,
  initialThreadId,
  initialFilter,
  onTabChange,
  onFilterChange,
  onThreadOpen,
  onThreadBack,
  className,
}: BriefForumShellProps) {
  const [tab, setTabState] = useState<Tab>(
    initialTab ?? (initialThreadId ? "forum" : "brief"),
  );
  const [view, setView] = useState<ForumView>(
    initialThreadId ? { name: "thread", id: initialThreadId } : { name: "list" },
  );
  const [filter, setFilter] = useState<string>(initialFilter ?? "all"); // "all" | "general" | sectionId

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (initialThreadId) {
        setTabState("forum");
        setView({ name: "thread", id: initialThreadId });
        return;
      }
      setTabState(initialTab ?? "brief");
      setView({ name: "list" });
      setFilter(initialFilter ?? "all");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialFilter, initialTab, initialThreadId]);

  const setTab = (next: Tab) => {
    setTabState(next);
    onTabChange?.(next);
  };

  const signedIn = Boolean(currentUser);
  const titleById = new Map(sections.map((s) => [s.id, s.title]));

  const openDiscussion = (sectionId: string | null) => {
    const nextFilter = sectionId ?? "general";
    setFilter(nextFilter);
    onFilterChange?.(nextFilter);
    setView({ name: "list" });
    setTab("forum");
  };

  const openThread = (id: string) => {
    setView({ name: "thread", id });
    onThreadOpen?.(id);
  };

  const backToList = () => {
    setView({ name: "list" });
    onThreadBack?.();
  };

  const activeThread =
    view.name === "thread" ? threads.find((t) => t.id === view.id) ?? null : null;

  return (
    <div className={cn("flex flex-col", className)}>
      {/* ---------- Segmented toggle (sticky global chrome) ---------- */}
      <div className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1180px] items-center justify-center px-4 py-2">
          <div
            role="tablist"
            aria-label="Brief or community"
            className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary/60 p-1"
          >
            <SegButton
              active={tab === "brief"}
              onClick={() => setTab("brief")}
              icon={<BookOpen className="size-4" aria-hidden="true" />}
              label="Brief"
            />
            <SegButton
              active={tab === "forum"}
              onClick={() => setTab("forum")}
              icon={<MessagesSquare className="size-4" aria-hidden="true" />}
              label="Community"
              badge={threadCount ?? threads.length}
            />
          </div>
        </div>
      </div>

      {/* ---------- Brief ---------- */}
      {tab === "brief" ? renderBrief({ openDiscussion }) : null}

      {/* ---------- Forum ---------- */}
      {tab === "forum" ? (
        <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-4 py-6 sm:px-6">
          <header className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold tracking-tight">Community discussion</h1>
            <p className="text-sm text-muted-foreground">
              Reader debate on the SpaceX S-1. Browsing is open to everyone.
            </p>
          </header>
          <ForumDisclaimer />

          {!signedIn ? (
            <SignInPrompt
              title="Sign in to join the community"
              description="Browsing is open to everyone. Posting, replying, and voting need a quick sign-in."
              onSignInWithX={onSignInWithX}
              onSignInWithEmail={onSignInWithEmail}
            />
          ) : null}

          {view.name === "list" ? (
            <ThreadList
              threads={threads}
              sections={sections}
              sectionHref={sectionHref}
              myVotes={myVotes}
              canVote={signedIn}
              filter={filter}
              onFilterChange={(nextFilter) => {
                setFilter(nextFilter);
                onFilterChange?.(nextFilter);
              }}
              onOpen={openThread}
              onVote={onVoteThread}
              onNewThread={signedIn ? () => setView({ name: "new" }) : undefined}
            />
          ) : null}

          {view.name === "thread" && activeThread ? (
            <ThreadView
              thread={activeThread}
              posts={getPosts?.(activeThread.id) ?? []}
              sectionTitle={
                activeThread.sectionId ? titleById.get(activeThread.sectionId) : null
              }
              sectionHref={sectionHref}
              currentUser={currentUser}
              myVotes={myVotes}
              onBack={backToList}
              onVoteThread={(value) => onVoteThread?.(activeThread.id, value)}
              onVotePost={onVotePost}
              onReply={(parentPostId, body) => onReply?.(activeThread.id, parentPostId, body)}
              onSignInWithX={onSignInWithX}
              onSignInWithEmail={onSignInWithEmail}
            />
          ) : null}

          {view.name === "new" ? (
            <NewThreadForm
              sections={sections}
              defaultSectionId={filter === "all" || filter === "general" ? null : filter}
              onSubmit={async (input) => {
                const created = await onCreateThread?.(input);
                if (created?.id) openThread(created.id);
                else setView({ name: "list" });
              }}
              onCancel={() => setView({ name: "list" })}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SegButton({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors",
        active
          ? "bg-background text-foreground shadow-panel"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
      {typeof badge === "number" ? (
        <span
          className={cn(
            "rounded-full px-1.5 text-xs tabular-nums",
            active ? "bg-secondary text-muted-foreground" : "bg-transparent",
          )}
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
}
