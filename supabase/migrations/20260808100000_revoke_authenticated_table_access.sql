-- Close the RLS bypass: staff (and any other authenticated Supabase Auth
-- user) could previously call the Supabase REST API directly with their
-- own JWT and read/write these tables, since RLS here only checked
-- tenant_id, not the app's RBAC role. As of this migration, the browser
-- no longer queries any of these tables directly — every read/write goes
-- through the Next.js API layer (service_role), which enforces per-module
-- RBAC. See apps/web/src/lib/domainBlobPersistence.ts,
-- staffPersistence.ts, curriculumPersistence.ts and their new
-- /api/school-data/* routes.
--
-- This migration only revokes the `authenticated`/`anon` grants that made
-- direct client access possible. It does not touch `service_role`, which
-- bypasses RLS by design and is what the API layer uses — the app's own
-- functionality is unaffected.

do $$
declare
  t text;
  tables text[] := array[
    -- domain-blob tables (one jsonb row per tenant)
    'fees_state', 'payments_state', 'attendance_state', 'exams_state',
    'payroll_state', 'accounts_state', 'store_state', 'purchase_state',
    'staff_attendance_state', 'staff_hr_state', 'staff_advances_state',
    'staff_agreements_state', 'rbac_state', 'module_registry_state',
    'trust_state', 'transport_state', 'homework_state', 'timetable_state',
    'exam_papers_state', 'ptm_state', 'student_leave_state',
    'certificates_state', 'vault_state', 'rte_state',
    'fee_recovery_tasks_state', 'school_comms_state',
    'notifications_state', 'staff_chat_state', 'erp_chat_state',
    'wa_templates_state', 'automation_state', 'admissions_state',
    'library_state',
    -- staff roster (normalized)
    'sis_staff', 'sis_departments', 'sis_designations',
    -- curriculum
    'student_curriculum', 'curriculum_requests', 'class_curriculum_templates',
    -- SIS roster + admissions desk (already server-routed; never had a
    -- legitimate client-direct reader — closing the same gap here too)
    'sis_students', 'sis_households',
    'admission_desk_households', 'admission_desk_leads',
    'admission_desk_registration_payments', 'admission_desk_field_ops'
  ];
begin
  foreach t in array tables loop
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) then
      execute format('revoke all on table public.%I from authenticated, anon;', t);
    end if;
  end loop;
end $$;
