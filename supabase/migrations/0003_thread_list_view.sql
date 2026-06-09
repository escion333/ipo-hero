-- Lightweight public thread-list view. List pages should not fetch full thread
-- bodies; detail pages still read public.threads for the complete body.

create or replace view public.thread_list_items
with (security_invoker = true)
as
select
  t.id,
  t.filing_accession,
  t.section_id,
  t.title,
  left(t.body, 280) as body_preview,
  t.author_id,
  p.handle as author_handle,
  p.display_name as author_display_name,
  p.avatar_url as author_avatar_url,
  p.role as author_role,
  t.score,
  t.reply_count,
  t.is_locked,
  t.is_deleted,
  t.created_at,
  t.updated_at
from public.threads t
join public.profiles p on p.id = t.author_id
where not t.is_deleted;

grant select on public.thread_list_items to anon, authenticated;
