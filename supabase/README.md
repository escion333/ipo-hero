# Supabase — community backend

Backend for IPO Hero accounts + forums. See
[docs/community-platform-plan.md](../docs/community-platform-plan.md) for the full plan.

## One-time setup

1. **Create a project** at https://supabase.com (note the project URL + anon key).
2. **Apply the schema.** Either paste
   [migrations/0001_community.sql](migrations/0001_community.sql) and follow-up
   migrations into the SQL editor,
   or with the Supabase CLI:
   ```bash
   supabase link --project-ref <ref>
   supabase db push
   ```
3. **Configure X/Twitter OAuth 2.0.** Dashboard → Authentication → Providers →
   X/Twitter (OAuth 2.0):
   - Enter the Client ID + Client Secret from your approved X developer app.
   - Copy the callback URL Supabase shows and register it in the X developer portal.
   - The secret lives here only — never in a `VITE_` var or the frontend.
4. **Add a fallback provider** (Email magic link or OTP) so onboarding doesn't depend
   solely on X.
5. **Redirect URLs.** Authentication → URL Configuration: add
   `http://localhost:5173` (Vite dev) and your production origin, each with an
   `/auth/callback` route.
6. **Frontend env.** Copy `supabaseUrl` + anon key into `.env` as
   `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, and set `VITE_COMMUNITY_ENABLED=true`.
7. **Deploy the write gate.** Thread/post/vote writes go through the rate-limited
   Edge Function in [functions/community-write](functions/community-write):
   ```bash
   supabase functions deploy community-write
   ```
   The function expects Supabase's standard `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
   `SUPABASE_SERVICE_ROLE_KEY` secrets. Hosted Supabase functions provide these for
   linked projects; for local function serving, set them in your local env.

## Load testing

After migrations are applied and the function is deployed, run the community load test
against the same SLOs in [docs/community-scaling-plan.md](../docs/community-scaling-plan.md):

```bash
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_ANON_KEY=<anon-key> \
COMMUNITY_LOAD_CONCURRENCY=100 \
COMMUNITY_LOAD_DURATION_MS=60000 \
COMMUNITY_LOAD_MODE=active \
COMMUNITY_LOAD_THINK_MS_MIN=10000 \
COMMUNITY_LOAD_THINK_MS_MAX=30000 \
npm run loadtest:community
```

To include write-path voting checks, provide an authenticated user's access token:

```bash
COMMUNITY_LOAD_ACCESS_TOKEN=<jwt> npm run loadtest:community
```

Use `COMMUNITY_LOAD_ACCESS_TOKENS=<jwt1>,<jwt2>,...` to rotate writes across multiple
test users. Scale `COMMUNITY_LOAD_CONCURRENCY` up toward the 1,000-session planning
target from a machine/network that can generate that much traffic. Set
`COMMUNITY_LOAD_MODE=stress` to run the older no-think-time breakpoint test.

## Notes

- RLS is enabled on every table; the anon key is safe to ship to the browser.
- `handle_new_user()` auto-creates a `profiles` row on signup from the OAuth identity.
- To grant moderation, set a profile's `role` to `'moderator'` (SQL editor).
- Client writes are routed through `community-write` for rate limiting, then guarded by
  RLS and write triggers: users cannot self-promote, edit counters/locks, or restore
  soft-deleted content.
- Migrations are append-only — add `0002_*.sql`, `0003_*.sql`, etc.
