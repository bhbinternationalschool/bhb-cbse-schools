grant all on public.admission_desk_households to service_role;
grant all on public.admission_desk_leads to service_role;
grant all on public.admission_desk_registration_payments to service_role;
grant all on public.admission_desk_field_ops to service_role;
grant all on public.admission_desk_sync_meta to service_role;

notify pgrst, 'reload schema';
