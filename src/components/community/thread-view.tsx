import { useMemo } from "react";
import { ArrowLeft, Lock, MessageSquare } from "lucide-react";

import type { CommunityUser, Post, Thread, VoteValue } from "../../lib/community/types";
import { ForumDisclaimer } from "./forum-disclaimer";
import { compactCount, relativeTime } from "./format";
import { buildPostTree, PostItem } from "./post-item";
import { ReplyForm } from "./reply-form";
import { SectionAnchor } from "./section-anchor";
import { SignInPrompt } from "./sign-in-prompt";
import { UserChip } from "./user-chip";
import { VoteControl } from "./vote-control";
import { Button } from "../ui/button";

export type ThreadViewProps = {
  thread: Thread;
  posts: Post[];
  sectionTitle?: string | null;
  sectionHref?: (sectionId: string) => string;
  currentUser?: CommunityUser | null;
  /** threadId/postId -> the viewer's vote. The thread's own id keys its header vote. */
  myVotes?: Record<string, VoteValue>;
  onBack?: () => void;
  onVoteThread?: (value: VoteValue) => void;
  onVotePost?: (postId: string, value: VoteValue) => void;
  /** parentPostId is null for a top-level reply to the thread. */
  onReply?: (parentPostId: string | null, body: string) => void;
  onSignInWithX?: () => void;
  onSignInWithEmail?: (email: string) => void;
  hasMorePosts?: boolean;
  loadingMorePosts?: boolean;
  onLoadMorePosts?: () => void;
};

export function ThreadView({
  thread,
  posts,
  sectionTitle,
  sectionHref,
  currentUser,
  myVotes,
  onBack,
  onVoteThread,
  onVotePost,
  onReply,
  onSignInWithX,
  onSignInWithEmail,
  hasMorePosts,
  loadingMorePosts,
  onLoadMorePosts,
}: ThreadViewProps) {
  const tree = useMemo(() => buildPostTree(posts), [posts]);
  const signedIn = Boolean(currentUser);
  const canWrite = signedIn && !thread.isLocked;

  return (
    <div className="flex flex-col gap-4">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex w-fit items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          <ArrowLeft className="size-4" aria-hidden="true" /> All discussions
        </button>
      ) : null}

      <ForumDisclaimer />

      {/* ---------- Thread header ---------- */}
      <article className="flex gap-3 rounded-lg border border-border bg-card p-4 text-card-foreground shadow-panel">
        <VoteControl
          score={thread.score}
          myVote={myVotes?.[thread.id] ?? null}
          onVote={canWrite && onVoteThread ? onVoteThread : undefined}
          disabled={!canWrite}
          className="pt-0.5"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <SectionAnchor
              title={sectionTitle}
              href={thread.sectionId && sectionHref ? sectionHref(thread.sectionId) : undefined}
            />
            {thread.isLocked ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Lock className="size-3" aria-hidden="true" /> locked
              </span>
            ) : null}
          </div>
          <h1 className="text-lg font-semibold leading-snug">{thread.title}</h1>
          <p className="whitespace-pre-wrap text-sm text-foreground">{thread.body}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <UserChip user={thread.author} />
            <span aria-hidden="true">·</span>
            <span>{relativeTime(thread.createdAt)}</span>
          </div>
        </div>
      </article>

      {/* ---------- Reply composer / gate ---------- */}
      {thread.isLocked ? (
        <p className="flex items-center gap-2 rounded-lg border border-border bg-secondary/60 px-3 py-2 text-sm text-muted-foreground">
          <Lock className="size-4" aria-hidden="true" /> This thread is locked. New replies are
          disabled.
        </p>
      ) : signedIn ? (
        <ReplyForm
          placeholder="Share your view on this thread…"
          submitLabel="Post reply"
          onSubmit={(body) => onReply?.(null, body)}
        />
      ) : (
        <SignInPrompt
          title="Sign in to reply"
          description="Reading is open to all. Replying and voting need a quick sign-in."
          onSignInWithX={onSignInWithX}
          onSignInWithEmail={onSignInWithEmail}
        />
      )}

      {/* ---------- Posts ---------- */}
      <div className="flex items-center gap-2 pt-1 text-sm font-semibold">
        <MessageSquare className="size-4 text-muted-foreground" aria-hidden="true" />
        {compactCount(thread.replyCount)} {thread.replyCount === 1 ? "reply" : "replies"}
      </div>

      {tree.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-card/50 py-8 text-center text-sm text-muted-foreground">
          No replies yet. {canWrite ? "Be the first." : ""}
        </p>
      ) : (
        <div className="rounded-lg border border-border bg-card px-4 text-card-foreground shadow-panel">
          {tree.map((node, i) => (
            <div key={node.post.id} className={i > 0 ? "border-t border-border" : undefined}>
              <PostItem
                node={node}
                currentUser={currentUser}
                myVotes={myVotes}
                threadLocked={thread.isLocked}
                onVote={onVotePost}
                onReply={onReply ? (parentId, body) => onReply(parentId, body) : undefined}
              />
            </div>
          ))}
        </div>
      )}
      {hasMorePosts ? (
        <Button
          type="button"
          variant="outline"
          className="self-center"
          disabled={loadingMorePosts}
          onClick={onLoadMorePosts}
        >
          {loadingMorePosts ? "Loading..." : "Load more replies"}
        </Button>
      ) : null}
    </div>
  );
}
