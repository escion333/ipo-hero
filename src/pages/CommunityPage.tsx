import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import BriefRedesign from "../BriefRedesign";
import { BriefForumShell, type BriefForumApi } from "../components/community";
import { useCommunityUser } from "../lib/community/auth";
import { getCommunityClient } from "../lib/community/client";
import type { NewThreadInput, Post, Thread, VoteValue } from "../lib/community/types";
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

export function CommunityPage({ initialTab = "brief", initialThreadId }: CommunityPageProps) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { enabled, user, signInWithEmail, signInWithX } = useCommunityUser();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [postsByThread, setPostsByThread] = useState<Record<string, Post[]>>({});
  const [error, setError] = useState<string | null>(null);
  const sections = useMemo(() => citedSections(), []);
  const initialFilter = params.get("section") ?? undefined;

  const mergeThread = useCallback((thread: Thread | null) => {
    if (!thread) return;
    setThreads((current) => {
      const rest = current.filter((item) => item.id !== thread.id);
      return [thread, ...rest];
    });
  }, []);

  const loadThreads = useCallback(async () => {
    if (!enabled) {
      setThreads([]);
      return;
    }
    setError(null);
    try {
      setThreads(await getCommunityClient().listThreads());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load community threads.");
    }
  }, [enabled]);

  const loadThread = useCallback(
    async (threadId: string) => {
      if (!enabled) return;
      setError(null);
      try {
        const [thread, posts] = await Promise.all([
          getCommunityClient().getThread(threadId),
          getCommunityClient().listPosts(threadId),
        ]);
        mergeThread(thread);
        setPostsByThread((current) => ({ ...current, [threadId]: posts }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load community thread.");
      }
    },
    [enabled, mergeThread],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadThreads();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadThreads]);

  useEffect(() => {
    if (!initialThreadId) return undefined;
    const timer = window.setTimeout(() => {
      void loadThread(initialThreadId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialThreadId, loadThread]);

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
    navigate(`/forums/thread/${thread.id}`);
    return thread;
  }

  async function reply(threadId: string, parentPostId: string | null, body: string) {
    await getCommunityClient().createPost({ threadId, parentPostId, body });
    await Promise.all([loadThread(threadId), loadThreads()]);
  }

  async function vote(target: { type: "thread" | "post"; id: string }, value: VoteValue) {
    await getCommunityClient().vote(target, value);
    if (target.type === "thread") {
      await loadThreads();
    } else {
      const threadId = Object.entries(postsByThread).find(([, posts]) =>
        posts.some((post) => post.id === target.id),
      )?.[0];
      if (threadId) await loadThread(threadId);
    }
  }

  return (
    <>
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
        currentUser={user}
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
        className="min-h-screen"
      />
    </>
  );
}
