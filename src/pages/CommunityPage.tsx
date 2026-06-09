import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import BriefRedesign from "../BriefRedesign";
import { BriefForumShell, type BriefForumApi } from "../components/community";
import { useCommunityUser } from "../lib/community/auth";
import { getCommunityClient } from "../lib/community/client";
import type {
  NewThreadInput,
  Post,
  PostCursor,
  Thread,
  ThreadCursor,
  ThreadListItem,
  ThreadSort,
  VoteValue,
} from "../lib/community/types";
import { type ReaderSection } from "../lib/brief-derive";
import { resolveTheme, themeForBriefSection } from "../lib/community/themes";

type CommunityPageProps = {
  initialTab?: "brief" | "forum";
  initialThreadId?: string;
};

export function CommunityPage({ initialTab = "brief", initialThreadId }: CommunityPageProps) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const {
    enabled,
    user,
    loading: authLoading,
    error: authError,
    signInWithX,
    signOut,
  } = useCommunityUser();
  const [threads, setThreads] = useState<ThreadListItem[]>([]);
  const [threadsById, setThreadsById] = useState<Record<string, Thread>>({});
  const [threadCursor, setThreadCursor] = useState<ThreadCursor | null>(null);
  const [threadSort, setThreadSort] = useState<ThreadSort>("score");
  const [hasMoreThreads, setHasMoreThreads] = useState(false);
  const [loadingMoreThreads, setLoadingMoreThreads] = useState(false);
  const [postsByThread, setPostsByThread] = useState<Record<string, Post[]>>({});
  const [postCursors, setPostCursors] = useState<Record<string, PostCursor | null>>({});
  const [hasMorePosts, setHasMorePosts] = useState<Record<string, boolean>>({});
  const [loadingMorePosts, setLoadingMorePosts] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const initialFilter = params.get("section") ?? undefined;

  const mergeThread = useCallback((thread: Thread | null) => {
    if (!thread) return;
    setThreadsById((current) => ({ ...current, [thread.id]: thread }));
  }, []);

  // Threads are fetched unfiltered; theme filtering happens client-side in
  // ThreadList. That keeps the "only show topics that have threads" affordance
  // working off the full in-memory set rather than a server-narrowed page.
  const loadThreadsPage = useCallback(
    async ({
      sort,
      cursor = null,
      append = false,
    }: {
      sort: ThreadSort;
      cursor?: ThreadCursor | null;
      append?: boolean;
    }) => {
      if (!enabled) {
        setThreads([]);
        setThreadCursor(null);
        setHasMoreThreads(false);
        return;
      }
      setError(null);
      if (append) setLoadingMoreThreads(true);
      try {
        const page = await getCommunityClient().listThreads({
          cursor: cursor ?? undefined,
          sort,
        });
        setThreads((current) => (append ? [...current, ...page.items] : page.items));
        setThreadCursor(page.nextCursor);
        setHasMoreThreads(Boolean(page.nextCursor));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load community threads.");
      } finally {
        if (append) setLoadingMoreThreads(false);
      }
    },
    [enabled],
  );

  const loadThread = useCallback(
    async (threadId: string) => {
      if (!enabled) return;
      setError(null);
      try {
        const [thread, posts] = await Promise.all([
          getCommunityClient().getThread(threadId),
          getCommunityClient().listPosts({ threadId }),
        ]);
        mergeThread(thread);
        setPostsByThread((current) => ({ ...current, [threadId]: posts.items }));
        setPostCursors((current) => ({ ...current, [threadId]: posts.nextCursor }));
        setHasMorePosts((current) => ({ ...current, [threadId]: Boolean(posts.nextCursor) }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load community thread.");
      }
    },
    [enabled, mergeThread],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadThreadsPage({ sort: threadSort });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadThreadsPage, threadSort]);

  useEffect(() => {
    if (!initialThreadId) return undefined;
    const timer = window.setTimeout(() => {
      void loadThread(initialThreadId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialThreadId, loadThread]);

  const loadMoreThreads = useCallback(() => {
    if (!threadCursor || loadingMoreThreads) return;
    void loadThreadsPage({
      sort: threadSort,
      cursor: threadCursor,
      append: true,
    });
  }, [loadThreadsPage, loadingMoreThreads, threadCursor, threadSort]);

  const loadMorePosts = useCallback(
    async (threadId: string) => {
      const cursor = postCursors[threadId];
      if (!enabled || !cursor || loadingMorePosts[threadId]) return;
      setError(null);
      setLoadingMorePosts((current) => ({ ...current, [threadId]: true }));
      try {
        const page = await getCommunityClient().listPosts({ threadId, cursor });
        setPostsByThread((current) => ({
          ...current,
          [threadId]: [...(current[threadId] ?? []), ...page.items],
        }));
        setPostCursors((current) => ({ ...current, [threadId]: page.nextCursor }));
        setHasMorePosts((current) => ({ ...current, [threadId]: Boolean(page.nextCursor) }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load more replies.");
      } finally {
        setLoadingMorePosts((current) => ({ ...current, [threadId]: false }));
      }
    },
    [enabled, loadingMorePosts, postCursors],
  );

  const discussionForSection = useCallback(
    (api: BriefForumApi) => (section: ReaderSection) => {
      const theme = themeForBriefSection(section.id);
      if (!theme) return null;
      return {
        count: threads.filter((thread) => resolveTheme(thread.sectionId) === theme).length,
        onDiscuss: () => {
          api.openDiscussion(theme);
          navigate(`/forums?section=${encodeURIComponent(theme)}`);
        },
      };
    },
    [navigate, threads],
  );

  async function createThread(input: NewThreadInput) {
    const thread = await getCommunityClient().createThread(input);
    mergeThread(thread);
    void loadThreadsPage({ sort: threadSort });
    navigate(`/forums/thread/${thread.id}`);
    return thread;
  }

  async function reply(threadId: string, parentPostId: string | null, body: string) {
    await getCommunityClient().createPost({ threadId, parentPostId, body });
    await Promise.all([loadThread(threadId), loadThreadsPage({ sort: threadSort })]);
  }

  // Returns false when the moderator dismisses the confirm, so the caller can
  // keep the open thread in view instead of navigating back.
  async function deleteThread(threadId: string) {
    if (!window.confirm("Delete this thread? It will be hidden from the community.")) {
      return false;
    }
    try {
      await getCommunityClient().deleteThread(threadId);
      setThreads((current) => current.filter((thread) => thread.id !== threadId));
      setThreadsById((current) => {
        const next = { ...current };
        delete next[threadId];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the thread.");
      return false;
    }
  }

  async function deletePost(postId: string) {
    if (!window.confirm("Delete this post? It will be hidden from the community.")) return;
    const threadId = Object.entries(postsByThread).find(([, posts]) =>
      posts.some((post) => post.id === postId),
    )?.[0];
    try {
      await getCommunityClient().deletePost(postId);
      if (threadId) {
        await Promise.all([loadThread(threadId), loadThreadsPage({ sort: threadSort })]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the post.");
    }
  }

  async function vote(target: { type: "thread" | "post"; id: string }, value: VoteValue) {
    await getCommunityClient().vote(target, value);
    if (target.type === "thread") {
      await loadThreadsPage({ sort: threadSort });
    } else {
      const threadId = Object.entries(postsByThread).find(([, posts]) =>
        posts.some((post) => post.id === target.id),
      )?.[0];
      if (threadId) await loadThread(threadId);
    }
  }

  return (
    <>
      {authError ? <div className="community-route-error">{authError}</div> : null}
      {error ? <div className="community-route-error">{error}</div> : null}
      {!enabled && initialTab === "forum" ? (
        <div className="community-route-error">
          Community is not configured. Set Supabase URL, anon key, and `VITE_COMMUNITY_ENABLED=true`.
        </div>
      ) : null}
      <BriefForumShell
        renderBrief={(api) => (
          <BriefRedesign getSectionDiscussion={discussionForSection(api)} />
        )}
        threads={threads}
        getPosts={(id) => postsByThread[id] ?? []}
        getThread={(id) => threadsById[id] ?? null}
        currentUser={user}
        authLoading={authLoading}
        communityEnabled={enabled}
        initialTab={initialTab}
        initialThreadId={initialThreadId}
        initialFilter={initialFilter}
        threadCount={threads.length}
        onTabChange={(tab) => navigate(tab === "forum" ? "/forums" : "/")}
        onFilterChange={(filter) => {
          if (filter === "all") navigate("/forums");
          else if (filter === "general") navigate("/forums?section=general");
          else navigate(`/forums?section=${encodeURIComponent(filter)}`);
        }}
        threadSort={threadSort}
        hasMoreThreads={hasMoreThreads}
        loadingMoreThreads={loadingMoreThreads}
        hasMorePosts={hasMorePosts}
        loadingMorePosts={loadingMorePosts}
        onThreadSortChange={(sort) => {
          setThreadSort(sort);
        }}
        onLoadMoreThreads={loadMoreThreads}
        onLoadMorePosts={(threadId) => void loadMorePosts(threadId)}
        onThreadOpen={(threadId) => {
          void loadThread(threadId);
          navigate(`/forums/thread/${threadId}`);
        }}
        onThreadBack={() => navigate("/forums")}
        onVoteThread={(threadId, value) => void vote({ type: "thread", id: threadId }, value)}
        onVotePost={(postId, value) => void vote({ type: "post", id: postId }, value)}
        onReply={(threadId, parentPostId, body) => void reply(threadId, parentPostId, body)}
        onCreateThread={createThread}
        onDeleteThread={enabled ? deleteThread : undefined}
        onDeletePost={enabled ? (postId) => void deletePost(postId) : undefined}
        onSignInWithX={enabled ? () => void signInWithX() : undefined}
        onSignOut={enabled ? () => void signOut() : undefined}
        className="min-h-screen"
      />
    </>
  );
}
