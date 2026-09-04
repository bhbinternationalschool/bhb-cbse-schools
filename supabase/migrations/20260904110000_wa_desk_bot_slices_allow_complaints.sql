-- The WhatsApp bot store persists one row per slice in wa_desk_bot_slices,
-- and the code's slice list (WA_BOT_SLICE_KEYS) gained "complaints" when the
-- WhatsApp complaint Flow was built. The check constraint on slice_key was
-- never widened to match, so every push of that slice failed with
-- "violates check constraint wa_desk_bot_slices_key_check" — and because the
-- bundle is otherwise held in process memory and an ephemeral file, every
-- complaint raised over WhatsApp was lost the next time Cloud Run restarted.
-- The parent app's /api/v1/complaints/create writes to the same slice.
--
-- Widen the constraint to the code's list. Nothing else changes.

alter table public.wa_desk_bot_slices
  drop constraint if exists wa_desk_bot_slices_key_check;

alter table public.wa_desk_bot_slices
  add constraint wa_desk_bot_slices_key_check
  check (slice_key = any (array[
    'crm', 'sis', 'survey', 'classChannel', 'unified', 'hub', 'staffAtt',
    'complaints'
  ]));
