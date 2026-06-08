# Community runtime seam

This directory is the **only** runtime (network, stateful, multi-user) layer in the
app. Everything else in `src/` renders static, build-time filing artifacts. Keep that
boundary: community code references filing content by id (`FilingSection.id`,
`FilingChunk.id`) but never imports or mutates the generated artifacts, and the
ingestion pipeline never imports anything from here.

## Files

- `types.ts` — frontend domain types (`Thread`, `Post`, `CommunityUser`, …).
- `config.ts` — `communityEnabled` flag + public Supabase config (env-guarded).
- `client.ts` — the `CommunityClient` interface and `getCommunityClient()`. UI
  depends on this interface only.

## Going live

1. `npm install @supabase/supabase-js`
2. Create `client.supabase.ts` implementing `CommunityClient` (template in
   [docs/community-platform-plan.md](../../../docs/community-platform-plan.md) §6).
3. In `client.ts`, statically import the Supabase impl and make `getCommunityClient()`
   return it when `communityEnabled` is true.
4. Set `VITE_COMMUNITY_ENABLED` / `VITE_SUPABASE_*` (see `.env.example`).
5. Apply [supabase/migrations/0001_community.sql](../../../supabase/migrations/0001_community.sql)
   and configure the X/Twitter OAuth 2.0 provider — see `supabase/README.md`.

The impl lives in a separate file so the not-yet-installed dependency stays out of the
typechecked build until you're ready.
