import { useMemo, useState } from "react";
import { MessagesSquare, Plus } from "lucide-react";

import type { ThreadListItem, ThreadSort, VoteValue } from "../../lib/community/types";
import { THEMES, resolveTheme, themeLabel } from "../../lib/community/themes";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { ThreadCard } from "./thread-card";

export type ThreadListProps = {
  threads: ThreadListItem[];
  /** Map of threadId -> the viewer's vote, for highlighting cast votes. */
  myVotes?: Record<string, VoteValue>;
  canVote?: boolean;
  /** Card density forwarded to each ThreadCard. */
  density?: "comfortable" | "compact";
  /**
   * Controlled theme filter: "all" | "general" | a ThemeKey. When provided the list
   * is controlled (e.g. driven by a "Discuss this section" click in the Brief); pair
   * with onFilterChange. Omit for self-managed filtering.
   */
  filter?: string;
  sort?: ThreadSort;
  onFilterChange?: (filter: string) => void;
  onSortChange?: (sort: ThreadSort) => void;
  onOpen?: (threadId: string) => void;
  onVote?: (threadId: string, value: VoteValue) => void;
  /** Moderator soft-delete of a thread. Rendered only when canModerate is true. */
  onDelete?: (threadId: string) => void;
  canModerate?: boolean;
  /** Render a "New thread" affordance when provided. */
  onNewThread?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
};

export function ThreadList({
  threads,
  myVotes,
  canVote = true,
  density = "comfortable",
  filter: filterProp,
  sort: sortProp,
  onFilterChange,
  onSortChange,
  onOpen,
  onVote,
  onDelete,
  canModerate = false,
  onNewThread,
  hasMore,
  loadingMore,
  onLoadMore,
}: ThreadListProps) {
  const [sortState, setSortState] = useState<ThreadSort>("score");
  const [filterState, setFilterState] = useState<string>("all"); // "all" | "general" | ThemeKey
  const controlled = filterProp !== undefined;
  const filter = controlled ? filterProp : filterState;
  const sortControlled = sortProp !== undefined;
  const sort = sortControlled ? sortProp : sortState;
  const setFilter = (next: string) => {
    if (!controlled) setFilterState(next);
    onFilterChange?.(next);
  };
  const setSort = (next: ThreadSort) => {
    if (!sortControlled) setSortState(next);
    onSortChange?.(next);
  };

  const activeSectionTitle =
    filter === "all" || filter === "general" ? null : themeLabel(filter);

  // Only surface themes that actually have threads (plus the active one, so a
  // deep-linked-but-empty theme still shows its label rather than going blank).
  const themeOptions = useMemo(() => {
    const populated = new Set(threads.map((t) => resolveTheme(t.sectionId)));
    return THEMES.filter((t) => populated.has(t.key) || t.key === filter);
  }, [threads, filter]);

  const visible = useMemo(() => {
    const filtered = threads.filter((t) => {
      if (filter === "all") return true;
      if (filter === "general") return resolveTheme(t.sectionId) === null;
      return resolveTheme(t.sectionId) === filter;
    });
    return [...filtered].sort((a, b) =>
      sort === "score" ? b.score - a.score : b.createdAt.localeCompare(a.createdAt),
    );
  }, [threads, filter, sort]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="thread-sort">Sort</Label>
            <Select value={sort} onValueChange={(v) => setSort(v as ThreadSort)}>
              <SelectTrigger id="thread-sort" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="score">Top</SelectItem>
                <SelectItem value="recent">Most recent</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="thread-filter">Topic</Label>
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger id="thread-filter" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All discussions</SelectItem>
                <SelectItem value="general">General</SelectItem>
                {themeOptions.map((t) => (
                  <SelectItem key={t.key} value={t.key}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {onNewThread ? (
          <Button type="button" onClick={onNewThread} size="sm">
            <Plus className="size-4" /> New thread
          </Button>
        ) : null}
      </div>

      {activeSectionTitle ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-secondary/60 px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            Discussion on <span className="font-semibold text-foreground">{activeSectionTitle}</span>
          </span>
          <button
            type="button"
            onClick={() => setFilter("all")}
            className="text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
          >
            Clear filter
          </button>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-14 text-center">
          <MessagesSquare className="size-6 text-muted-foreground" aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">No discussions yet</p>
            <p className="text-sm text-muted-foreground">Be the first to share your read of the filing.</p>
          </div>
          {onNewThread ? (
            <Button type="button" size="sm" onClick={onNewThread}>
              Start a discussion
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((thread) => (
            <ThreadCard
              key={thread.id}
              thread={thread}
              sectionTitle={themeLabel(thread.sectionId)}
              myVote={myVotes?.[thread.id] ?? null}
              canVote={canVote}
              density={density}
              hideSectionAnchor={Boolean(activeSectionTitle)}
              onOpen={onOpen}
              onVote={onVote}
              onDelete={onDelete}
              canModerate={canModerate}
            />
          ))}
          {hasMore ? (
            <Button
              type="button"
              variant="outline"
              className="self-center"
              disabled={loadingMore}
              onClick={onLoadMore}
            >
              {loadingMore ? "Loading..." : "Load more"}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
