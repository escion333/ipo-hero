// The single interface the frontend uses to talk to the community backend.
//
// UI code depends only on `CommunityClient` and `getCommunityClient()` — never on
// supabase-js directly. Today this returns an unconfigured stub that throws a
// helpful error. To go live:
//   1. `npm install @supabase/supabase-js`
//   2. add `client.supabase.ts` implementing CommunityClient (template in
//      docs/community-platform-plan.md / community/README.md)
//   3. import it here and return it from getCommunityClient() when `communityEnabled` is true.
// Keeping the impl in a separate, not-yet-present file is what lets the typechecked
// build stay green before the dependency is installed.
import { communityEnabled } from "./config";
import { supabaseCommunityClient } from "./client.supabase";
import type {
  CommunityUser,
  NewPostInput,
  NewThreadInput,
  Page,
  Post,
  PostCursor,
  Thread,
  ThreadCursor,
  ThreadListItem,
  ThreadSort,
  VoteTarget,
  VoteValue,
} from "./types";

export interface CommunityClient {
  // auth
  getCurrentUser(): Promise<CommunityUser | null>;
  signInWithX(): Promise<void>;
  signInWithEmail(email: string): Promise<void>;
  completeOAuthCallback(): Promise<void>;
  onAuthStateChange(callback: (user: CommunityUser | null) => void): () => void;
  signOut(): Promise<void>;

  // threads
  listThreads(opts?: {
    sectionId?: string | null;
    cursor?: ThreadCursor;
    limit?: number;
    sort?: ThreadSort;
  }): Promise<Page<ThreadListItem, ThreadCursor>>;
  getThread(id: string): Promise<Thread | null>;
  createThread(input: NewThreadInput): Promise<Thread>;
  /** Moderator-only soft-delete. Hides the thread from public reads. */
  deleteThread(id: string): Promise<void>;

  // posts
  listPosts(opts: {
    threadId: string;
    cursor?: PostCursor;
    limit?: number;
  }): Promise<Page<Post, PostCursor>>;
  createPost(input: NewPostInput): Promise<Post>;
  /** Moderator-only soft-delete. Hides the post from public reads. */
  deletePost(id: string): Promise<void>;

  // voting
  vote(target: VoteTarget, value: VoteValue): Promise<void>;
}

const NOT_CONFIGURED =
  "Community backend is not configured. Set VITE_COMMUNITY_ENABLED=true with " +
  "VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY, install @supabase/supabase-js, and " +
  "wire up client.supabase.ts. See docs/community-platform-plan.md.";

function notConfigured(): never {
  throw new Error(NOT_CONFIGURED);
}

/** Inert client used until a real backend is wired in. Every call throws. */
export const unconfiguredCommunityClient: CommunityClient = {
  getCurrentUser: notConfigured,
  signInWithX: notConfigured,
  signInWithEmail: notConfigured,
  completeOAuthCallback: notConfigured,
  onAuthStateChange: notConfigured,
  signOut: notConfigured,
  listThreads: notConfigured,
  getThread: notConfigured,
  createThread: notConfigured,
  deleteThread: notConfigured,
  listPosts: notConfigured,
  createPost: notConfigured,
  deletePost: notConfigured,
  vote: notConfigured,
};

/**
 * Returns the active community client. Gate UI on `communityEnabled` (from
 * config.ts) before calling, so the unconfigured stub is never hit in normal flow.
 *
 * TODO(community): when @supabase/supabase-js is installed, statically import
 * `supabaseCommunityClient` from "./client.supabase" and return it here when
 * `communityEnabled` is true.
 */
export function getCommunityClient(): CommunityClient {
  return communityEnabled ? supabaseCommunityClient : unconfiguredCommunityClient;
}
