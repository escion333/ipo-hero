-- Allow the moderator soft-delete action ("moderate") to be rate-limited.
-- The community-write edge function records every write against
-- community_rate_limits via check_community_rate_limit(); the original CHECK
-- constraint only permitted the four content actions, so a "moderate" write
-- tripped the constraint and surfaced as a 500. Widen the allowed set.
alter table public.community_rate_limits
  drop constraint if exists community_rate_limits_action_check;

alter table public.community_rate_limits
  add constraint community_rate_limits_action_check
  check (action in ('thread', 'post', 'vote', 'report', 'moderate'));
