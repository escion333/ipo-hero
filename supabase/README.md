# Supabase — community backend

Backend for IPO Hero accounts + forums. See
[docs/community-platform-plan.md](../docs/community-platform-plan.md) for the full plan.

## One-time setup

1. **Create a project** at https://supabase.com (note the project URL + anon key).
2. **Apply the schema.** Either paste
   [migrations/0001_community.sql](migrations/0001_community.sql) into the SQL editor,
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

## Notes

- RLS is enabled on every table; the anon key is safe to ship to the browser.
- `handle_new_user()` auto-creates a `profiles` row on signup from the OAuth identity.
- To grant moderation, set a profile's `role` to `'moderator'` (SQL editor).
- Client writes are guarded: users cannot self-promote, edit counters/locks, or restore
  soft-deleted content through the anon API.
- Migrations are append-only — add `0002_*.sql`, `0003_*.sql`, etc.
