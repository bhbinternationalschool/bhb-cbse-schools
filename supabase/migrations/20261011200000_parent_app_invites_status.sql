-- parent_app_invites.status (follow-up to 20261011180000, PR #546).
-- 'sent' = WhatsApp accepted the invite; 'unknown' = the dispatch failed
-- midway and it may have gone. Both keep the family out of the next invite
-- for 7 days. Existing rows were all real sends, so they default to 'sent'.

alter table public.parent_app_invites
  add column if not exists status text not null default 'sent';

alter table public.parent_app_invites
  drop constraint if exists parent_app_invites_status_check;
alter table public.parent_app_invites
  add constraint parent_app_invites_status_check check (status in ('sent', 'unknown'));

notify pgrst, 'reload schema';
