# Community Platform — Crosspost (X → forum) Plan

Status: **scoped; not built** · Last updated: 2026-06-08

Companion to [community-platform-plan.md](community-platform-plan.md) (the *build*) and
[community-scaling-plan.md](community-scaling-plan.md) (the *capacity question*). This doc
scopes one feature: letting a signed-in X user port **their own** existing X posts into the
forum as threads, to help bootstrap early activity.

> Nothing here is implemented yet. The schema, Edge Function action, client method, and UI
> below are a plan, not committed code.

---

## 1. Goal & guardrails

Let a signed-in X user paste a URL to **one of their own tweets**, and turn it into a normal
forum thread that renders the official X embed. The thread is otherwise ordinary: it takes
votes, replies, section scoping, and moderation like any other.

Two product decisions fix the risk posture:

- **Own posts only.** A user can only import tweets authored by their own linked X identity.
  Cleanest consent story, lowest legal exposure.
- **Official oEmbed embeds.** We display the sanctioned X embed card, not a copy of the
  tweet text re-presented as our own content. Free (no paid X API), stays within X's display
  expectations, and is auto-attributed.

**Honest limitation:** own-posts-only bootstraps *slowly* — it only helps if early users have
relevant SpaceX/space tweets. The intended seeding play within the constraint is that the
operator plus a handful of invited space/finance accounts self-import their back catalogs. If
activity stays thin, the lever to revisit is a future "curated third-party by moderators"
mode — **not** loosening to "anyone imports anyone."

Out of scope for v1: bulk/timeline import, media re-hosting, auto-sync of edits/likes/replies,
third-party imports, and paid-API identity proof.

---

## 2. Why this fits the existing stack

- X OAuth already exists (`signInWithX`, [client.supabase.ts](../src/lib/community/client.supabase.ts)).
- `profiles.x_user_id` and `profiles.handle` are populated from the OAuth identity by
  `handle_new_user()` ([0001_community.sql](../supabase/migrations/0001_community.sql)), so
  "is this your tweet?" is checkable without the paid API.
- All writes already funnel through the rate-limited `community-write` Edge Function
  ([supabase/functions/community-write/index.ts](../supabase/functions/community-write/index.ts)),
  so import gets abuse controls for free by adding one action.

---

## 3. Ownership verification

oEmbed returns `author_url` (e.g. `https://x.com/handle`). v1 verifies ownership by a
case-insensitive match of that handle against the caller's `profiles.handle`.

- **Known soft-check:** X handles can be reassigned, so a handle match is not hard identity
  proof. Acceptable for a low-stakes "share my own tweet" flow; documented, not hidden.
- The hard version — comparing the tweet author *id* to `profiles.x_user_id` — needs the paid
  X API and is out of v1.
- Email-only accounts have no X handle, so import is gated to X-authenticated users. Expected.

---

## 4. Data model

New migration `0003_community_crosspost.sql`. A **1:1 side table**, not new columns on
`threads` — the `guard_thread_write` trigger enumerates immutable thread fields, and a side
table avoids editing that guard and keeps RLS simple.

```sql
create table public.thread_sources (
  thread_id        uuid primary key references public.threads(id) on delete cascade,
  platform         text not null default 'x' check (platform in ('x')),
  source_tweet_id  text not null,
  source_url       text not null,
  source_handle    text not null,                  -- author handle at import time
  source_posted_at timestamptz,
  embed_html       text not null,                  -- cached oEmbed html
  embed_fetched_at timestamptz not null default now(),
  status           text not null default 'live'
                     check (status in ('live', 'removed')),
  imported_by      uuid not null references public.profiles(id),
  unique (platform, source_tweet_id)               -- dedup: a tweet imports once
);

alter table public.thread_sources enable row level security;
create policy thread_sources_read on public.thread_sources for select using (true);
-- no client insert/update policy: writes go through the Edge Function (service role) only.
```

- `threads.body` is `not null` (min 1 char). Set it to the importer's optional note, falling
  back to a snapshot of the tweet text — the user's *own* content, so storing it for
  full-text search is consent-clean even though **display** uses the embed.

---

## 5. Write path — extend `community-write`

Add an `importTweet` action to the Edge Function, reusing its auth + rate-limit machinery:

1. Validate the URL is a real tweet URL (`(twitter|x).com/.../status/<id>`); extract the id.
2. Fetch `https://publish.twitter.com/oembed?url=<url>` **server-side** (CORS + caching).
3. Verify `author_url` handle == caller's `profiles.handle`; reject otherwise (`403`).
4. Dedup on `(platform, source_tweet_id)`; on conflict return `409` with the existing thread id.
5. Insert the `threads` row (author = caller) **and** the `thread_sources` row.
6. Reject protected/deleted tweets (oEmbed returns no author / errors).

**Rate limit:** add an `import` action to the `limits` map, e.g. **5/min, 30/day per user** —
tighter than posts, since each import is heavier and backed by an outbound fetch.

---

## 6. Deleted-tweet behavior — keep the thread, tombstone the embed

Decision: when an imported tweet is deleted on X, **maintain the thread** (its replies and
votes survive) and **swap the embed for a "deleted" message**.

- Detection: a lightweight background re-validation (scheduled Edge Function / cron) re-hits
  oEmbed for `status = 'live'` rows; on a not-found result, set `status = 'removed'`. A lazy
  check at render time can be a fallback but shouldn't block the page.
- Render: for `status = 'removed'`, show a tombstone ("Original X post was deleted") in place
  of the embed card. Per the decision, we surface the tombstone, not the stored text snapshot.
- The snapshot stays in `threads.body` for search/audit but is not displayed once removed.

---

## 7. Frontend

- Add `importTweet(input)` to the `CommunityClient` interface
  ([client.ts](../src/lib/community/client.ts)) and its supabase implementation.
- Add a `ThreadSource` type and an optional `source?` field on `Thread` in
  [types.ts](../src/lib/community/types.ts).
- "Import from X" entry in the new-thread flow: a tweet-URL field + optional note + the
  existing section picker (reuses section scoping; no new scoping concept).
- Thread view renders cached `embed_html` via X `widgets.js`, behind a sanitize pass, with a
  provenance badge: "Crossposted from X by @handle · original ↗". (Matches this repo's
  provenance ethos.)
- **Replies are essential** and on by default — an imported thread is a normal discussion
  thread; the embed is just the opening post.
- **Surfacing is normal** — imported threads appear inline in the standard thread lists; no
  separate "Crossposts" tab or filter in v1.

---

## 8. Build order

1. Migration `0003_community_crosspost.sql` (`thread_sources` + RLS).
2. `importTweet` action in `community-write` (validate → oEmbed → ownership → dedup → insert),
   plus the `import` rate-limit entry.
3. Client method + types (`importTweet`, `ThreadSource`, `Thread.source`).
4. Import UI in the new-thread flow + embed render with provenance badge in thread view.
5. Background re-validation job for deleted-tweet tombstoning (§6).

---

## 9. Open / future

- Promote ownership check from handle-match to `x_user_id` match if/when a paid X API tier is
  justified.
- A future "curated third-party by moderators" mode if own-posts-only bootstraps too slowly —
  with its own attribution and embed-only display rules.
- Whether deleted-tweet tombstones should eventually offer the author a "replace with text"
  option (out of v1).
