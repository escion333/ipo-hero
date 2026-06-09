import { useEffect, useState, type ReactNode } from "react";
import { BookOpen, MessagesSquare } from "lucide-react";

import type {
  CommunityUser,
  NewThreadInput,
  Post,
  Thread,
  ThreadListItem,
  ThreadSort,
  VoteValue,
} from "../../lib/community/types";
import { cn } from "../../lib/utils";
import { SpacexPrice } from "../spacex-price";
import { Button } from "../ui/button";
import { AccountMenu } from "./account-menu";
import { NewThreadForm } from "./new-thread-form";
import { ThreadList } from "./thread-list";
import { ThreadView } from "./thread-view";
import { XLogo } from "./x-logo";

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
  threads: ThreadListItem[];
  getThread?: (threadId: string) => Thread | null;
  sections?: { id: string; title: string }[];
  getPosts?: (threadId: string) => Post[];
  sectionHref?: (sectionId: string) => string;
  currentUser?: CommunityUser | null;
  /** Session is still resolving — gates the sign-in CTAs to avoid a flash of signed-out UI. */
  authLoading?: boolean;
  /** Whether community auth is configured. When false, sign-in surfaces are suppressed. */
  communityEnabled?: boolean;
  /** threadId/postId -> the viewer's vote. */
  myVotes?: Record<string, VoteValue>;
  /** Total discussion count shown on the Forum tab badge. */
  threadCount?: number;
  threadSort?: ThreadSort;
  hasMoreThreads?: boolean;
  loadingMoreThreads?: boolean;
  hasMorePosts?: Record<string, boolean>;
  loadingMorePosts?: Record<string, boolean>;

  // ---- forum handlers (all optional → renders read-only) ----
  onVoteThread?: (threadId: string, value: VoteValue) => void;
  onVotePost?: (postId: string, value: VoteValue) => void;
  onReply?: (threadId: string, parentPostId: string | null, body: string) => void;
  onCreateThread?: (input: NewThreadInput) => Thread | void | Promise<Thread | void>;
  onThreadSortChange?: (sort: ThreadSort) => void;
  onLoadMoreThreads?: () => void;
  onLoadMorePosts?: (threadId: string) => void;
  onSignInWithX?: () => void;
  onSignInWithEmail?: (email: string) => void;
  onSignOut?: () => void;

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
  getThread,
  sections = [],
  getPosts,
  sectionHref,
  currentUser,
  authLoading,
  communityEnabled,
  myVotes,
  threadCount,
  threadSort,
  hasMoreThreads,
  loadingMoreThreads,
  hasMorePosts,
  loadingMorePosts,
  onVoteThread,
  onVotePost,
  onReply,
  onCreateThread,
  onThreadSortChange,
  onLoadMoreThreads,
  onLoadMorePosts,
  onSignInWithX,
  onSignInWithEmail,
  onSignOut,
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
    view.name === "thread" ? getThread?.(view.id) ?? null : null;

  return (
    <div className={cn("flex flex-col", className)}>
      {/* ---------- Segmented toggle (sticky global chrome) ---------- */}
      <div className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto grid min-h-14 w-full max-w-[1180px] grid-cols-[1fr_auto_1fr] items-center gap-2 px-4">
          <div className="flex items-center">
            <span className="text-[0.95rem] font-bold tracking-tight">
              IPO<span className="text-primary"> Hero</span>
            </span>
          </div>
          <div
            role="tablist"
            aria-label="Brief or discussion"
            className="inline-flex items-stretch self-stretch"
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
              label="Discussion"
              badge={threadCount ?? threads.length}
            />
          </div>
          <div className="flex items-center justify-end gap-3">
            <SpacexPrice className="hidden sm:inline-flex" />
            <AccountMenu
              user={currentUser ?? null}
              loading={authLoading}
              enabled={Boolean(communityEnabled) || Boolean(currentUser)}
              onSignInWithX={onSignInWithX}
              onSignInWithEmail={onSignInWithEmail}
              onSignOut={onSignOut}
            />
          </div>
        </div>
      </div>

      {/* ---------- Brief ---------- */}
      {tab === "brief" ? renderBrief({ openDiscussion }) : null}

      {/* ---------- Forum ---------- */}
      {tab === "forum" ? (
        <div className="mx-auto flex w-full max-w-[860px] flex-col gap-5 px-4 py-8 sm:px-6">
          <header>
            <h1 className="text-2xl font-semibold tracking-tight">Discussion</h1>
          </header>

          {!signedIn && !authLoading && view.name === "list" ? (
            communityEnabled === false ? (
              <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                Community sign-in isn&rsquo;t configured in this environment. Reading stays open to
                everyone.
              </p>
            ) : onSignInWithX ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-4 py-2.5">
                <span className="text-sm text-muted-foreground">
                  Sign in to post, reply, and vote.
                </span>
                <Button type="button" size="sm" onClick={onSignInWithX}>
                  <XLogo className="size-3.5" /> Sign in with X
                </Button>
              </div>
            ) : null
          ) : null}

          {view.name === "list" ? (
            <ThreadList
              threads={threads}
              sections={sections}
              sectionHref={sectionHref}
              myVotes={myVotes}
              canVote={signedIn}
              filter={filter}
              sort={threadSort}
              onFilterChange={(nextFilter) => {
                setFilter(nextFilter);
                onFilterChange?.(nextFilter);
              }}
              onSortChange={onThreadSortChange}
              onOpen={openThread}
              onVote={onVoteThread}
              onNewThread={signedIn ? () => setView({ name: "new" }) : undefined}
              hasMore={hasMoreThreads}
              loadingMore={loadingMoreThreads}
              onLoadMore={onLoadMoreThreads}
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
              hasMorePosts={hasMorePosts?.[activeThread.id]}
              loadingMorePosts={loadingMorePosts?.[activeThread.id]}
              onLoadMorePosts={() => onLoadMorePosts?.(activeThread.id)}
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
        "relative inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold transition-colors hover:bg-foreground/[0.04]",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
      {typeof badge === "number" ? (
        <span className="rounded-full bg-secondary px-1.5 text-xs tabular-nums text-muted-foreground">
          {badge}
        </span>
      ) : null}
      {active ? (
        <span
          aria-hidden="true"
          className="absolute bottom-0 left-1/2 h-1 w-14 -translate-x-1/2 rounded-full bg-primary"
        />
      ) : null}
    </button>
  );
}
