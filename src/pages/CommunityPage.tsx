import { useCallback, useEffect, useMemo, useState } from "react";
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
import { briefData } from "../lib/brief-data";
import { prettifySection } from "../lib/brief-derive";

type BriefSection = (typeof briefData.sections)[number];

type CommunityPageProps = {
  initialTab?: "brief" | "forum";
  initialThreadId?: string;
};

function mostCitedFilingSection(section: BriefSection): string | null {
  const counts = new Map<string, number>();
  for (const item of section.items) {
    for (const citation of item.citations) {
      if (!citation.sectionId) continue;
      counts.set(citation.sectionId, (counts.get(citation.sectionId) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function citedSections() {
  const seen = new Map<string, string>();
  for (const section of briefData.sections) {
    for (const item of section.items) {
      for (const citation of item.citations) {
        if (citation.sectionId && !seen.has(citation.sectionId)) {
          seen.set(citation.sectionId, prettifySection(citation.sectionId));
        }
      }
    }
  }
  return [...seen.entries()]
    .map(([id, title]) => ({ id, title }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

function filterToSectionId(filter: string): string | null | undefined {
  if (filter === "all") return undefined;
  if (filter === "general") return null;
  return filter;
}

export function CommunityPage({ initialTab = "brief", initialThreadId }: CommunityPageProps) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const {
    enabled,
    user,
    loading: authLoading,
    error: authError,
    signInWithEmail,
    signInWithX,
    signOut,
  } = useCommunityUser();
  const [threads, setThreads] = useState<ThreadListItem[]>([]);
  const [threadsById, setThreadsById] = useState<Record<string, Thread>>({});
  const [threadCursor, setThreadCursor] = useState<ThreadCursor | null>(null);
  const [threadSort, setThreadSort] = useState<ThreadSort>("score");
  const [activeFilter, setActiveFilter] = useState<string>(params.get("section") ?? "all");
  const [hasMoreThreads, setHasMoreThreads] = useState(false);
  const [loadingMoreThreads, setLoadingMoreThreads] = useState(false);
  const [postsByThread, setPostsByThread] = useState<Record<string, Post[]>>({});
  const [postCursors, setPostCursors] = useState<Record<string, PostCursor | null>>({});
  const [hasMorePosts, setHasMorePosts] = useState<Record<string, boolean>>({});
  const [loadingMorePosts, setLoadingMorePosts] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const sections = useMemo(() => citedSections(), []);
  const initialFilter = params.get("section") ?? undefined;

  const mergeThread = useCallback((thread: Thread | null) => {
    if (!thread) return;
    setThreadsById((current) => ({ ...current, [thread.id]: thread }));
  }, []);

  const loadThreadsPage = useCallback(
    async ({
      filter,
      sort,
      cursor = null,
      append = false,
    }: {
      filter: string;
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
          sectionId: filterToSectionId(filter),
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
      void loadThreadsPage({ filter: activeFilter, sort: threadSort });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeFilter, loadThreadsPage, threadSort]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setActiveFilter(params.get("section") ?? "all");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [params]);

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
      filter: activeFilter,
      sort: threadSort,
      cursor: threadCursor,
      append: true,
    });
  }, [activeFilter, loadThreadsPage, loadingMoreThreads, threadCursor, threadSort]);

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
    (api: BriefForumApi) => (section: BriefSection) => {
      const filingSectionId = mostCitedFilingSection(section);
      if (!filingSectionId) return null;
      return {
        count: threads.filter((thread) => thread.sectionId === filingSectionId).length,
        onDiscuss: () => {
          api.openDiscussion(filingSectionId);
          navigate(`/forums?section=${encodeURIComponent(filingSectionId)}`);
        },
      };
    },
    [navigate, threads],
  );

  async function createThread(input: NewThreadInput) {
    const thread = await getCommunityClient().createThread(input);
    mergeThread(thread);
    void loadThreadsPage({ filter: activeFilter, sort: threadSort });
    navigate(`/forums/thread/${thread.id}`);
    return thread;
  }

  async function reply(threadId: string, parentPostId: string | null, body: string) {
    await getCommunityClient().createPost({ threadId, parentPostId, body });
    await Promise.all([
      loadThread(threadId),
      loadThreadsPage({ filter: activeFilter, sort: threadSort }),
    ]);
  }

  async function vote(target: { type: "thread" | "post"; id: string }, value: VoteValue) {
    await getCommunityClient().vote(target, value);
    if (target.type === "thread") {
      await loadThreadsPage({ filter: activeFilter, sort: threadSort });
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
        sections={sections}
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
          setActiveFilter(filter);
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
        onSignInWithX={enabled ? () => void signInWithX() : undefined}
        onSignInWithEmail={enabled ? (email) => void signInWithEmail(email) : undefined}
        onSignOut={enabled ? () => void signOut() : undefined}
        className="min-h-screen"
      />
    </>
  );
}
