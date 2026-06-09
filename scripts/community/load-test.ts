import { createClient } from "@supabase/supabase-js";

type Sample = {
  name: string;
  ms: number;
  ok: boolean;
};

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const supabaseAnonKey =
  process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const concurrency = Number(process.env.COMMUNITY_LOAD_CONCURRENCY ?? 100);
const durationMs = Number(process.env.COMMUNITY_LOAD_DURATION_MS ?? 60_000);
const mode = process.env.COMMUNITY_LOAD_MODE ?? "active";
const minThinkMs = Number(process.env.COMMUNITY_LOAD_THINK_MS_MIN ?? 10_000);
const maxThinkMs = Number(process.env.COMMUNITY_LOAD_THINK_MS_MAX ?? 30_000);
const writeAccessTokens = (
  process.env.COMMUNITY_LOAD_ACCESS_TOKENS ??
  process.env.COMMUNITY_LOAD_ACCESS_TOKEN ??
  ""
)
  .split(",")
  .map((token) => token.trim())
  .filter(Boolean);

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Set SUPABASE_URL and SUPABASE_ANON_KEY, or VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.",
  );
}

const client = createClient(supabaseUrl, supabaseAnonKey);
const writeClients = writeAccessTokens.map((token) =>
  createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  }),
);

const threadColumns =
  "id, filing_accession, section_id, title, body_preview, author_id, author_handle, author_display_name, author_avatar_url, author_role, score, reply_count, is_locked, is_deleted, created_at, updated_at";
const postColumns =
  "id, thread_id, parent_post_id, body, author_id, score, is_deleted, created_at, updated_at, author:profiles!posts_author_id_fkey(id, handle, display_name, avatar_url, role)";

const samples: Sample[] = [];

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

async function measure(name: string, fn: () => Promise<unknown>) {
  const started = performance.now();
  try {
    await fn();
    samples.push({ name, ms: performance.now() - started, ok: true });
  } catch (err) {
    samples.push({ name, ms: performance.now() - started, ok: false });
    if (process.env.COMMUNITY_LOAD_VERBOSE === "true") {
      console.error(name, err);
    }
  }
}

async function listTopThreads() {
  const { error } = await client
    .from("thread_list_items")
    .select(threadColumns)
    .order("score", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(25);
  if (error) throw error;
}

async function listRecentThreads() {
  const { error } = await client
    .from("thread_list_items")
    .select(threadColumns)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(25);
  if (error) throw error;
}

async function listPosts(threadId: string) {
  const { error } = await client
    .from("posts")
    .select(postColumns)
    .eq("thread_id", threadId)
    .eq("is_deleted", false)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(50);
  if (error) throw error;
}

async function vote(threadId: string, worker: number) {
  if (writeClients.length === 0) return;
  const writeClient = writeClients[worker % writeClients.length];
  const { error } = await writeClient.functions.invoke("community-write", {
    body: { action: "vote", target: { type: "thread", id: threadId }, value: 1 },
  });
  if (error) throw error;
}

async function seedThreadIds() {
  const { data, error } = await client
    .from("thread_list_items")
    .select("id")
    .order("score", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []).map((row) => row.id as string);
}

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runAction(worker: number, threadIds: string[]) {
  const threadId = threadIds[randomInt(0, threadIds.length - 1)];
  const roll = Math.random();
  if (roll < 0.35) {
    await measure("read:threads_top", listTopThreads);
  } else if (roll < 0.55) {
    await measure("read:threads_recent", listRecentThreads);
  } else if (roll < 0.98 || writeClients.length === 0) {
    await measure("read:posts", () => listPosts(threadId));
  } else {
    await measure("write:vote", () => vote(threadId, worker));
  }
}

function report() {
  const names = [...new Set(samples.map((sample) => sample.name))];
  let failed = false;

  for (const name of names) {
    const group = samples.filter((sample) => sample.name === name);
    const ok = group.filter((sample) => sample.ok);
    const values = ok.map((sample) => sample.ms);
    const p95 = percentile(values, 95);
    const p99 = percentile(values, 99);
    const errors = group.length - ok.length;
    const slo =
      name === "write:vote"
        ? { p95: 750, p99: 2_000 }
        : name === "read:posts"
          ? { p95: 400, p99: 1_000 }
          : { p95: 300, p99: 750 };

    if (errors > 0 || p95 > slo.p95 || p99 > slo.p99) failed = true;
    console.log(
      `${name}: count=${group.length} errors=${errors} p95=${p95.toFixed(0)}ms p99=${p99.toFixed(0)}ms slo_p95=${slo.p95}ms slo_p99=${slo.p99}ms`,
    );
  }

  if (failed) process.exitCode = 1;
}

async function main() {
  const threadIds = await seedThreadIds();
  if (threadIds.length === 0) throw new Error("No community threads found to load-test.");

  const stopAt = Date.now() + durationMs;

  await Promise.all(
    Array.from({ length: concurrency }, async (_, worker) => {
      if (mode === "active") {
        await sleep(randomInt(0, maxThinkMs));
      }
      while (Date.now() < stopAt) {
        await runAction(worker, threadIds);
        if (mode === "active") {
          await sleep(randomInt(minThinkMs, maxThinkMs));
        }
      }
    }),
  );

  report();
}

await main();
