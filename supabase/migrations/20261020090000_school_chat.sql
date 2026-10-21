-- School chat (director, 15 Oct 2026): class groups, subject groups, staff↔staff
-- and staff↔parent direct chats, every student/parent message checked BEFORE
-- anyone else sees it, a review queue, mute/block, and a log of all of it.
--
-- APPLY TO PRODUCTION BEFORE THE APP THAT USES IT IS DEPLOYED. Without these
-- tables every /api/v1/school-chat route answers 503 ("chat is not set up");
-- nothing falls back to a browser copy, and nothing is ever sent unchecked.
--
-- Rows only, written only by the server (service_role) through the routes in
-- apps/web/src/app/api/v1/school-chat — which decide membership themselves
-- from the roster, the published timetable and Staff → Duties. The client
-- never says who is in a group.
--
--   school_chat_conversations  one row per group / direct chat (ids are
--                              deterministic for groups, so a group exists
--                              once however many people open it)
--   school_chat_members        who has a direct chat, and every member's
--                              read marker (group membership is NOT stored:
--                              it is worked out on every request)
--   school_chat_messages       every message, the original text kept for ever;
--                              status visible / held / removed
--   school_chat_moderation_log every check and every decision: who, when, the
--                              original text, what was decided and why
--   school_chat_blocks         mute (may read, may not send) / block (neither),
--                              school-wide or for one conversation, with the
--                              reason; lifting one keeps the row (lifted_*)
--
-- No student↔student conversation can exist: the kind check below has no
-- such kind, and a direct chat always has a staff member on one side.

create table if not exists public.school_chat_conversations (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('class', 'subject', 'dm_staff', 'dm_parent')),
  academic_year_code text not null default '',
  class_id text not null default '',
  section_id text not null default '',
  subject_id text not null default '',
  -- dm_staff: the two staff ids (sorted); dm_parent: the one staff id.
  staff_ids text[] not null default '{}',
  -- dm_parent: the family and the child the chat is about.
  household_id text not null default '',
  student_id text not null default '',
  title text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  check (kind not in ('class', 'subject') or (class_id <> '' and section_id <> '')),
  check (kind <> 'subject' or subject_id <> ''),
  check (kind <> 'dm_staff' or cardinality(staff_ids) = 2),
  check (kind <> 'dm_parent' or (cardinality(staff_ids) = 1 and household_id <> '' and student_id <> ''))
);

create index if not exists school_chat_conversations_tenant_kind_idx
  on public.school_chat_conversations (tenant_id, kind);
create index if not exists school_chat_conversations_staff_idx
  on public.school_chat_conversations using gin (staff_ids);
create index if not exists school_chat_conversations_household_idx
  on public.school_chat_conversations (tenant_id, household_id) where household_id <> '';

create table if not exists public.school_chat_members (
  conversation_id text not null references public.school_chat_conversations(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- 'staff' (member_id = staff id) or 'household' (member_id = household id).
  member_kind text not null check (member_kind in ('staff', 'household')),
  member_id text not null check (member_id <> ''),
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  primary key (conversation_id, member_kind, member_id)
);

create index if not exists school_chat_members_member_idx
  on public.school_chat_members (tenant_id, member_kind, member_id);

create table if not exists public.school_chat_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id text not null references public.school_chat_conversations(id) on delete cascade,
  -- staff: sender_id = staff id. student: a child, sent from the family's
  -- login (sender_id = student id, household_id = the family). parent: the
  -- family itself (sender_id = household id), in a staff↔parent chat.
  sender_kind text not null check (sender_kind in ('staff', 'student', 'parent')),
  sender_id text not null check (sender_id <> ''),
  household_id text not null default '',
  -- "Aarav Sharma (V-A)", "Parent of Aarav Sharma (V-A)", "Mrs Rao (teacher)".
  sender_label text not null default '',
  body text not null check (char_length(body) between 1 and 2000),
  status text not null check (status in ('visible', 'held', 'removed')),
  -- The check that decided the status: {by:'rules'|'ai'|'none', verdict,
  -- categories[], reason, engine, generationId, error}.
  moderation jsonb not null default '{}'::jsonb,
  -- Set when a person decided a held message (or removed a visible one).
  reviewed_at timestamptz,
  reviewed_by text not null default '',
  review_decision text not null default '' check (review_decision in ('', 'approve', 'remove', 'warn')),
  review_note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists school_chat_messages_conv_idx
  on public.school_chat_messages (conversation_id, created_at);
create index if not exists school_chat_messages_held_idx
  on public.school_chat_messages (tenant_id, created_at) where status = 'held';
create index if not exists school_chat_messages_sender_idx
  on public.school_chat_messages (tenant_id, sender_kind, sender_id, created_at);
-- The per-sender rate limit counts a family login's messages by household.
create index if not exists school_chat_messages_household_idx
  on public.school_chat_messages (tenant_id, household_id, created_at) where household_id <> '';

create table if not exists public.school_chat_moderation_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  message_id uuid references public.school_chat_messages(id) on delete set null,
  conversation_id text not null default '',
  -- held_by_rules, held_by_ai, held_ai_unavailable, passed,
  -- flagged_ai_unavailable (a staff message posted while the AI check was
  -- down, queued for review), approve, remove, warn, mute, unmute, block,
  -- unblock, send_refused (muted / blocked, or over the rate limit: reason
  -- 'rate_limit: …')
  action text not null,
  -- 'system' for the automatic check; else the moderator's staff id.
  actor text not null default 'system',
  actor_name text not null default '',
  -- Whose behaviour this is about: staff / student / household + id.
  subject_kind text not null default '' check (subject_kind in ('', 'staff', 'student', 'household')),
  subject_id text not null default '',
  reason text not null default '',
  categories text[] not null default '{}',
  -- The text as it was sent — kept even if the message is removed.
  original_text text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists school_chat_moderation_log_subject_idx
  on public.school_chat_moderation_log (tenant_id, subject_kind, subject_id, created_at);
create index if not exists school_chat_moderation_log_time_idx
  on public.school_chat_moderation_log (tenant_id, created_at);

create table if not exists public.school_chat_blocks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  subject_kind text not null check (subject_kind in ('staff', 'student', 'household')),
  subject_id text not null check (subject_id <> ''),
  -- 'mute' = may read, may not send; 'block' = may neither read nor send.
  mode text not null check (mode in ('mute', 'block')),
  -- '' = school-wide; else one conversation id.
  conversation_id text not null default '',
  reason text not null check (char_length(btrim(reason)) >= 3),
  created_by text not null,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  lifted_at timestamptz,
  lifted_by text not null default '',
  lift_reason text not null default ''
);

create index if not exists school_chat_blocks_active_idx
  on public.school_chat_blocks (tenant_id, subject_kind, subject_id) where lifted_at is null;

-- ── Writes that must be all-or-none ──────────────────────────────────────

-- Store one message and its check together, and move the conversation's
-- last_message_at only when others can see it.
create or replace function public.school_chat_post(
  p_tenant uuid,
  p_conversation text,
  p_sender_kind text,
  p_sender_id text,
  p_household text,
  p_label text,
  p_body text,
  p_status text,
  p_moderation jsonb,
  p_log_action text,
  p_log_reason text,
  p_log_categories text[],
  p_subject_kind text,
  p_subject_id text
) returns table (id uuid, created_at timestamptz)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_at timestamptz;
begin
  insert into public.school_chat_messages
    (tenant_id, conversation_id, sender_kind, sender_id, household_id, sender_label, body, status, moderation)
  values
    (p_tenant, p_conversation, p_sender_kind, p_sender_id, coalesce(p_household, ''), coalesce(p_label, ''), p_body, p_status, coalesce(p_moderation, '{}'::jsonb))
  returning school_chat_messages.id, school_chat_messages.created_at into v_id, v_at;

  insert into public.school_chat_moderation_log
    (tenant_id, message_id, conversation_id, action, subject_kind, subject_id, reason, categories, original_text)
  values
    (p_tenant, v_id, p_conversation, p_log_action, coalesce(p_subject_kind, ''), coalesce(p_subject_id, ''),
     coalesce(p_log_reason, ''), coalesce(p_log_categories, '{}'), p_body);

  if p_status = 'visible' then
    update public.school_chat_conversations c set last_message_at = v_at
     where c.id = p_conversation and c.tenant_id = p_tenant;
  end if;

  return query select v_id, v_at;
end;
$$;

-- A person decides a message. Only a HELD message can be approved or warned
-- (warn = remove it and warn the sender); a visible one can be removed. A
-- decision already taken by someone else is refused (returns no row), so two
-- reviewers cannot both decide the same message.
create or replace function public.school_chat_decide(
  p_tenant uuid,
  p_message uuid,
  p_decision text,
  p_actor text,
  p_actor_name text,
  p_note text
) returns table (id uuid, status text, conversation_id text, created_at timestamptz)
language plpgsql
security invoker
set search_path = public
as $$
declare
  m public.school_chat_messages%rowtype;
  v_status text;
begin
  if p_decision not in ('approve', 'remove', 'warn') then
    raise exception 'school_chat_decide: bad decision %', p_decision;
  end if;

  select * into m from public.school_chat_messages
   where school_chat_messages.id = p_message and school_chat_messages.tenant_id = p_tenant
   for update;
  if not found then return; end if;

  if p_decision in ('approve', 'warn') and m.status <> 'held' then return; end if;
  if p_decision = 'remove' and m.status = 'removed' then return; end if;

  v_status := case p_decision when 'approve' then 'visible' else 'removed' end;

  update public.school_chat_messages
     set status = v_status,
         reviewed_at = now(),
         reviewed_by = p_actor,
         review_decision = p_decision,
         review_note = coalesce(p_note, '')
   where school_chat_messages.id = m.id;

  insert into public.school_chat_moderation_log
    (tenant_id, message_id, conversation_id, action, actor, actor_name, subject_kind, subject_id, reason, original_text)
  values
    (p_tenant, m.id, m.conversation_id, p_decision, p_actor, coalesce(p_actor_name, ''),
     case m.sender_kind when 'parent' then 'household' else m.sender_kind end,
     m.sender_id, coalesce(p_note, ''), m.body);

  -- An approved message joins the conversation at the time it was SENT; the
  -- conversation's "last message" moves only forward.
  if v_status = 'visible' then
    update public.school_chat_conversations c
       set last_message_at = greatest(coalesce(c.last_message_at, m.created_at), m.created_at)
     where c.id = m.conversation_id and c.tenant_id = p_tenant;
  end if;

  return query select m.id, v_status, m.conversation_id, m.created_at;
end;
$$;

-- Mute / block someone, and its log row, in one transaction: there is never
-- a block without its log row, nor a log row for a block that was not made.
create or replace function public.school_chat_set_block(
  p_tenant uuid,
  p_subject_kind text,
  p_subject_id text,
  p_mode text,
  p_conversation text,
  p_reason text,
  p_actor text,
  p_actor_name text
) returns table (id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.school_chat_blocks
    (tenant_id, subject_kind, subject_id, mode, conversation_id, reason, created_by, created_by_name)
  values
    (p_tenant, p_subject_kind, p_subject_id, p_mode, coalesce(p_conversation, ''), p_reason, p_actor, coalesce(p_actor_name, ''))
  returning school_chat_blocks.id into v_id;

  insert into public.school_chat_moderation_log
    (tenant_id, conversation_id, action, actor, actor_name, subject_kind, subject_id, reason)
  values
    (p_tenant, coalesce(p_conversation, ''), p_mode, p_actor, coalesce(p_actor_name, ''), p_subject_kind, p_subject_id, p_reason);

  return query select v_id;
end;
$$;

-- Lift a mute / block (the row is kept, lifted_*), and its log row, in one
-- transaction. Already lifted (or not this tenant's) = no row returned.
create or replace function public.school_chat_lift_block(
  p_tenant uuid,
  p_block uuid,
  p_actor text,
  p_actor_name text,
  p_reason text
) returns table (id uuid, subject_kind text, subject_id text, mode text, conversation_id text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  b public.school_chat_blocks%rowtype;
begin
  update public.school_chat_blocks
     set lifted_at = now(), lifted_by = coalesce(p_actor, ''), lift_reason = coalesce(p_reason, '')
   where school_chat_blocks.id = p_block
     and school_chat_blocks.tenant_id = p_tenant
     and school_chat_blocks.lifted_at is null
  returning * into b;
  if not found then return; end if;

  insert into public.school_chat_moderation_log
    (tenant_id, conversation_id, action, actor, actor_name, subject_kind, subject_id, reason)
  values
    (p_tenant, b.conversation_id, case b.mode when 'mute' then 'unmute' else 'unblock' end,
     coalesce(p_actor, ''), coalesce(p_actor_name, ''), b.subject_kind, b.subject_id, coalesce(p_reason, ''));

  return query select b.id, b.subject_kind, b.subject_id, b.mode, b.conversation_id;
end;
$$;

-- The per-sender sending limit, checked before the AI check. Counts the
-- sender's stored messages (any status) in the last minute and 24 hours —
-- a family login (p_household <> '') by household, staff by staff id — and,
-- when over either limit, writes the 'send_refused' log row (with the text)
-- in the same transaction. allowed = false means refuse.
create or replace function public.school_chat_rate_check(
  p_tenant uuid,
  p_conversation text,
  p_sender_kind text,
  p_sender_id text,
  p_household text,
  p_subject_kind text,
  p_subject_id text,
  p_body text,
  p_per_minute int,
  p_per_day int
) returns table (allowed boolean, minute_count int, day_count int)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_min int;
  v_day int;
  v_ok boolean;
begin
  if coalesce(p_household, '') = '' and (coalesce(p_sender_kind, '') <> 'staff' or coalesce(p_sender_id, '') = '') then
    raise exception 'school_chat_rate_check: a household or a staff sender is required';
  end if;

  select count(*) filter (where m.created_at > now() - interval '1 minute'),
         count(*)
    into v_min, v_day
    from public.school_chat_messages m
   where m.tenant_id = p_tenant
     and m.created_at > now() - interval '24 hours'
     and (case when coalesce(p_household, '') <> ''
               then m.household_id = p_household
               else m.sender_kind = 'staff' and m.sender_id = p_sender_id end);

  v_ok := v_min < p_per_minute and v_day < p_per_day;
  if not v_ok then
    insert into public.school_chat_moderation_log
      (tenant_id, conversation_id, action, subject_kind, subject_id, reason, original_text)
    values
      (p_tenant, coalesce(p_conversation, ''), 'send_refused', coalesce(p_subject_kind, ''), coalesce(p_subject_id, ''),
       format('rate_limit: %s in the last minute (max %s), %s in 24 h (max %s)', v_min, p_per_minute, v_day, p_per_day),
       coalesce(p_body, ''));
  end if;

  return query select v_ok, v_min, v_day;
end;
$$;

comment on table public.school_chat_conversations is
  'School chat: class / subject groups (deterministic ids) and staff↔staff / staff↔parent direct chats. Membership of groups is decided by the server on every request.';
comment on table public.school_chat_members is
  'School chat: direct-chat participants and every member''s read marker. Not the authority for group membership.';
comment on table public.school_chat_messages is
  'School chat messages. Original text is never edited; status visible / held (awaiting review) / removed.';
comment on table public.school_chat_moderation_log is
  'School chat: every automatic check and every human decision (who, when, original text, decision, reason).';
comment on table public.school_chat_blocks is
  'School chat: mute / block of a staff member, child or family, school-wide or for one conversation, with the reason. Lifted rows are kept.';

alter table public.school_chat_conversations enable row level security;
alter table public.school_chat_members enable row level security;
alter table public.school_chat_messages enable row level security;
alter table public.school_chat_moderation_log enable row level security;
alter table public.school_chat_blocks enable row level security;
revoke all on public.school_chat_conversations from public, anon, authenticated;
revoke all on public.school_chat_members from public, anon, authenticated;
revoke all on public.school_chat_messages from public, anon, authenticated;
revoke all on public.school_chat_moderation_log from public, anon, authenticated;
revoke all on public.school_chat_blocks from public, anon, authenticated;
-- Every new table needs an explicit service_role grant (memory note
-- erp-supabase-new-table-grant): without it every request is 42501.
grant select, insert, update, delete on public.school_chat_conversations to service_role;
grant select, insert, update, delete on public.school_chat_members to service_role;
grant select, insert, update, delete on public.school_chat_messages to service_role;
grant select, insert, update, delete on public.school_chat_moderation_log to service_role;
grant select, insert, update, delete on public.school_chat_blocks to service_role;

revoke all on function public.school_chat_post(uuid, text, text, text, text, text, text, text, jsonb, text, text, text[], text, text) from public, anon, authenticated;
revoke all on function public.school_chat_decide(uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.school_chat_set_block(uuid, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.school_chat_lift_block(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.school_chat_rate_check(uuid, text, text, text, text, text, text, text, int, int) from public, anon, authenticated;
grant execute on function public.school_chat_post(uuid, text, text, text, text, text, text, text, jsonb, text, text, text[], text, text) to service_role;
grant execute on function public.school_chat_decide(uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.school_chat_set_block(uuid, text, text, text, text, text, text, text) to service_role;
grant execute on function public.school_chat_lift_block(uuid, uuid, text, text, text) to service_role;
grant execute on function public.school_chat_rate_check(uuid, text, text, text, text, text, text, text, int, int) to service_role;
