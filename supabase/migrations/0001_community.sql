-- IPO Hero — community platform schema (accounts + prospectus-linked forums)
-- Phase 1: profiles, threads (optionally scoped to a filing section), posts, votes,
-- moderation reports. See docs/community-platform-plan.md.
--
-- Apply with: supabase db push   (or paste into the Supabase SQL editor)
-- Idempotent-ish: uses IF NOT EXISTS where practical. Run on a fresh project.

-- ---------------------------------------------------------------------------
-- profiles: app-owned mirror of auth.users with display-safe, public fields.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  x_user_id    text unique,
  handle       text not null,
  display_name text not null,
  avatar_url   text,
  role         text not null default 'member' check (role in ('member', 'moderator')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- threads: a discussion topic. section_id is a free-text reference to
-- FilingSection.id (no FK — the filing lives in static JSON, not the DB).
-- null section_id = general discussion. filing_accession future-proofs for
-- multi-filing; defaults to the single hardcoded SpaceX accession.
-- ---------------------------------------------------------------------------
create table if not exists public.threads (
  id               uuid primary key default gen_random_uuid(),
  filing_accession text not null default '0001628280-26-036936',
  section_id       text,
  title            text not null check (char_length(title) between 3 and 300),
  body             text not null check (char_length(body) between 1 and 20000),
  author_id        uuid not null references public.profiles (id) on delete cascade,
  score            integer not null default 0,
  reply_count      integer not null default 0,
  is_locked        boolean not null default false,
  is_deleted       boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists threads_section_idx on public.threads (section_id);
create index if not exists threads_filing_idx  on public.threads (filing_accession);
create index if not exists threads_score_idx   on public.threads (score desc);

-- ---------------------------------------------------------------------------
-- posts: replies within a thread. parent_post_id enables shallow nesting.
-- ---------------------------------------------------------------------------
create table if not exists public.posts (
  id             uuid primary key default gen_random_uuid(),
  thread_id      uuid not null references public.threads (id) on delete cascade,
  parent_post_id uuid references public.posts (id) on delete cascade,
  body           text not null check (char_length(body) between 1 and 20000),
  author_id      uuid not null references public.profiles (id) on delete cascade,
  score          integer not null default 0,
  is_deleted     boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists posts_thread_idx on public.posts (thread_id, created_at);

-- ---------------------------------------------------------------------------
-- votes: one row per (user, target). value is -1 or 1.
-- ---------------------------------------------------------------------------
create table if not exists public.votes (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('thread', 'post')),
  target_id   uuid not null,
  value       smallint not null check (value in (-1, 1)),
  created_at  timestamptz not null default now(),
  primary key (user_id, target_type, target_id)
);

-- ---------------------------------------------------------------------------
-- reports: moderation queue. Soft signal; resolution is manual in v1.
-- ---------------------------------------------------------------------------
create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('thread', 'post')),
  target_id   uuid not null,
  reason      text not null check (char_length(reason) between 1 and 1000),
  status      text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- updated_at maintenance
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
drop trigger if exists threads_touch on public.threads;
create trigger threads_touch before update on public.threads
  for each row execute function public.touch_updated_at();
drop trigger if exists posts_touch on public.posts;
create trigger posts_touch before update on public.posts
  for each row execute function public.touch_updated_at();

-- Bootstrap a profile when a new auth user signs up (X OAuth or email).
-- Pulls display fields out of the OAuth identity's raw metadata.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, x_user_id, handle, display_name, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data ->> 'provider_id',
    coalesce(new.raw_user_meta_data ->> 'user_name',
             split_part(new.email, '@', 1),
             'user_' || left(new.id::text, 8)),
    coalesce(new.raw_user_meta_data ->> 'full_name',
             new.raw_user_meta_data ->> 'user_name',
             'New member'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep role grants and other server-owned profile fields out of user updates.
create or replace function public.guard_profile_update()
returns trigger language plpgsql as $$
begin
  if new.id <> old.id then
    raise exception 'profile id cannot be changed';
  end if;

  if auth.uid() is not null and new.role <> old.role then
    raise exception 'profile role cannot be changed by clients';
  end if;

  if auth.uid() is not null and new.x_user_id is distinct from old.x_user_id then
    raise exception 'x_user_id cannot be changed by clients';
  end if;

  return new;
end; $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- Keep generated counters/moderation fields server-owned for non-moderators.
create or replace function public.guard_thread_write()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.author_id <> auth.uid() then
      raise exception 'thread author must be the current user';
    end if;
    if new.score <> 0 or new.reply_count <> 0 or new.is_locked or new.is_deleted then
      raise exception 'thread counters and moderation fields are server-owned';
    end if;
    return new;
  end if;

  if public.is_moderator() then
    return new;
  end if;

  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.id <> old.id
    or new.author_id <> old.author_id
    or new.filing_accession <> old.filing_accession
    or new.section_id is distinct from old.section_id
    or new.score <> old.score
    or new.reply_count <> old.reply_count
    or new.is_locked <> old.is_locked
  then
    raise exception 'thread server-owned fields cannot be changed by clients';
  end if;

  if old.is_deleted and new.is_deleted <> old.is_deleted then
    raise exception 'deleted threads cannot be restored by clients';
  end if;

  return new;
end; $$;

drop trigger if exists threads_guard on public.threads;
create trigger threads_guard before insert or update on public.threads
  for each row execute function public.guard_thread_write();

-- Keep post ownership/tree/score server-owned and enforce locked threads.
create or replace function public.guard_post_write()
returns trigger language plpgsql as $$
declare
  parent_locked boolean;
begin
  if tg_op = 'INSERT' then
    if new.author_id <> auth.uid() then
      raise exception 'post author must be the current user';
    end if;

    select t.is_locked into parent_locked
    from public.threads t
    where t.id = new.thread_id;

    if coalesce(parent_locked, true) and not public.is_moderator() then
      raise exception 'thread is locked';
    end if;

    if new.score <> 0 or new.is_deleted then
      raise exception 'post counters and moderation fields are server-owned';
    end if;

    return new;
  end if;

  if public.is_moderator() then
    return new;
  end if;

  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.id <> old.id
    or new.thread_id <> old.thread_id
    or new.parent_post_id is distinct from old.parent_post_id
    or new.author_id <> old.author_id
    or new.score <> old.score
  then
    raise exception 'post server-owned fields cannot be changed by clients';
  end if;

  if old.is_deleted and new.is_deleted <> old.is_deleted then
    raise exception 'deleted posts cannot be restored by clients';
  end if;

  return new;
end; $$;

drop trigger if exists posts_guard on public.posts;
create trigger posts_guard before insert or update on public.posts
  for each row execute function public.guard_post_write();

-- Keep denormalized score in sync with votes.
create or replace function public.apply_vote_delta()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  tgt_type text := coalesce(new.target_type, old.target_type);
  tgt_id   uuid := coalesce(new.target_id, old.target_id);
  delta    integer := coalesce(new.value, 0) - coalesce(old.value, 0);
begin
  if delta = 0 then return coalesce(new, old); end if;
  if tgt_type = 'thread' then
    update public.threads set score = score + delta where id = tgt_id;
  else
    update public.posts set score = score + delta where id = tgt_id;
  end if;
  return coalesce(new, old);
end; $$;

drop trigger if exists votes_apply on public.votes;
create trigger votes_apply after insert or update or delete on public.votes
  for each row execute function public.apply_vote_delta();

-- Keep denormalized reply_count in sync.
create or replace function public.apply_reply_delta()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.threads set reply_count = reply_count + 1 where id = new.thread_id;
  elsif tg_op = 'DELETE' then
    update public.threads set reply_count = greatest(reply_count - 1, 0) where id = old.thread_id;
  end if;
  return coalesce(new, old);
end; $$;

drop trigger if exists posts_count on public.posts;
create trigger posts_count after insert or delete on public.posts
  for each row execute function public.apply_reply_delta();

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.threads  enable row level security;
alter table public.posts    enable row level security;
alter table public.votes    enable row level security;
alter table public.reports  enable row level security;

-- helper: is the current user a moderator?
create or replace function public.is_moderator()
returns boolean language sql stable as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'moderator'
  );
$$;

-- Forums are PUBLIC-READ, AUTH-GATED-WRITE: anyone (incl. logged-out visitors via
-- the anon key) can read non-deleted content; creating/voting requires an
-- authenticated session. X OAuth gates participation, not visibility.

-- profiles: world-readable (author handle/avatar shown on public content);
-- users edit only their own.
create policy profiles_read   on public.profiles for select using (true);
create policy profiles_update on public.profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);

-- threads: anyone reads non-deleted (mods read all); authors create/edit own.
create policy threads_read on public.threads for select
  using (not is_deleted or public.is_moderator());
create policy threads_insert on public.threads for insert
  with check (
    auth.uid() = author_id
    and score = 0
    and reply_count = 0
    and not is_locked
    and not is_deleted
  );
create policy threads_update on public.threads for update
  using (auth.uid() = author_id or public.is_moderator())
  with check (auth.uid() = author_id or public.is_moderator());

-- posts: same shape as threads.
create policy posts_read on public.posts for select
  using (not is_deleted or public.is_moderator());
create policy posts_insert on public.posts for insert
  with check (
    auth.uid() = author_id
    and score = 0
    and not is_deleted
    and (
      public.is_moderator()
      or exists (
        select 1 from public.threads
        where id = thread_id and not is_locked and not is_deleted
      )
    )
  );
create policy posts_update on public.posts for update
  using (auth.uid() = author_id or public.is_moderator())
  with check (auth.uid() = author_id or public.is_moderator());

-- votes: users manage only their own.
create policy votes_all on public.votes for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- reports: a user creates reports as themselves; only mods read them.
create policy reports_insert on public.reports for insert
  with check (auth.uid() = reporter_id);
create policy reports_read on public.reports for select
  using (public.is_moderator());
