-- IPO Hero community scaling hardening.
-- Adds query-shaped indexes for bounded list reads and an atomic rate-limit
-- counter used by the community-write Edge Function.

-- ---------------------------------------------------------------------------
-- Public read paths: thread lists are filtered by deletion/section and ordered
-- either by score or recency with a stable id tie-breaker for keyset pagination.
-- ---------------------------------------------------------------------------
create index if not exists threads_public_rank_idx
  on public.threads (score desc, created_at desc, id desc)
  where not is_deleted;

create index if not exists threads_public_section_rank_idx
  on public.threads (section_id, score desc, created_at desc, id desc)
  where not is_deleted;

create index if not exists threads_public_filing_section_rank_idx
  on public.threads (filing_accession, section_id, score desc, created_at desc, id desc)
  where not is_deleted;

create index if not exists threads_public_recent_idx
  on public.threads (created_at desc, id desc)
  where not is_deleted;

create index if not exists threads_public_section_recent_idx
  on public.threads (section_id, created_at desc, id desc)
  where not is_deleted;

create index if not exists threads_public_filing_section_recent_idx
  on public.threads (filing_accession, section_id, created_at desc, id desc)
  where not is_deleted;

create index if not exists posts_public_thread_created_idx
  on public.posts (thread_id, created_at asc, id asc)
  where not is_deleted;

create index if not exists reports_status_created_idx
  on public.reports (status, created_at asc);

-- ---------------------------------------------------------------------------
-- Rate-limit buckets. No client policies are granted; the Edge Function calls
-- check_community_rate_limit with the service role before performing writes.
-- ---------------------------------------------------------------------------
create table if not exists public.community_rate_limits (
  scope          text not null check (scope in ('user', 'ip')),
  subject        text not null,
  action         text not null check (action in ('thread', 'post', 'vote', 'report')),
  window_seconds integer not null check (window_seconds > 0),
  window_start   timestamptz not null,
  count          integer not null default 0 check (count >= 0),
  updated_at     timestamptz not null default now(),
  primary key (scope, subject, action, window_seconds, window_start)
);

alter table public.community_rate_limits enable row level security;

create index if not exists community_rate_limits_cleanup_idx
  on public.community_rate_limits (window_start);

create or replace function public.check_community_rate_limit(
  p_scope text,
  p_subject text,
  p_action text,
  p_window_seconds integer,
  p_limit integer,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  bucket_start timestamptz;
  next_count integer;
begin
  if p_subject is null
    or length(trim(p_subject)) = 0
    or p_limit < 1
    or p_window_seconds < 1
  then
    return false;
  end if;

  bucket_start := to_timestamp(
    floor(extract(epoch from p_now) / p_window_seconds) * p_window_seconds
  );

  insert into public.community_rate_limits (
    scope,
    subject,
    action,
    window_seconds,
    window_start,
    count,
    updated_at
  )
  values (
    p_scope,
    p_subject,
    p_action,
    p_window_seconds,
    bucket_start,
    1,
    p_now
  )
  on conflict (scope, subject, action, window_seconds, window_start)
  do update set
    count = public.community_rate_limits.count + 1,
    updated_at = excluded.updated_at
  returning count into next_count;

  return next_count <= p_limit;
end;
$$;

revoke all on function public.check_community_rate_limit(
  text,
  text,
  text,
  integer,
  integer,
  timestamptz
) from public;

grant execute on function public.check_community_rate_limit(
  text,
  text,
  text,
  integer,
  integer,
  timestamptz
) to service_role;
