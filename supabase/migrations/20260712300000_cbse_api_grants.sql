-- API grants for CBSE dual-mode tables (PostgREST roles).
-- Required after creating tables as postgres — without these, service_role/authenticated get permission denied.

grant usage on schema public to anon, authenticated, service_role;

grant select on public.tenants to anon, authenticated;
grant select, insert, update, delete, references, trigger on public.tenants to service_role;

grant select, insert, update, delete on public.profiles to authenticated;
grant all on public.profiles to service_role;

grant select, insert, update, delete on public.sis_households to authenticated;
grant select, insert, update, delete on public.sis_students to authenticated;
grant select, insert, update, delete on public.student_curriculum to authenticated;
grant select, insert, update, delete on public.curriculum_requests to authenticated;
grant select, insert, update, delete on public.class_curriculum_templates to authenticated;

grant all on public.sis_households to service_role;
grant all on public.sis_students to service_role;
grant all on public.student_curriculum to service_role;
grant all on public.curriculum_requests to service_role;
grant all on public.class_curriculum_templates to service_role;

grant select on public.tenant_modules to authenticated, service_role;
grant select on public.academic_years to authenticated, service_role;
grant select on public.campuses to authenticated, service_role;

notify pgrst, 'reload schema';
