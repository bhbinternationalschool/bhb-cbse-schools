-- School chat: groups a member of staff makes (director, 29 Oct 2026).
--
-- "I made a new group, sent hello, and it did not reach anyone." The web
-- header chat kept its groups in one server's memory and each browser's
-- localStorage; it now uses school chat, which until now had only the groups
-- the roster defines (class / subject) and two-person direct chats. This adds
-- one kind: 'group' — named by the staff member who made it, with the staff
-- they picked and, optionally, one class section (whose families READ it,
-- like the old class announcement; they cannot post in it).
--
--   staff_ids                  the group's staff members (the creator
--                              included); the authority for who is in it
--   academic_year_code,
--   class_id, section_id       '' / '' = staff only; else that section's
--                              families (worked out from the roll on every
--                              request, never stored)
--
-- No new table and no new function: messages, read markers, moderation,
-- mute/block and the rate limit are school chat's own (20261020090000).
-- Apply BEFORE the code that uses it is deployed; without it, making a group
-- answers 503 "School chat is not set up for groups yet" and nothing else
-- changes.

alter table public.school_chat_conversations
  drop constraint if exists school_chat_conversations_kind_check;
alter table public.school_chat_conversations
  add constraint school_chat_conversations_kind_check
  check (kind in ('class', 'subject', 'dm_staff', 'dm_parent', 'group'));

alter table public.school_chat_conversations
  drop constraint if exists school_chat_conversations_group_shape_check;
alter table public.school_chat_conversations
  add constraint school_chat_conversations_group_shape_check
  check (
    kind <> 'group'
    or (
      cardinality(staff_ids) between 2 and 200
      and char_length(title) between 1 and 120
      and created_by <> ''
      and (class_id = '') = (section_id = '')
      and subject_id = ''
      and household_id = ''
      and student_id = ''
    )
  );

comment on table public.school_chat_conversations is
  'School chat: class / subject groups (deterministic ids), staff-made groups (kind group: staff_ids + optional section, read-only for its families) and staff↔staff / staff↔parent direct chats. Membership is decided by the server on every request.';

-- Unchanged privileges, restated: rows only through the server.
revoke all on public.school_chat_conversations from public, anon, authenticated;
grant select, insert, update, delete on public.school_chat_conversations to service_role;
