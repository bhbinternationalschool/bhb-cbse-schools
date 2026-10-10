-- Gate QR schedule + printed backup QR (director, 5 Oct 2026).
--
-- punch_options is written ONLY by the punch-devices route (school-wide
-- logins), never by the attendance-settings desk save, so a stale settings
-- page cannot reset the printed-QR version and revive old prints.
-- Empty object = defaults: QR open 06:45–18:00 Mon–Sat, printed QR off.
alter table public.staff_attendance_desk_settings
  add column if not exists punch_options jsonb not null default '{}'::jsonb;

comment on column public.staff_attendance_desk_settings.punch_options is
  'Gate punch window {windowStart, windowEnd, days} and printed backup QR {printedQrEnabled, printedQrVersion, printedQrIssuedAt}. See lib/punchSchedule.ts.';

notify pgrst, 'reload schema';

-- Pairing code (director, 5 Oct 2026): switch a gate phone on as the QR
-- screen WITHOUT signing in on it. The office makes a one-time code on its
-- own device; the gate phone types it in, inside the school, within 10
-- minutes. A row with pairing_code_hash set is a screen still waiting to be
-- paired — its token_hash is a random placeholder nobody holds, so it shows
-- nothing until paired. Five wrong tries cancel it.
alter table public.staff_punch_displays
  add column if not exists pairing_code_hash text,
  add column if not exists pairing_expires_at timestamptz,
  add column if not exists pairing_attempts integer not null default 0;

comment on column public.staff_punch_displays.pairing_code_hash is
  'sha256 of the one-time pairing code while the screen waits to be paired; null once paired.';

notify pgrst, 'reload schema';
