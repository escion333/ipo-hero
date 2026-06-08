// Env-guarded configuration for the community backend. Mirrors the VITE_USE_MOCK
// seam in filing-data.ts: the feature stays inert until explicitly enabled with
// valid Supabase credentials.
//
// Only PUBLIC values belong here. The X/Twitter client secret is configured in the
// Supabase dashboard (Auth → Providers → X/Twitter OAuth 2.0) and must never appear in a VITE_
// var or in the frontend bundle.

export const communityConfig = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? "",
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "",
};

/**
 * True only when the feature flag is set AND both public Supabase credentials are
 * present. Gate any community UI on this so a missing config degrades gracefully
 * instead of throwing at render time.
 */
export const communityEnabled =
  import.meta.env.VITE_COMMUNITY_ENABLED === "true" &&
  Boolean(communityConfig.supabaseUrl) &&
  Boolean(communityConfig.supabaseAnonKey);
