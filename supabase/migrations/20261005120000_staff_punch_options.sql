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
