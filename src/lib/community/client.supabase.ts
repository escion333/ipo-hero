import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { communityConfig } from "./config";
import type {
  CommunityClient,
} from "./client";
import type {
  CommunityUser,
  NewPostInput,
  NewThreadInput,
  Post,
  PostCursor,
  Thread,
  ThreadCursor,
  ThreadListItem,
  ThreadSort,
  VoteTarget,
  VoteValue,
} from "./types";

const MAX_PAGE_SIZE = 100;
const DEFAULT_THREAD_LIMIT = 25;
const DEFAULT_POST_LIMIT = 50;
const THREAD_COLUMNS =
  "id, filing_accession, section_id, title, body, author_id, score, reply_count, is_locked, is_deleted, created_at, updated_at, author:profiles!threads_author_id_fkey(id, handle, display_name, avatar_url, role)";
const THREAD_LIST_COLUMNS =
  "id, filing_accession, section_id, title, body_preview, author_id, author_handle, author_display_name, author_avatar_url, author_role, score, reply_count, is_locked, is_deleted, created_at, updated_at";
const POST_COLUMNS =
  "id, thread_id, parent_post_id, body, author_id, score, is_deleted, created_at, updated_at, author:profiles!posts_author_id_fkey(id, handle, display_name, avatar_url, role)";

type ProfileRow = {
  id: string;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
  role: "member" | "moderator" | null;
};

type ThreadRow = {
  id: string;
  filing_accession: string;
  section_id: string | null;
  title: string;
  body: string;
  author_id: string;
  author?: ProfileRow | ProfileRow[] | null;
  score: number;
  reply_count: number;
  is_locked: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
};

type ThreadListRow = Omit<ThreadRow, "body"> & {
  body_preview: string;
  author_handle: string | null;
  author_display_name: string | null;
  author_avatar_url: string | null;
  author_role: "member" | "moderator" | null;
};

type PostRow = {
  id: string;
  thread_id: string;
  parent_post_id: string | null;
  body: string;
  author_id: string;
  author?: ProfileRow | ProfileRow[] | null;
  score: number;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
};

type CommunityDatabase = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: {
          id: string;
          x_user_id?: string | null;
          handle: string;
          display_name: string;
          avatar_url?: string | null;
          role?: "member" | "moderator";
        };
        Update: Partial<CommunityDatabase["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
      threads: {
        Row: ThreadRow;
        Insert: {
          filing_accession?: string;
          section_id?: string | null;
          title: string;
          body: string;
          author_id: string;
        };
        Update: Partial<CommunityDatabase["public"]["Tables"]["threads"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "threads_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      posts: {
        Row: PostRow;
        Insert: {
          thread_id: string;
          parent_post_id?: string | null;
          body: string;
          author_id: string;
        };
        Update: Partial<CommunityDatabase["public"]["Tables"]["posts"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "posts_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "posts_thread_id_fkey";
            columns: ["thread_id"];
            isOneToOne: false;
            referencedRelation: "threads";
            referencedColumns: ["id"];
          },
        ];
      };
      votes: {
        Row: {
          user_id: string;
          target_type: "thread" | "post";
          target_id: string;
          value: VoteValue;
          created_at: string;
        };
        Insert: {
          user_id: string;
          target_type: "thread" | "post";
          target_id: string;
          value: VoteValue;
        };
        Update: Partial<CommunityDatabase["public"]["Tables"]["votes"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "votes_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      thread_list_items: {
        Row: ThreadListRow;
        Relationships: [];
      };
    };
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

type Supabase = SupabaseClient<CommunityDatabase>;
let supabase: Supabase | null = null;

function sb(): Supabase {
  if (!supabase) {
    supabase = createClient<CommunityDatabase>(
      communityConfig.supabaseUrl,
      communityConfig.supabaseAnonKey,
    );
  }
  return supabase;
}

function pageLimit(limit: number | undefined, fallback: number): number {
  if (!Number.isFinite(limit)) return fallback;
  return Math.min(Math.max(Math.trunc(limit ?? fallback), 1), MAX_PAGE_SIZE);
}

function threadCursor(row: Pick<ThreadRow, "score" | "created_at" | "id">, sort: ThreadSort): ThreadCursor {
  return sort === "score"
    ? { score: row.score, createdAt: row.created_at, id: row.id }
    : { createdAt: row.created_at, id: row.id };
}

function postCursor(row: PostRow): PostCursor {
  return { createdAt: row.created_at, id: row.id };
}

function pageFromRows<Row, Item, Cursor>(
  rows: Row[],
  limit: number,
  mapItem: (row: Row) => Item,
  mapCursor: (row: Row) => Cursor,
) {
  const pageRows = rows.slice(0, limit);
  return {
    items: pageRows.map(mapItem),
    nextCursor: rows.length > limit ? mapCursor(pageRows[pageRows.length - 1]) : null,
  };
}

function first<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function rowToUser(row: ProfileRow | null | undefined, fallbackId = ""): CommunityUser {
  return {
    id: row?.id ?? fallbackId,
    handle: row?.handle ?? "member",
    displayName: row?.display_name ?? row?.handle ?? "Community member",
    avatarUrl: row?.avatar_url ?? null,
    role: row?.role ?? "member",
  };
}

function rowToThread(row: ThreadRow): Thread {
  return {
    id: row.id,
    filingAccession: row.filing_accession,
    sectionId: row.section_id,
    title: row.title,
    body: row.body,
    author: rowToUser(first(row.author), row.author_id),
    score: row.score,
    replyCount: row.reply_count,
    isLocked: row.is_locked,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToThreadListItem(row: ThreadListRow): ThreadListItem {
  return {
    id: row.id,
    filingAccession: row.filing_accession,
    sectionId: row.section_id,
    title: row.title,
    bodyPreview: row.body_preview,
    author: rowToUser(
      {
        id: row.author_id,
        handle: row.author_handle,
        display_name: row.author_display_name,
        avatar_url: row.author_avatar_url,
        role: row.author_role,
      },
      row.author_id,
    ),
    score: row.score,
    replyCount: row.reply_count,
    isLocked: row.is_locked,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToPost(row: PostRow): Post {
  return {
    id: row.id,
    threadId: row.thread_id,
    parentPostId: row.parent_post_id,
    body: row.body,
    author: rowToUser(first(row.author), row.author_id),
    score: row.score,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isMissingSession(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AuthSessionMissingError" || error.message.includes("Auth session missing"))
  );
}

async function invokeCommunityWrite<T>(
  body:
    | { action: "createThread"; input: NewThreadInput }
    | { action: "createPost"; input: NewPostInput }
    | { action: "vote"; target: VoteTarget; value: VoteValue }
    | { action: "deleteThread"; id: string }
    | { action: "deletePost"; id: string },
): Promise<T> {
  const { data, error } = await sb().functions.invoke<T>("community-write", { body });
  if (error) throw error;
  return data as T;
}

export const supabaseCommunityClient: CommunityClient = {
  async getCurrentUser() {
    const { data, error } = await sb().auth.getUser();
    if (isMissingSession(error)) return null;
    if (error) throw error;
    if (!data.user) return null;
    const { data: profile, error: profileError } = await sb()
      .from("profiles")
      .select("id, handle, display_name, avatar_url, role")
      .eq("id", data.user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    return profile ? rowToUser(profile as ProfileRow, data.user.id) : null;
  },

  async signInWithX() {
    const { error } = await sb().auth.signInWithOAuth({
      // "x" = X/Twitter OAuth 2.0 provider (Client ID/Secret), which is what's
      // enabled in Supabase. "twitter" is the deprecated OAuth 1.0a provider.
      provider: "x",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) throw error;
  },

  async signInWithEmail(email: string) {
    const { error } = await sb().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) throw error;
  },

  async completeOAuthCallback() {
    const code = new URLSearchParams(window.location.search).get("code");
    if (!code) return;
    const { error } = await sb().auth.exchangeCodeForSession(code);
    if (error) throw error;
  },

  onAuthStateChange(callback) {
    const { data } = sb().auth.onAuthStateChange(() => {
      window.setTimeout(async () => {
        try {
          callback(await this.getCurrentUser());
        } catch {
          callback(null);
        }
      }, 0);
    });
    return () => data.subscription.unsubscribe();
  },

  async signOut() {
    const { error } = await sb().auth.signOut();
    if (error) throw error;
  },

  async listThreads({ sectionId, cursor, limit, sort = "score" } = {}) {
    const pageSize = pageLimit(limit, DEFAULT_THREAD_LIMIT);
    let query = sb()
      .from("thread_list_items")
      .select(THREAD_LIST_COLUMNS)
      .eq("is_deleted", false);
    if (sectionId !== undefined) {
      query = sectionId === null ? query.is("section_id", null) : query.eq("section_id", sectionId);
    }
    if (sort === "score") {
      query = query
        .order("score", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });
      if (cursor?.score !== undefined) {
        query = query.or(
          [
            `score.lt.${cursor.score}`,
            `and(score.eq.${cursor.score},created_at.lt.${cursor.createdAt})`,
            `and(score.eq.${cursor.score},created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
          ].join(","),
        );
      }
    } else {
      query = query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });
      if (cursor) {
        query = query.or(
          [
            `created_at.lt.${cursor.createdAt}`,
            `and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
          ].join(","),
        );
      }
    }
    query = query.limit(pageSize + 1);
    const { data, error } = await query;
    if (error) throw error;
    return pageFromRows(
      (data ?? []) as ThreadListRow[],
      pageSize,
      rowToThreadListItem,
      (row) => threadCursor(row, sort),
    );
  },

  async getThread(id: string) {
    const { data, error } = await sb()
      .from("threads")
      .select(THREAD_COLUMNS)
      .eq("id", id)
      .eq("is_deleted", false)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToThread(data as ThreadRow) : null;
  },

  async createThread(input: NewThreadInput) {
    const data = await invokeCommunityWrite<ThreadRow>({ action: "createThread", input });
    return rowToThread(data);
  },

  async deleteThread(id: string) {
    await invokeCommunityWrite<void>({ action: "deleteThread", id });
  },

  async listPosts({ threadId, cursor, limit }) {
    const pageSize = pageLimit(limit, DEFAULT_POST_LIMIT);
    let query = sb()
      .from("posts")
      .select(POST_COLUMNS)
      .eq("thread_id", threadId)
      .eq("is_deleted", false)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (cursor) {
      query = query.or(
        [
          `created_at.gt.${cursor.createdAt}`,
          `and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id})`,
        ].join(","),
      );
    }
    query = query.limit(pageSize + 1);
    const { data, error } = await query;
    if (error) throw error;
    return pageFromRows((data ?? []) as PostRow[], pageSize, rowToPost, postCursor);
  },

  async createPost(input: NewPostInput) {
    const data = await invokeCommunityWrite<PostRow>({ action: "createPost", input });
    return rowToPost(data);
  },

  async deletePost(id: string) {
    await invokeCommunityWrite<void>({ action: "deletePost", id });
  },

  async vote(target: VoteTarget, value: VoteValue) {
    await invokeCommunityWrite<void>({ action: "vote", target, value });
  },
};
