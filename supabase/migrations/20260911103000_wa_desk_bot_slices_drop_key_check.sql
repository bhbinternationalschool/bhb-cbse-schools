-- Renamed 2026-09-12 from 20260911100000: that prefix was already taken by
-- 20260911100000_sis_households_geo.sql, and the prefix IS the migration
-- version — Supabase keys schema_migrations on it, so on a fresh apply one of
-- the pair can be recorded as already-run and skipped, and the order between
-- them is arbitrary either way. The two are independent (household geocodes vs
-- the bot's slice table), so moving this one changes nothing about what either
-- does. Both are already applied to production under their own generated
-- versions; the filename is what a fresh apply and the local rehearsal read.
-- The bot store's slice table enumerated its allowed keys in a CHECK. The
-- list lives in code (WA_BOT_SLICE_KEYS) and the check lagged it twice:
-- 'complaints' on 2026-09-04 and 'tutor' on 2026-09-11. Each time the
-- effect was the same and silent: the store saves the WHOLE bundle in one
-- upsert, so the moment any parent touched the new flow, every save of
-- every bot thread failed with a check violation, logged as a warning, and
-- the school lost its WhatsApp conversations until the next deploy noticed.
-- On 2026-09-11 that was seven families between 06:45 and 08:10 IST.
--
-- The primary key (tenant_id, slice_key) is all the shape this table needs;
-- the code is the only writer. Drop the check for good.

alter table public.wa_desk_bot_slices drop constraint if exists wa_desk_bot_slices_key_check;

comment on column public.wa_desk_bot_slices.slice_key is
  'Bot store slice. The key list lives in code (WA_BOT_SLICE_KEYS); the check that used to enumerate it here lagged the code twice (complaints 2026-09-04, tutor 2026-09-11) and each time silently stopped EVERY bot thread from persisting.';
