-- A punch from a new phone is refused until the office approves the phone.
-- The director (30 Sep 2026): when approved, that punch must count at the
-- time it was tried, not at the time the office got round to approving.
--
-- attempts — the refused punches of the pending phone, today only:
-- [{"kind":"in","at":"2026-09-30T03:20:11.000Z"}, …]. Each already passed
-- the office-screen code and the phone's signature, so its time is proven.
alter table public.staff_punch_devices
  add column if not exists attempts jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';
