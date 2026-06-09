import { useState } from "react";
import { CornerDownRight, Trash2 } from "lucide-react";

import type { CommunityUser, Post, VoteValue } from "../../lib/community/types";
import { cn } from "../../lib/utils";
import { relativeTime } from "./format";
import { ReplyForm } from "./reply-form";
import { UserChip } from "./user-chip";
import { VoteControl } from "./vote-control";

/** A post plus its nested replies — the shape ThreadView builds from a flat Post[]. */
export type PostNode = { post: Post; replies: PostNode[] };

export type PostItemProps = {
  node: PostNode;
  depth?: number;
  /** Signed-in viewer, or null when logged out (write controls hide). */
  currentUser?: CommunityUser | null;
  myVotes?: Record<string, VoteValue>;
  threadLocked?: boolean;
  onVote?: (postId: string, value: VoteValue) => void;
  onReply?: (parentPostId: string, body: string) => void;
  /** Moderator soft-delete. Rendered only when the viewer is a moderator. */
  onDelete?: (postId: string) => void;
};

const MAX_INDENT = 4;

export function PostItem({
  node,
  depth = 0,
  currentUser,
  myVotes,
  threadLocked = false,
  onVote,
  onReply,
  onDelete,
}: PostItemProps) {
  const { post, replies } = node;
  const [replying, setReplying] = useState(false);
  const canWrite = Boolean(currentUser) && !threadLocked;
  const canModerate = currentUser?.role === "moderator";
  const indented = depth > 0;

  return (
    <div
      className={cn(
        indented && "ml-3 border-l border-border pl-3 sm:ml-4 sm:pl-4",
      )}
    >
      <div className="flex gap-3 py-3">
        <VoteControl
          score={post.score}
          myVote={myVotes?.[post.id] ?? null}
          onVote={canWrite && onVote ? (value) => onVote(post.id, value) : undefined}
          disabled={!canWrite}
          className="pt-0.5"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <UserChip user={post.author} />
            <span aria-hidden="true">·</span>
            <span>{relativeTime(post.createdAt)}</span>
          </div>
          <p className="whitespace-pre-wrap text-sm text-foreground">{post.body}</p>
          {(canWrite && onReply) || (canModerate && onDelete) ? (
            <div className="flex items-center gap-3">
              {canWrite && onReply ? (
                <button
                  type="button"
                  onClick={() => setReplying((v) => !v)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
                >
                  <CornerDownRight className="size-3" aria-hidden="true" /> Reply
                </button>
              ) : null}
              {canModerate && onDelete ? (
                <button
                  type="button"
                  onClick={() => onDelete(post.id)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-destructive"
                >
                  <Trash2 className="size-3" aria-hidden="true" /> Delete
                </button>
              ) : null}
            </div>
          ) : null}
          {replying && onReply ? (
            <ReplyForm
              compact
              placeholder={`Reply to @${post.author.handle}…`}
              onSubmit={(body) => {
                onReply(post.id, body);
                setReplying(false);
              }}
              onCancel={() => setReplying(false)}
              className="mt-1"
            />
          ) : null}
        </div>
      </div>

      {replies.length > 0 ? (
        <div>
          {replies.map((child) => (
            <PostItem
              key={child.post.id}
              node={child}
              depth={Math.min(depth + 1, MAX_INDENT)}
              currentUser={currentUser}
              myVotes={myVotes}
              threadLocked={threadLocked}
              onVote={onVote}
              onReply={onReply}
              onDelete={onDelete}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Build a nested PostNode[] from a flat post list (parentPostId -> children). */
export function buildPostTree(posts: Post[]): PostNode[] {
  const byId = new Map<string, PostNode>();
  posts.forEach((post) => byId.set(post.id, { post, replies: [] }));
  const roots: PostNode[] = [];
  byId.forEach((node) => {
    const parentId = node.post.parentPostId;
    const parent = parentId ? byId.get(parentId) : undefined;
    if (parent) parent.replies.push(node);
    else roots.push(node);
  });
  return roots;
}
