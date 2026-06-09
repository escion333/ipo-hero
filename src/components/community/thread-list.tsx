import { useMemo, useState } from "react";
import { MessagesSquare, Plus } from "lucide-react";

import type { ThreadListItem, ThreadSort, VoteValue } from "../../lib/community/types";
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
  /** Loaded filing sections, for the section filter + resolving anchor titles. */
  sections?: { id: string; title: string }[];
  sectionHref?: (sectionId: string) => string;
  /** Map of threadId -> the viewer's vote, for highlighting cast votes. */
  myVotes?: Record<string, VoteValue>;
  canVote?: boolean;
  /** Card density forwarded to each ThreadCard. */
  density?: "comfortable" | "compact";
  /**
   * Controlled section filter: "all" | "general" | a sectionId. When provided the
   * list is controlled (e.g. driven by a "Discuss this section" click in the Brief);
   * pair with onFilterChange. Omit for self-managed filtering.
   */
  filter?: string;
  sort?: ThreadSort;
  onFilterChange?: (filter: string) => void;
  onSortChange?: (sort: ThreadSort) => void;
  onOpen?: (threadId: string) => void;
  onVote?: (threadId: string, value: VoteValue) => void;
  /** Render a "New thread" affordance when provided. */
  onNewThread?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
};

export function ThreadList({
  threads,
  sections = [],
  sectionHref,
  myVotes,
  canVote = true,
  density = "comfortable",
  filter: filterProp,
  sort: sortProp,
  onFilterChange,
  onSortChange,
  onOpen,
  onVote,
  onNewThread,
  hasMore,
  loadingMore,
  onLoadMore,
}: ThreadListProps) {
  const [sortState, setSortState] = useState<ThreadSort>("score");
  const [filterState, setFilterState] = useState<string>("all"); // "all" | "general" | sectionId
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

  const titleById = useMemo(
    () => new Map(sections.map((s) => [s.id, s.title])),
    [sections],
  );
  const activeSectionTitle =
    filter === "all" || filter === "general" ? null : titleById.get(filter) ?? null;

  const visible = useMemo(() => {
    const filtered = threads.filter((t) => {
      if (filter === "all") return true;
      if (filter === "general") return t.sectionId === null;
      return t.sectionId === filter;
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
            <Label htmlFor="thread-filter">Section</Label>
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger id="thread-filter" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All discussions</SelectItem>
                <SelectItem value="general">General</SelectItem>
                {sections.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.title}
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
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-card/50 py-12 text-center">
          <MessagesSquare className="size-6 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">No discussions here yet.</p>
          {onNewThread ? (
            <Button type="button" variant="outline" size="sm" onClick={onNewThread}>
              Start the first thread
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((thread) => (
            <ThreadCard
              key={thread.id}
              thread={thread}
              sectionTitle={thread.sectionId ? titleById.get(thread.sectionId) : null}
              sectionHref={sectionHref}
              myVote={myVotes?.[thread.id] ?? null}
              canVote={canVote}
              density={density}
              hideSectionAnchor={Boolean(activeSectionTitle)}
              onOpen={onOpen}
              onVote={onVote}
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
