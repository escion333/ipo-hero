-- IPO Hero — collapse thread scoping to the fixed discussion-theme taxonomy.
-- The forum previously scoped threads to raw EDGAR filing-section ids
-- (e.g. "section-40-riskfactors"); it now uses a small fixed set of themes
-- (see src/lib/community/themes.ts). New threads already store theme keys —
-- this backfills any rows created before the change.
--
-- Apply with: supabase db push   (or paste into the Supabase SQL editor)
-- Idempotent: rows already holding a theme key (or null) are left untouched.
--
-- The CASE order mirrors resolveTheme()'s LEGACY_PATTERNS exactly (risks →
-- governance → offering → financials → business → general); keep them in sync.

update public.threads
set section_id = case
  when section_id ~* 'risk' then 'risks'
  when section_id ~* 'management|governance|ownership|relationship|relatedperson|capitalstock|director|control' then 'governance'
  when section_id ~* 'proceeds|underwriting|dilution|capitalization|lockup|shareseligible|offering|prospectus' then 'offering'
  when section_id ~* 'financ|dividend|debt|liquidity|notes' then 'financials'
  when section_id ~* 'business|operations' then 'business'
  else null
end
where section_id is not null
  and section_id not in ('business', 'financials', 'risks', 'governance', 'offering');
