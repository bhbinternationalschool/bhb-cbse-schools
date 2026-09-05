-- The ERP command desk (staff commands over WhatsApp — "5A me aaj kaun absent
-- hai") keeps its state in a new "commands" slice of the WhatsApp bot store:
-- the director's pause switch, pending confirm cards for write commands, and
-- per-staff hourly usage. WA_BOT_SLICE_KEYS gained "commands" with it.
--
-- The check constraint on wa_desk_bot_slices.slice_key lists the allowed
-- slices explicitly (see 20260904110000, where the same omission silently
-- lost every WhatsApp complaint). Widen it in the same change as the code,
-- so a pending confirm survives a Cloud Run restart instead of expiring into
-- "that confirmation was for something else".

alter table public.wa_desk_bot_slices
  drop constraint if exists wa_desk_bot_slices_key_check;

alter table public.wa_desk_bot_slices
  add constraint wa_desk_bot_slices_key_check
  check (slice_key = any (array[
    'crm', 'sis', 'survey', 'classChannel', 'unified', 'hub', 'staffAtt',
    'complaints', 'commands'
  ]));
