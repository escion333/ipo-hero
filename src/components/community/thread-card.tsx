import { Lock, MessageSquare } from "lucide-react";

import type { Thread, VoteValue } from "../../lib/community/types";
import { cn } from "../../lib/utils";
import { compactCount, relativeTime } from "./format";
import { SectionAnchor } from "./section-anchor";
import { UserChip } from "./user-chip";
import { VoteControl } from "./vote-control";

export type ThreadCardProps = {
  thread: Thread;
  /** Human title for thread.sectionId, resolved by the parent against loaded sections. */
  sectionTitle?: string | null;
  /** Builds the reader/workbench link for the thread's section anchor. */
  sectionHref?: (sectionId: string) => string;
  /** The viewer's current vote on this thread, if any. */
  myVote?: VoteValue | null;
  /** Open the thread detail view. */
  onOpen?: (threadId: string) => void;
  /** Cast a vote. Omit (or pass canVote=false) to render votes read-only. */
  onVote?: (threadId: string, value: VoteValue) => void;
  canVote?: boolean;
  /**
   * "comfortable" (default) shows the body excerpt and roomier padding.
   * "compact" drops the excerpt for dense lists, rails, and section panels.
   */
  density?: "comfortable" | "compact";
  /** Hide the section anchor (e.g. when the whole list is already scoped to one section). */
  hideSectionAnchor?: boolean;
  className?: string;
};

export function ThreadCard({
  thread,
  sectionTitle,
  sectionHref,
  myVote = null,
  onOpen,
  onVote,
  canVote = true,
  density = "comfortable",
  hideSectionAnchor = false,
  className,
}: ThreadCardProps) {
  const compact = density === "compact";
  return (
    <article
      className={cn(
        "flex rounded-lg border border-border bg-card text-card-foreground shadow-panel transition-colors hover:border-ring/60",
        compact ? "gap-2 p-3" : "gap-3 p-4",
        className,
      )}
    >
      <VoteControl
        score={thread.score}
        myVote={myVote}
        onVote={canVote && onVote ? (value) => onVote(thread.id, value) : undefined}
        disabled={!canVote || thread.isLocked}
        className="pt-0.5"
      />

      <div className={cn("flex min-w-0 flex-1 flex-col", compact ? "gap-1" : "gap-2")}>
        {hideSectionAnchor && !thread.isLocked ? null : (
          <div className="flex flex-wrap items-center gap-2">
            {hideSectionAnchor ? null : (
              <SectionAnchor
                title={sectionTitle}
                href={thread.sectionId && sectionHref ? sectionHref(thread.sectionId) : undefined}
              />
            )}
            {thread.isLocked ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Lock className="size-3" aria-hidden="true" /> locked
              </span>
            ) : null}
          </div>
        )}

        <button type="button" onClick={() => onOpen?.(thread.id)} className="text-left">
          <h3
            className={cn(
              "font-semibold leading-snug hover:text-primary",
              compact && "text-sm",
            )}
          >
            {thread.title}
          </h3>
        </button>

        {compact ? null : (
          <p className="line-clamp-2 text-sm text-muted-foreground">{thread.body}</p>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <UserChip user={thread.author} showHandle={false} />
          <span aria-hidden="true">·</span>
          <span>{relativeTime(thread.createdAt)}</span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="size-3" aria-hidden="true" />
            {compactCount(thread.replyCount)} {thread.replyCount === 1 ? "reply" : "replies"}
          </span>
        </div>
      </div>
    </article>
  );
}
