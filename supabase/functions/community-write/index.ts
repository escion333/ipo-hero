import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const THREAD_COLUMNS =
  "id, filing_accession, section_id, title, body, author_id, score, reply_count, is_locked, is_deleted, created_at, updated_at, author:profiles!threads_author_id_fkey(id, handle, display_name, avatar_url, role)";
const POST_COLUMNS =
  "id, thread_id, parent_post_id, body, author_id, score, is_deleted, created_at, updated_at, author:profiles!posts_author_id_fkey(id, handle, display_name, avatar_url, role)";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Action = "thread" | "post" | "vote" | "report" | "moderate";

type Limit = {
  scope: "user" | "ip";
  windowSeconds: number;
  limit: number;
};

const limits: Record<Action, Limit[]> = {
  thread: [
    { scope: "user", windowSeconds: 60, limit: 3 },
    { scope: "user", windowSeconds: 86_400, limit: 20 },
    { scope: "ip", windowSeconds: 60, limit: 10 },
  ],
  post: [
    { scope: "user", windowSeconds: 60, limit: 10 },
    { scope: "user", windowSeconds: 86_400, limit: 100 },
    { scope: "ip", windowSeconds: 60, limit: 30 },
  ],
  vote: [
    { scope: "user", windowSeconds: 60, limit: 60 },
    { scope: "user", windowSeconds: 86_400, limit: 1_000 },
    { scope: "ip", windowSeconds: 60, limit: 120 },
  ],
  report: [
    { scope: "user", windowSeconds: 3_600, limit: 10 },
    { scope: "ip", windowSeconds: 3_600, limit: 30 },
  ],
  // Moderator-only soft-deletes. Generous ceilings (a mod sweeping spam may delete
  // many in a row) but still bounded to blunt a compromised-account rampage.
  moderate: [
    { scope: "user", windowSeconds: 60, limit: 60 },
    { scope: "user", windowSeconds: 86_400, limit: 1_000 },
  ],
};

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfter?: number,
  ) {
    super(message);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new HttpError(500, `${name} is not configured`);
  return value;
}

function clientIp(req: Request) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function writeAction(payload: { action?: string }): Action {
  if (payload.action === "createThread") return "thread";
  if (payload.action === "createPost") return "post";
  if (payload.action === "vote") return "vote";
  if (payload.action === "report") return "report";
  if (payload.action === "deleteThread" || payload.action === "deletePost") return "moderate";
  throw new HttpError(400, "Unknown community write action.");
}

async function enforceRateLimits({
  serviceClient,
  action,
  userId,
  ip,
}: {
  serviceClient: ReturnType<typeof createClient>;
  action: Action;
  userId: string;
  ip: string;
}) {
  for (const limit of limits[action]) {
    const subject = limit.scope === "user" ? userId : ip;
    const { data, error } = await serviceClient.rpc("check_community_rate_limit", {
      p_scope: limit.scope,
      p_subject: subject,
      p_action: action,
      p_window_seconds: limit.windowSeconds,
      p_limit: limit.limit,
    });
    if (error) throw new HttpError(500, error.message);
    if (data !== true) {
      throw new HttpError(429, "Community write rate limit exceeded.", limit.windowSeconds);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const anonKey = requiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) throw new HttpError(401, "Sign in to continue.");

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError) throw new HttpError(401, userError.message);
    if (!user) throw new HttpError(401, "Sign in to continue.");

    const payload = await req.json();
    const action = writeAction(payload);

    // Moderation actions are mod-only. RLS + the table guard triggers already
    // enforce this at the DB, but an explicit check here returns a clean 403
    // (rather than a generic RLS write failure) and keeps the contract obvious.
    if (action === "moderate") {
      const { data: profile, error: roleError } = await serviceClient
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      if (roleError) throw new HttpError(500, roleError.message);
      if (!profile || profile.role !== "moderator") {
        throw new HttpError(403, "Moderator access required.");
      }
    }

    await enforceRateLimits({
      serviceClient,
      action,
      userId: user.id,
      ip: clientIp(req),
    });

    if (payload.action === "createThread") {
      const { data, error } = await userClient
        .from("threads")
        .insert({
          section_id: payload.input?.sectionId ?? null,
          title: payload.input?.title,
          body: payload.input?.body,
          author_id: user.id,
        })
        .select(THREAD_COLUMNS)
        .single();
      if (error) throw new HttpError(400, error.message);
      return json(data);
    }

    if (payload.action === "createPost") {
      const { data, error } = await userClient
        .from("posts")
        .insert({
          thread_id: payload.input?.threadId,
          parent_post_id: payload.input?.parentPostId ?? null,
          body: payload.input?.body,
          author_id: user.id,
        })
        .select(POST_COLUMNS)
        .single();
      if (error) throw new HttpError(400, error.message);
      return json(data);
    }

    if (payload.action === "vote") {
      const { error } = await userClient.from("votes").upsert({
        user_id: user.id,
        target_type: payload.target?.type,
        target_id: payload.target?.id,
        value: payload.value,
      });
      if (error) throw new HttpError(400, error.message);
      return json({ ok: true });
    }

    if (payload.action === "report") {
      const { data, error } = await userClient
        .from("reports")
        .insert({
          reporter_id: user.id,
          target_type: payload.target?.type,
          target_id: payload.target?.id,
          reason: payload.reason,
        })
        .select("id, reporter_id, target_type, target_id, reason, status, created_at")
        .single();
      if (error) throw new HttpError(400, error.message);
      return json(data);
    }

    // Soft-delete: flip is_deleted so the row drops out of public reads but stays
    // recoverable. The write goes through userClient so the table guard trigger
    // still applies; the moderator gate above is the authorization.
    if (payload.action === "deleteThread") {
      if (!payload.id) throw new HttpError(400, "Thread id is required.");
      const { error } = await userClient
        .from("threads")
        .update({ is_deleted: true })
        .eq("id", payload.id);
      if (error) throw new HttpError(400, error.message);
      return json({ ok: true });
    }

    if (payload.action === "deletePost") {
      if (!payload.id) throw new HttpError(400, "Post id is required.");
      const { error } = await userClient
        .from("posts")
        .update({ is_deleted: true })
        .eq("id", payload.id);
      if (error) throw new HttpError(400, error.message);
      return json({ ok: true });
    }

    throw new HttpError(400, "Unknown community write action.");
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const retryAfter = err instanceof HttpError ? err.retryAfter : undefined;
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Community write failed." }),
      {
        status,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}),
        },
      },
    );
  }
});
