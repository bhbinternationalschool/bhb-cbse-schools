grant all on public.attendance_desk_policy to service_role;
grant all on public.attendance_desk_absent_nudges to service_role;
grant all on public.attendance_desk_exceptions to service_role;

notify pgrst, 'reload schema';
