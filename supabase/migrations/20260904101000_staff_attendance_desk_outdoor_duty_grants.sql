-- Every new table needs an explicit service_role grant, or the server's
-- writes fail 42501 and the sync reports success while storing nothing.

grant all on public.staff_attendance_desk_outdoor_duty to service_role;

notify pgrst, 'reload schema';
