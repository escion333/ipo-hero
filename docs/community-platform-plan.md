# Community Platform Plan — Accounts, X OAuth, Forums

Status: **scaffolded; ready for implementation** · Last updated: 2026-06-07

This document plans the first stateful tier for IPO Hero: user accounts (onboarding
via X/Twitter OAuth) and prospectus-linked discussion forums. AI chat and live
user-to-user chat are explicitly **out of scope** for this phase.

> Read [CLAUDE.md](../CLAUDE.md) first. The constraints there (no advice, every claim
> cites source text) shape the moderation and product decisions below.

---

## 0. Handoff — read this first

This is a handoff to an implementing agent. The product decisions are **locked** (§A);
do not re-litigate them. The repo already contains a typed runtime seam, the DB schema,
and config — all building green with no new deps (§6). Your job is §8: install the
dependency, write the Supabase client implementation, add routing + auth context, and
build the forum UI.

### A. Decisions locked (do not reopen)

1. **Stack: Supabase** (Postgres + Auth + RLS). Rationale in §2.
2. **Public read, auth-gated write.** Anyone can browse threads/posts; creating a
   thread, replying, and voting require an X sign-in. RLS already enforces this.
3. **X OAuth is the primary onboarding**, with an **email/OTP fallback** provider so
   sign-in isn't hostage to X's API status.
4. **Voice boundary:** the *no-advice / cite-everything* rule constrains **IPO Hero's
   own voice** (facts/risks/brief), **not** forum users. Users may voice investment
   opinions; the app stays the neutral, sourced substrate. See §7.
5. **Single-filing UI, multi-filing-ready schema.** Build the forum UI scoped to the
   one SpaceX filing; the `filing_accession` column exists so we don't migrate later.
6. **Runtime tier stays isolated** from the ingestion pipeline. Forums reference filing
   content by id only (`FilingSection.id`); never copy or mutate generated artifacts,
   and never import `src/lib/community/*` from `scripts/`.

### B. Prerequisites the human must provide (agent cannot do these)

The implementing agent has **no access to the Supabase or X dashboards**. Before the
feature can run end-to-end, the human owner must hand back:

- [ ] **Supabase project** created → its **Project URL** + **anon key** (for `.env`).
- [ ] **Migration applied** — `supabase/migrations/0001_community.sql` run against that
      project (via `supabase db push` or the SQL editor). See `supabase/README.md`.
- [ ] **X provider configured** in Supabase (Auth → Providers → X/Twitter OAuth 2.0): X app
      **Client ID + Secret** entered there, and Supabase's callback URL
      (`https://<ref>.supabase.co/auth/v1/callback`) registered in the X developer
      portal. X app must have **OAuth 2.0** enabled with scopes `users.read tweet.read`.
- [ ] **Email/OTP fallback** provider enabled in Supabase Auth.
- [ ] **Redirect URLs** added in Supabase (`http://localhost:5173` for dev + prod
      origin), each resolving an `/auth/callback` route.

The agent can build and locally typecheck everything without these, using the
unconfigured stub; full runtime verification needs the above filled in.

---

## 1. Why this is a real architectural shift

Today IPO Hero is a **100% static, build-time app**. There is no server, database,
auth, or runtime API. [src/lib/filing-data.ts](../src/lib/filing-data.ts) imports
committed JSON from `src/data/generated/` and the React app renders it read-only.

Accounts and forums are **stateful, multi-user, runtime** features — the opposite of
the current model. The bulk of the work is standing up a backend tier **once**;
OAuth and forums are comparatively small once it exists.

**Hard rule:** the new runtime data layer must stay **isolated** from the
deterministic ingestion pipeline. The pipeline (`scripts/`) and its static artifacts
remain the single source of truth for filing content. Forums only ever *reference*
filing content by stable id (`FilingSection.id`, `FilingChunk.id`) — never copy or
mutate it.

---

## 2. Recommended stack: Supabase

For a project at this stage, buy the backend instead of building it. **Supabase**
gives us, as managed services, everything this phase needs:

| Need | Supabase feature |
| --- | --- |
| Database | Postgres |
| Accounts + sessions | Supabase Auth (JWT sessions managed by `supabase-js` in the browser SPA) |
| **X/Twitter OAuth** | Built-in X/Twitter OAuth 2.0 provider — no custom OAuth code |
| Authorization | Row-Level Security (RLS) policies in the DB |
| API | Auto-generated REST/`supabase-js`; no API server to write |
| File uploads (avatars, later) | Storage |

Rough cost: free tier covers early usage; ~$25/mo Pro when it grows. This collapses
the "backend foundation" from 1–2 weeks of custom work to ~2–3 days of config + schema.

**Alternatives considered:** custom Node/Postgres API (more control, ~2× the time and
ongoing ops); Firebase (good auth/realtime, but NoSQL fits forum threading poorly and
no native Twitter-OAuth-to-Postgres-RLS story). Supabase wins on time-to-value and
because Postgres + RLS models threaded forums cleanly.

---

## 3. Lift estimate

Assumes one experienced dev. Foundation is a shared, one-time cost.

| Slice | Lift | Notes |
| --- | --- | --- |
| **Foundation** (Supabase project, schema, RLS, client seam, deploy/env/CI) | **2–3 days** | One-time. Already scaffolded — see §6. |
| **X OAuth onboarding** | **1–2 days** | Provider is built in; you already have X dev approval. Work is config + profile bootstrapping + sign-in UI + email fallback. |
| **Forums** (threads tied to sections, replies, voting, moderation, pagination) | **1–2 weeks** | Mostly CRUD; moderation + spam handling is where it grows. |

**Total: ~2–3 weeks** for a solid v1, foundation-dominated.

---

## 4. Onboarding flow (X/Twitter OAuth)

```
User clicks "Sign in with X"
  → supabase.auth.signInWithOAuth({ provider: 'twitter' })
  → X consent screen (uses your approved X dev app keys)
  → redirect back to /auth/callback with code
  → client calls exchangeCodeForSession(code); supabase-js stores/refreshes the SPA session
  → DB trigger handle_new_user() inserts a row into public.profiles
     (x_user_id, handle, display_name, avatar_url from the OAuth identity)
  → client reads profile; user is onboarded
```

Key decisions:

- **Client secret never touches the frontend.** The X app's Client ID/Client Secret are
  configured **in the Supabase dashboard** (Auth → Providers → X/Twitter OAuth 2.0),
  not in any `VITE_` var. The frontend only ever sees the public anon key.
- **This is a browser SPA auth flow, not SSR.** Do not promise httpOnly cookies unless a
  server/SSR tier is introduced later. The `/auth/callback` route should exchange the
  OAuth code and let `supabase-js` manage the browser session.
- **Always ship an email/OTP fallback** alongside X, so onboarding isn't hostage to a
  single provider's API status.
- **Profiles are app-owned.** `auth.users` is Supabase-managed; we mirror the public,
  display-safe fields into `public.profiles` via a trigger so the app never queries
  the auth schema directly and RLS stays simple.
- **Callback URL** must be registered in both the X developer portal and Supabase.
  For local dev that's `http://localhost:5173` (Vite) plus the Supabase callback URL.

---

## 5. Data model (forums ↔ filing)

Forums reference filing content by **stable string id**, with no foreign key into the
filing (the filing lives in static JSON, not the DB). A thread is either **general** or
**scoped to one filing section** via `section_id`.

```
profiles (id=auth.users.id, x_user_id, handle, display_name, avatar_url, role)
   └──< threads (id, filing_accession, section_id?, title, body, author_id, …)
            └──< posts (id, thread_id, parent_post_id?, body, author_id, …)
   votes   (user_id, target_type['thread'|'post'], target_id, value[-1|1])
   reports (id, reporter_id, target_type, target_id, reason, status)   -- moderation
```

- `filing_accession` is denormalized onto threads so the model is forward-compatible
  if IPO Hero ever covers more than the one hardcoded SpaceX filing. Today it defaults
  to the single accession in `scripts/lib/sec.ts`.
- `section_id` is a free-text reference to `FilingSection.id`. The frontend validates
  it against the loaded sections; the DB does not (and cannot) FK it.
- Vote scores are denormalized onto threads/posts via trigger for cheap sorting.
- Soft-delete (`is_deleted`) everywhere instead of hard delete, for moderation/audit.
- RLS + write guards keep server-owned fields server-owned: clients cannot change
  profile roles, vote/reply counters, locks, authorship, or deleted-content restoration.

The runnable schema + RLS lives in
[supabase/migrations/0001_community.sql](../supabase/migrations/0001_community.sql).

---

## 6. What is scaffolded in this repo (this PR)

Scaffolding only — nothing is wired into the rendered app yet, and the build stays
green with no new dependencies installed.

| Path | Purpose |
| --- | --- |
| `docs/community-platform-plan.md` | This document. |
| `supabase/migrations/0001_community.sql` | Runnable Postgres schema + RLS + triggers. |
| `supabase/README.md` | How to create the project, set the X/Twitter OAuth 2.0 provider, apply migrations. |
| `src/lib/community/types.ts` | Domain types (`Thread`, `Post`, `CommunityUser`, …) tied to `FilingSection.id`. |
| `src/lib/community/config.ts` | Env-guarded `communityEnabled` flag (mirrors the `VITE_USE_MOCK` seam). |
| `src/lib/community/client.ts` | `CommunityClient` interface + an unconfigured impl that throws a helpful error. |
| `src/lib/community/README.md` | How to drop in the real Supabase client. |
| `.env.example` | New `VITE_SUPABASE_*` / `VITE_COMMUNITY_ENABLED` vars (public only). |

### The runtime seam

The frontend talks to forums through the `CommunityClient` **interface** only. Today
`getCommunityClient()` returns an unconfigured stub. To go live:

1. `npm install @supabase/supabase-js`
2. Add `src/lib/community/client.supabase.ts` implementing `CommunityClient` (template
   below).
3. Statically import it from `client.ts` and point `getCommunityClient()` at it when
   `communityEnabled` is true.

This keeps the not-yet-installed dependency out of the typechecked build until you're
ready, exactly like the mock-data seam keeps fixtures out of production.

```ts
// src/lib/community/client.supabase.ts  (add after `npm i @supabase/supabase-js`)
import { createClient } from "@supabase/supabase-js";
import { communityConfig } from "./config";
import type { CommunityClient } from "./client";

const sb = createClient(communityConfig.supabaseUrl, communityConfig.supabaseAnonKey);

export const supabaseCommunityClient: CommunityClient = {
  async signInWithX() {
    await sb.auth.signInWithOAuth({
      provider: "twitter",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  },
  async signInWithEmail(email) {
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) throw error;
  },
  async completeOAuthCallback() {
    const code = new URLSearchParams(window.location.search).get("code");
    if (!code) return;
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (error) throw error;
  },
  onAuthStateChange(callback) {
    const { data } = sb.auth.onAuthStateChange(async () => {
      callback(await this.getCurrentUser());
    });
    return () => data.subscription.unsubscribe();
  },
  async signOut() { await sb.auth.signOut(); },
  async getCurrentUser() {
    const { data } = await sb.auth.getUser();
    if (!data.user) return null;
    const { data: p } = await sb
      .from("profiles").select("*").eq("id", data.user.id).single();
    return p && {
      id: p.id,
      handle: p.handle,
      displayName: p.display_name,
      avatarUrl: p.avatar_url,
      role: p.role,
    };
  },
  async listThreads({ sectionId } = {}) {
    let q = sb.from("threads").select("*, author:profiles(*)")
      .eq("is_deleted", false).order("score", { ascending: false });
    if (sectionId !== undefined) q = sectionId === null
      ? q.is("section_id", null) : q.eq("section_id", sectionId);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map(rowToThread);
  },
  // …getThread / createThread / listPosts / createPost / vote — same shape
};
```

---

## 7. Moderation, abuse, and the product-constraint tension

User-generated content is the real ongoing cost, not the build:

- **Moderation:** soft-delete + a `reports` table are scaffolded. v1 plan: author can
  delete own content; a `moderator` role (on `profiles.role`) can soft-delete anything.
  Add rate limits (Supabase Edge Function or DB trigger) before launch to blunt spam.
- **Voice boundary (decided):** the *cited, no-advice* constraint governs **IPO
  Hero's own voice** — the extracted facts, risks, and brief that the app asserts. It
  does **not** apply to forum content. Users discussing and debating the filing —
  including their own opinions on whether it's a good investment — is the *point* of
  the forum; the app is the neutral, sourced substrate they argue over, not a
  participant. We don't propose investment views; users do, and they own them. Guardrails:
  (a) clear UI separation + a persistent disclaimer that forum posts are user opinion,
  not IPO Hero analysis; (b) `section_id` on threads anchors discussion to source so
  debate stays close to the actual text (a nudge, not a gate); (c) standard community
  guidelines (no spam/harassment/manipulation) — but explicitly **not** a ban on users
  voicing buy/sell opinions.
- **Legal/ToS:** add Terms + a content policy before accepting public posts.

---

## 8. Implementation task list (for the implementing agent)

Do these in order. Each step should keep `npm run typecheck` and `npm run lint` green.

### Step 0 — routing gap (read before you start)

The app has **no router**. [src/main.tsx](../src/main.tsx) switches between
`BriefRedesign` (default) and `App` (`?reviewer`) by reading a query param — that's the
entire "routing." Forums need real routes (`/forums`, `/forums/thread/:id`, and
`/auth/callback` for the OAuth redirect). **Add `react-router-dom`** and introduce a
real router at the entry point, preserving the existing Brief/reviewer behavior (e.g.
Brief at `/`, reviewer at `/reviewer`, forums under `/forums`). Keep this change
contained; don't rewrite the existing views.

### Step 1 — Supabase client (foundation)

- `npm install @supabase/supabase-js`
- Create `src/lib/community/client.supabase.ts` implementing `CommunityClient` (template
  in §6). Write the `rowToThread` / `rowToPost` / `rowToUser` mappers (snake_case DB →
  camelCase domain types in `types.ts`).
- Use Supabase's SDK provider id for X/Twitter OAuth 2.0: `provider: "twitter"`.
- In `src/lib/community/client.ts`, make `getCommunityClient()` return the Supabase impl
  when `communityEnabled`, else the existing `unconfiguredCommunityClient`.

### Step 2 — auth context + sign-in

- `src/lib/community/auth.tsx` — a React context/provider exposing
  `{ user, loading, signInWithX, signInWithEmail, signOut }`, backed by the client and
  Supabase's `onAuthStateChange`. A `useCommunityUser()` hook for components.
- An `/auth/callback` route/component that calls `exchangeCodeForSession` through the
  community client, then redirects back.
- A sign-in surface ("Sign in with X" + email fallback). Logged-out users see read-only
  forums with write controls replaced by this prompt (decision A.2).

### Step 3 — forum UI (read path first)

- `/forums` — thread list, sortable by score/recency, filterable by `sectionId`
  (general vs. a specific section). Renders for everyone.
- `/forums/thread/:id` — thread + nested posts.
- Anchor to source: when a thread has a `sectionId`, link to that section in the
  reader/workbench so debate stays tied to the filing text.
- Persistent disclaimer banner: "Forum posts are user opinion, not IPO Hero analysis."

### Step 4 — write path (auth-gated)

- New thread / reply forms, vote controls — all gated behind an authenticated session
  (the DB already rejects unauthenticated writes via RLS; gate the UI to match).
- Validate `sectionId` against loaded sections client-side before submit.
- Optimistic vote UI is fine; the score trigger reconciles server-side.

### Step 5 — moderation + safety (before any public launch)

- Report action (writes to `reports`), author self-delete (soft), moderator soft-delete.
- Rate-limit writes (Supabase Edge Function or DB trigger) to blunt spam.
- Ship Terms + a content policy.

### Verification

- `npm run typecheck`, `npm run lint`, `npm run build` all green.
- With the §B prerequisites filled in and `.env` set: sign in with X, create a thread on
  a section, reply, vote, sign out, confirm logged-out read works and writes are blocked.
- The `/verify` and `/run` skills can drive the app for manual confirmation.

> **Out of scope this phase:** AI-over-filing chat and live user-to-user chat are
> separate, larger builds — revisit only once the forum audience justifies them.

## 9. Open questions (deferred — not blocking)

All product decisions are locked in §A. Capacity/scale (targeting thousands of users) is
tracked separately in [community-scaling-plan.md](community-scaling-plan.md). One
non-blocking product question remains, safe to decide after the read path works:

- **Surfacing forum activity in the reader Brief** (e.g. "12 discussions on this risk
  factor") vs. keeping forums on a separate `/forums` route. Since reads are public,
  showing counts in the Brief is feasible; defer until the forum UI exists.
