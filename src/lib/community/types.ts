// Domain types for the community platform (accounts + prospectus-linked forums).
// These mirror the Postgres schema in supabase/migrations/0001_community.sql but
// are the frontend's own view: display-safe, camelCased, no DB-internal columns.
//
// Forum content references filing content by stable id only — a thread's
// `sectionId` points at a `FilingSection.id` from the static ingestion artifacts.
import type { FilingSection } from "../types";

export type CommunityRole = "member" | "moderator";

export type CommunityUser = {
  id: string;
  /** X/Twitter handle, without the leading "@". */
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  role: CommunityRole;
};

export type Thread = {
  id: string;
  /** Accession of the filing this thread belongs to. */
  filingAccession: string;
  /** `FilingSection.id` this thread is scoped to, or null for general discussion. */
  sectionId: FilingSection["id"] | null;
  title: string;
  body: string;
  author: CommunityUser;
  score: number;
  replyCount: number;
  isLocked: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Post = {
  id: string;
  threadId: string;
  parentPostId: string | null;
  body: string;
  author: CommunityUser;
  score: number;
  createdAt: string;
  updatedAt: string;
};

export type VoteValue = -1 | 1;

export type NewThreadInput = {
  sectionId: FilingSection["id"] | null;
  title: string;
  body: string;
};

export type NewPostInput = {
  threadId: string;
  parentPostId?: string | null;
  body: string;
};

export type VoteTarget = {
  type: "thread" | "post";
  id: string;
};
