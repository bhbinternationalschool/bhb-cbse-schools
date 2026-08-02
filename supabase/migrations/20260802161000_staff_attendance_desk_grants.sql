grant all on public.staff_attendance_desk_registers to service_role;
grant all on public.staff_attendance_desk_marks to service_role;
grant all on public.staff_attendance_desk_settings to service_role;
grant all on public.staff_attendance_desk_sync_meta to service_role;

notify pgrst, 'reload schema';
