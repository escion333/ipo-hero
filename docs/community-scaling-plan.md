# Community Platform — Scaling & Capacity Plan

Status: **implemented in repo; pending Supabase deploy + load test** · Last updated: 2026-06-08

Companion to [community-platform-plan.md](community-platform-plan.md). That doc plans the
*build*; this one tracks the **capacity question it left open** (see its §9): how many
users can the community tier handle, and what we must do to be ready for **thousands of
users**.

> The app, migration, Edge Function, and load-test script are implemented locally.
> Capacity is not verified until the Supabase migrations/functions are deployed and the
> load test is run against the real project. The numbers below remain targets and
> hypotheses until then.

---

## 1. Target

Plan for **thousands of registered users** (low five figures), with the understanding
that concurrent/active users at any moment is a small fraction of that. Concretely, the
working assumptions until we measure:

- Registered users: **~10,000** ceiling for this planning horizon.
- Peak concurrent active sessions: **~500–1,000** (5–10% of registered).
- Read-heavy workload: forums are browsed far more than they're posted to. Expect a
  high read:write ratio (rough planning assumption ~50:1).
- Page shape: thread lists default to **25 threads/page**; post lists default to
  **50 posts/page**. Hard cap requested page sizes at **100 rows**.
- Latency SLOs for the first load-test target:
  - Public reads: p95 thread list < **300ms**, p99 < **750ms**.
  - Thread detail + first post page: p95 < **400ms**, p99 < **1s**.
  - Writes (thread/post/vote): p95 < **750ms**, p99 < **2s**.

These are assumptions to **validate by load testing**, not commitments.

---

## 2. What already scales (and why)

The architecture in the platform plan is favorable for read-heavy scale:

- **Filing content is static build-time JSON** served from a CDN — effectively unlimited
  readers, zero DB load. (Platform plan §1.)
- **Forum reads are public** and hit Postgres directly via `supabase-js`, sorted by a
  **denormalized `score` column** so list queries don't aggregate votes at read time.
  (Platform plan §5.)
- **Browser SPA auth flow, no app server** — there's no custom API tier to become a
  bottleneck; Supabase Auth issues/refreshes JWTs client-side. (Platform plan §4.)

So the ceiling is **the Supabase Postgres + Auth instance and our query/index design**,
not application servers.

---

## 3. Known gaps that block thousands-of-users readiness

Ordered roughly by priority. None of these are done in the scaffold.

### 3.1 Rate limiting (must-have before public launch)
The platform plan flags rate limits as a pre-launch TODO (its §7 and Step 5) but does
**not** build them. Without it, write capacity is unprotected and a handful of abusive
clients can saturate the DB.
- **Build decision:** use Supabase Edge Functions for public write entrypoints if we need
  per-IP limits. DB triggers/RPC can enforce per-user limits, but direct PostgREST table
  writes do not give us a trustworthy client IP signal.
- **Action:** move thread/post/vote writes behind rate-limited functions or RPC wrappers,
  then remove direct client writes for those paths.
- **Initial limits to implement and tune:**
  - Threads: 3/minute, 20/day per user; 10/minute per IP.
  - Posts: 10/minute, 100/day per user; 30/minute per IP.
  - Votes: 60/minute, 1,000/day per user; 120/minute per IP.
  - Reports: 10/hour per user; 30/hour per IP.
- **Abuse response:** return `429` with a short retry window; do not silently drop writes.

### 3.2 Pagination & query bounds
The scaffolded `listThreads` (platform plan §6) does `select("*")` ordered by score with
**no limit** — fine at dozens of threads, a problem at thousands.
- **Action:** change the `CommunityClient` API before building more UI:
  - `listThreads(opts?: { sectionId?: string | null; cursor?: ThreadCursor; limit?: number })`
    returns `{ items: Thread[]; nextCursor: ThreadCursor | null }`.
  - `listPosts(opts: { threadId: string; cursor?: PostCursor; limit?: number })`
    returns `{ items: Post[]; nextCursor: PostCursor | null }`.
- **Thread cursor:** `{ score: number; createdAt: string; id: string }`, ordered by
  `score desc, created_at desc, id desc`. The `id` tie-breaker is required so rows are
  not duplicated or skipped when scores/timestamps collide.
- **Post cursor:** `{ createdAt: string; id: string }`, ordered by
  `created_at asc, id asc`.
- **Query rule:** never call `.select("*")` from list endpoints; select only the fields
  rendered by the list UI plus display-safe author fields.
- **Nested posts:** keep v1 shallow; paginate by `thread_id` first. If deep nesting ships
  later, add a separate child-replies endpoint instead of loading an entire tree.

### 3.3 Indexing
At thousands of threads/posts, list and filter queries need indexes.
- **Current gap:** `0001_community.sql` has separate `threads(section_id)`,
  `threads(filing_accession)`, and `threads(score desc)` indexes. The real list query
  filters deleted/section and orders by `score desc, created_at desc`, so separate
  single-column indexes are not enough.
- **Action:** add a follow-up migration with the query-shaped indexes below:

```sql
create index if not exists threads_public_section_rank_idx
  on public.threads (section_id, score desc, created_at desc, id desc)
  where not is_deleted;

create index if not exists threads_public_filing_section_rank_idx
  on public.threads (filing_accession, section_id, score desc, created_at desc, id desc)
  where not is_deleted;

create index if not exists threads_public_general_rank_idx
  on public.threads (score desc, created_at desc, id desc)
  where not is_deleted and section_id is null;

create index if not exists posts_public_thread_created_idx
  on public.posts (thread_id, created_at asc, id asc)
  where not is_deleted;

create index if not exists reports_status_created_idx
  on public.reports (status, created_at asc);
```

- **Already covered:** `votes` has `primary key (user_id, target_type, target_id)`, which
  satisfies the per-user uniqueness lookup.
- **Validation:** after adding the migration, run `explain analyze` for the exact
  thread-list, general-thread-list, post-list, report-queue, and vote-upsert paths on a
  seeded dataset.

### 3.4 Connection limits / pooling
Supabase free/small tiers have low direct Postgres connection caps. A browser-SPA fan-out
of `supabase-js` clients goes through PostgREST (pooled), which helps, but verify under
load.
- **Action:** keep browser access through the Supabase HTTP API/PostgREST via
  `supabase-js`; do not introduce direct browser database connections.
- **Action:** if Edge Functions are added for write rate-limiting, ensure any server-side
  database access uses the pooler, not direct unpooled connections.
- **Load-test check:** at 1,000 simulated active sessions, track PostgREST request
  latency, DB connections, pooler utilization, and rejected/queued requests.

### 3.5 Hot-row write contention on vote/score triggers
Vote scores are denormalized via trigger (platform plan §5). A popular thread getting many
simultaneous votes serializes on that row's update.
- **Also applies to replies:** `apply_reply_delta()` updates the parent `threads` row on
  every post insert/delete, so popular live threads can serialize on `reply_count` as
  well as vote `score`.
- **Action:** benchmark burst writes separately:
  - 1,000 votes/minute on one thread.
  - 1,000 votes/minute distributed across 100 threads.
  - 200 replies/minute on one thread.
- **Pass condition:** p95 write latency stays under the write SLO and no lock waits form
  a growing backlog.
- **Fallback if it fails:** keep optimistic UI, but move `score`/`reply_count` updates to
  an append-only event table plus periodic reconciliation job, or only recompute hot
  counters asynchronously.

### 3.6 N+1 on author joins
`select("*, author:profiles(*)")` is fine via PostgREST embedding, but verify it doesn't
degrade on large thread lists; consider selecting only display-safe profile columns.
- **Action:** list endpoints must select only:
  `id, filing_accession, section_id, title, body, score, reply_count, is_locked,
  created_at, updated_at` plus `author:profiles(id, handle, display_name, avatar_url, role)`.
- **Validation:** include embedded-author list queries in `explain analyze` and load tests.

### 3.7 Moderation queue growth
Reports are currently manual and only readable by moderators. That is fine for v1, but
the queue needs enough shape to avoid becoming an unbounded table scan.
- **Action:** add `reports(status, created_at)` index in the follow-up migration.
- **Action:** add moderator-list pagination before shipping a moderation dashboard.
- **Open threshold:** if report volume exceeds 100 open reports/day, build assignment,
  bulk resolution, and reason/category filters.

---

## 4. Tier / cost ladder

The platform plan (§2) only says "free tier covers early usage; ~$25/mo Pro when it
grows." For thousands of users we should map tiers to milestones.

Current Supabase numbers checked on **2026-06-08**:

- Free includes **50,000 MAU**, 500 MB database size, 5 GB egress, and shared compute.
- Pro starts at **$25/month**, includes **100,000 MAU**, 8 GB database size, 250 GB
  egress, 7-day log retention, daily backups, and one Micro compute instance covered by
  compute credits.
- Micro compute lists **60 direct** and **200 pooler** connections. Larger compute
  upgrades increase connection ceilings.

| Milestone | Likely tier | What to watch |
| --- | --- | --- |
| Private/dev launch | Free | Inactivity pause, 500 MB DB limit, 1-day logs |
| Public launch / first hundreds | Pro (~$25/mo) | Backups, log retention, support, production posture |
| ~1k+ registered | Pro / Micro compute | DB CPU, pooler connections, egress, rate-limit noise |
| ~10k registered | Pro + compute upgrade if load tests require it | Postgres CPU, lock waits, storage, pooler saturation |

- **Interpretation:** the 10k registered-user target is unlikely to be blocked by Auth
  MAU quota. The real gating factors are production readiness, DB/query behavior, abuse
  controls, storage/log retention, and burst write contention.
- **Action:** re-check these numbers before launch and record the exact pricing-page date
  in this doc, because cloud limits change.

---

## 5. Build Order

Implement in this order so each step reduces risk before UI growth increases surface area:

1. **API shape:** update `CommunityClient` pagination types and list return values.
2. **Query bounds:** add limits, stable keyset cursors, and explicit select column lists.
3. **Indexes:** add the follow-up migration in §3.3.
4. **Write gates:** choose Edge Function/RPC path for writes, implement rate limits, and
   remove direct client table writes for gated actions.
5. **Moderation list:** paginate report queue before adding larger moderator tooling.
6. **Seed/load tooling:** create a repeatable seeded dataset and load-test script.
7. **Observability:** wire dashboards/alerts for latency, error rate, DB CPU,
   connections, pooler utilization, lock waits, and rate-limit hits.
8. **Tune:** run the load test, adjust limits/indexes/compute, and record actual results.

---

## 6. Before we call it "ready for thousands"

A definition-of-done checklist for this doc:

- [ ] Rate limiting implemented and tuned (§3.1).
- [ ] Pagination on all list endpoints (§3.2).
- [ ] Composite/partial indexes added via migration (§3.3).
- [ ] Connection/pooling behavior load-tested (§3.4).
- [ ] Vote and reply-counter trigger contention assessed under burst (§3.5).
- [ ] Report queue indexed and paginated (§3.7).
- [ ] A **load test** simulating ~1,000 concurrent sessions at the assumed read:write
      ratio, with the pass/fail latency targets in §1.
- [ ] Supabase tier mapped to user milestones with cost (§4).
- [ ] Basic observability: query latency, error rate, DB CPU/connections, pooler
      utilization, lock waits, and rate-limit dashboards.

---

## 7. Open questions

- Do we need read replicas / caching (e.g. CDN-cached thread lists) at 10k, or is
  Postgres + indexes enough?
- Should voting stay available to brand-new accounts immediately, or should vote limits
  tighten for accounts younger than 24 hours?
- Do moderators need audit-log retention beyond Supabase's normal log retention?
