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
  Thread,
  VoteTarget,
  VoteValue,
} from "./types";

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
    Views: Record<string, never>;
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

async function currentUserId(): Promise<string> {
  const { data, error } = await sb().auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("Sign in to continue.");
  return data.user.id;
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

  async listThreads({ sectionId } = {}) {
    let query = sb()
      .from("threads")
      .select("*, author:profiles!threads_author_id_fkey(id, handle, display_name, avatar_url, role)")
      .eq("is_deleted", false)
      .order("score", { ascending: false })
      .order("created_at", { ascending: false });
    if (sectionId !== undefined) {
      query = sectionId === null ? query.is("section_id", null) : query.eq("section_id", sectionId);
    }
    const { data, error } = await query;
    if (error) throw error;
    return ((data ?? []) as ThreadRow[]).map(rowToThread);
  },

  async getThread(id: string) {
    const { data, error } = await sb()
      .from("threads")
      .select("*, author:profiles!threads_author_id_fkey(id, handle, display_name, avatar_url, role)")
      .eq("id", id)
      .eq("is_deleted", false)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToThread(data as ThreadRow) : null;
  },

  async createThread(input: NewThreadInput) {
    const authorId = await currentUserId();
    const { data, error } = await sb()
      .from("threads")
      .insert({
        section_id: input.sectionId,
        title: input.title,
        body: input.body,
        author_id: authorId,
      })
      .select("*, author:profiles!threads_author_id_fkey(id, handle, display_name, avatar_url, role)")
      .single();
    if (error) throw error;
    return rowToThread(data as ThreadRow);
  },

  async listPosts(threadId: string) {
    const { data, error } = await sb()
      .from("posts")
      .select("*, author:profiles!posts_author_id_fkey(id, handle, display_name, avatar_url, role)")
      .eq("thread_id", threadId)
      .eq("is_deleted", false)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return ((data ?? []) as PostRow[]).map(rowToPost);
  },

  async createPost(input: NewPostInput) {
    const authorId = await currentUserId();
    const { data, error } = await sb()
      .from("posts")
      .insert({
        thread_id: input.threadId,
        parent_post_id: input.parentPostId ?? null,
        body: input.body,
        author_id: authorId,
      })
      .select("*, author:profiles!posts_author_id_fkey(id, handle, display_name, avatar_url, role)")
      .single();
    if (error) throw error;
    return rowToPost(data as PostRow);
  },

  async vote(target: VoteTarget, value: VoteValue) {
    const userId = await currentUserId();
    const { error } = await sb().from("votes").upsert({
      user_id: userId,
      target_type: target.type,
      target_id: target.id,
      value,
    });
    if (error) throw error;
  },
};
