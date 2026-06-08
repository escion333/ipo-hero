# Community Platform — Scaling & Capacity Plan

Status: **open / to be addressed** · Last updated: 2026-06-08

Companion to [community-platform-plan.md](community-platform-plan.md). That doc plans the
*build*; this one tracks the **capacity question it left open** (see its §9): how many
users can the community tier handle, and what we must do to be ready for **thousands of
users**.

> This is a planning placeholder to address later — nothing here is built or measured
> yet. The numbers below are targets and hypotheses, not verified results.

---

## 1. Target

Plan for **thousands of registered users** (low five figures), with the understanding
that concurrent/active users at any moment is a small fraction of that. Concretely, the
working assumptions until we measure:

- Registered users: **~10,000** ceiling for this planning horizon.
- Peak concurrent active sessions: **~500–1,000** (5–10% of registered).
- Read-heavy workload: forums are browsed far more than they're posted to. Expect a
  high read:write ratio (rough planning assumption ~50:1).

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
- **Action:** rate-limit thread/post/vote writes (Supabase Edge Function or DB trigger),
  per-user and per-IP. Decide limits (e.g. N posts/min, M votes/min).

### 3.2 Pagination & query bounds
The scaffolded `listThreads` (platform plan §6) does `select("*")` ordered by score with
**no limit** — fine at dozens of threads, a problem at thousands.
- **Action:** add keyset/cursor pagination to `listThreads` and `listPosts`; cap page
  size; never `select("*")` unbounded. Paginate nested posts in long threads.

### 3.3 Indexing
At thousands of threads/posts, list and filter queries need indexes.
- **Action:** confirm indexes in `supabase/migrations/0001_community.sql` for:
  `threads(filing_accession, section_id, score)`, `threads(created_at)`,
  `posts(thread_id, created_at)`, `votes(user_id, target_type, target_id)` (unique),
  `reports(status)`. Add a follow-up migration if missing.

### 3.4 Connection limits / pooling
Supabase free/small tiers have low direct Postgres connection caps. A browser-SPA fan-out
of `supabase-js` clients goes through PostgREST (pooled), which helps, but verify under
load.
- **Action:** confirm we're using the pooled endpoint; load-test connection behavior at
  target concurrency.

### 3.5 Hot-row write contention on vote/score triggers
Vote scores are denormalized via trigger (platform plan §5). A popular thread getting many
simultaneous votes serializes on that row's update.
- **Action:** evaluate whether the trigger update contends under burst voting; consider
  batched/periodic score reconciliation if it does. Optimistic UI already decouples the
  user experience (platform plan Step 4).

### 3.6 N+1 on author joins
`select("*, author:profiles(*)")` is fine via PostgREST embedding, but verify it doesn't
degrade on large thread lists; consider selecting only display-safe profile columns.

---

## 4. Tier / cost ladder

The platform plan (§2) only says "free tier covers early usage; ~$25/mo Pro when it
grows." For thousands of users we should map tiers to milestones:

| Milestone | Likely tier | What to watch |
| --- | --- | --- |
| Launch / first hundreds | Free or Pro | DB size, monthly active users (Auth MAU limit) |
| ~1k+ registered | Pro (~$25/mo) | Connection count, DB CPU, egress |
| ~10k registered | Pro + add-ons / compute upgrade | Postgres compute size, storage, rate-limit headroom |

- **Action:** confirm Supabase free/Pro **MAU** and **connection** limits against the
  ~10k target; decide the compute add-on threshold.

---

## 5. Before we call it "ready for thousands"

A definition-of-done checklist for this doc:

- [ ] Rate limiting implemented and tuned (§3.1).
- [ ] Pagination on all list endpoints (§3.2).
- [ ] Indexes verified/added via migration (§3.3).
- [ ] Connection/pooling behavior load-tested (§3.4).
- [ ] Vote-trigger contention assessed under burst (§3.5).
- [ ] A **load test** simulating ~1,000 concurrent sessions at the assumed read:write
      ratio, with pass/fail latency targets (define them: e.g. p95 thread-list < 300ms).
- [ ] Supabase tier mapped to user milestones with cost (§4).
- [ ] Basic observability: query latency, error rate, DB CPU/connections dashboards.

---

## 6. Open questions

- What are the real latency SLOs we want (p95/p99 for read and write paths)?
- Do we need read replicas / caching (e.g. CDN-cached thread lists) at 10k, or is
  Postgres + indexes enough?
- Moderation throughput at scale — does the `reports` queue need its own tooling once
  volume grows? (Ties into platform plan §7.)
