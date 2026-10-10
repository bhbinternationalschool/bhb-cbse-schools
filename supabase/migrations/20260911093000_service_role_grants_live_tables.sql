-- Six tables the server reads or writes through the service role were
-- created with RLS and a tenant policy but no privileges for service_role,
-- so every server call returned 42501 "permission denied" — quietly, since
-- most callers log and carry on:
--   wa_student_links / wa_student_link_codes  the LINK / UNLINK flow that
--                                              gives a child their own number
--   wa_cost_rates                              WhatsApp cost rates
--   staff_leave_requests                       the leave command and the
--                                              6 PM brief's leave count
--   sis_enrollments / sis_student_identities   the identity-split tables
-- Found 2026-09-11 while fixing the same omission on wa_send_claims:
--   select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
--   where nspname='public' and relkind='r'
--     and not has_table_privilege('service_role', c.oid, 'SELECT');
-- The rest of that list is backup snapshots and legacy tables the code no
-- longer touches. RLS says WHO may see a row; grants say IF the role may
-- touch the table at all — a new table needs both.

grant select, insert, update, delete on public.wa_student_links to service_role;
grant select, insert, update, delete on public.wa_student_link_codes to service_role;
grant select, insert, update, delete on public.wa_cost_rates to service_role;
grant select, insert, update, delete on public.staff_leave_requests to service_role;
grant select, insert, update, delete on public.sis_enrollments to service_role;
grant select, insert, update, delete on public.sis_student_identities to service_role;
