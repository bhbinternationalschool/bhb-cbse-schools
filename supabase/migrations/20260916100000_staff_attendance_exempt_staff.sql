-- Staff who keep no attendance.
--
-- The owner never punches, so the register carried him as absent every
-- working day and "absent today" stopped meaning anything. The office can
-- now name anyone who is not on the register; role-holders (owner / admin
-- as their MAIN role) are excluded in code without being listed here.
--
-- Empty array = the register is exactly what it was before this column.

alter table public.staff_attendance_desk_settings
  add column if not exists exempt_staff_ids text[] not null default '{}';
