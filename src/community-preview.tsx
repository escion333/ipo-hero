import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";
import "./preview.css";
import { ThemeToggle } from "./components/theme/theme-toggle";
import {
  ForumDisclaimer,
  NewThreadForm,
  SignInPrompt,
  ThreadList,
  ThreadView,
} from "./components/community";
import type { VoteValue } from "./lib/community/types";
import {
  mockCurrentUser,
  mockPosts,
  mockSections,
  mockThreads,
} from "./components/community/mock-community";

type Route =
  | { name: "list" }
  | { name: "thread"; id: string }
  | { name: "new" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Preview() {
  const [signedIn, setSignedIn] = useState(true);
  const [route, setRoute] = useState<Route>({ name: "list" });
  const [votes, setVotes] = useState<Record<string, VoteValue>>({});

  const currentUser = signedIn ? mockCurrentUser : null;
  const titleById = useMemo(
    () => new Map(mockSections.map((s) => [s.id, s.title])),
    [],
  );

  // Toggle-style optimistic vote stub — the preview's stand-in for the client.
  const castVote = (id: string, value: VoteValue) =>
    setVotes((prev) => ({ ...prev, [id]: prev[id] === value ? (0 as VoteValue) : value }));

  const openThread = (id: string) => setRoute({ name: "thread", id });
  const sectionHref = (id: string) => `#section-${id}`;

  const activeThread =
    route.name === "thread" ? mockThreads.find((t) => t.id === route.id) ?? null : null;

  return (
    <div className="preview-root mx-auto flex w-full max-w-3xl flex-col gap-8 p-8">
      <header className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">
            Community preview
          </p>
          <h1 className="text-2xl font-bold">Forum components · mock data</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSignedIn((v) => !v)}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            {signedIn ? "Signed in: Delta-V" : "Signed out"}
          </button>
          <ThemeToggle />
        </div>
      </header>

      {route.name === "list" ? (
        <>
          <ForumDisclaimer />
          <Section title="Thread list (sort + section filter)">
            <ThreadList
              threads={mockThreads}
              sections={mockSections}
              sectionHref={sectionHref}
              myVotes={votes}
              canVote={signedIn}
              onOpen={openThread}
              onVote={castVote}
              onNewThread={signedIn ? () => setRoute({ name: "new" }) : undefined}
            />
          </Section>

          {!signedIn ? (
            <Section title="Write gate (shown to logged-out users)">
              <SignInPrompt />
            </Section>
          ) : null}
        </>
      ) : null}

      {route.name === "thread" && activeThread ? (
        <ThreadView
          thread={activeThread}
          posts={mockPosts[activeThread.id] ?? []}
          sectionTitle={activeThread.sectionId ? titleById.get(activeThread.sectionId) : null}
          sectionHref={sectionHref}
          currentUser={currentUser}
          myVotes={votes}
          onBack={() => setRoute({ name: "list" })}
          onVoteThread={(value) => castVote(activeThread.id, value)}
          onVotePost={castVote}
          onReply={(parentId, body) => console.log("reply", { parentId, body })}
        />
      ) : null}

      {route.name === "new" ? (
        <Section title="New thread">
          <NewThreadForm
            sections={mockSections}
            onSubmit={(input) => {
              console.log("createThread", input);
              setRoute({ name: "list" });
            }}
            onCancel={() => setRoute({ name: "list" })}
          />
        </Section>
      ) : null}
    </div>
  );
}

createRoot(document.getElementById("community-preview-root")!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
