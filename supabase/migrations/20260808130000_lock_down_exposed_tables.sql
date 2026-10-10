-- Resolve Supabase database-linter security findings.
--
-- The linter flags ~250 tables for `rls_disabled_in_public`, but most of
-- those carry no grant to anon/authenticated, so PostgREST cannot reach
-- them regardless. The genuinely reachable set is the ~25 below: RLS off
-- AND a live grant to `authenticated`. Those include RBAC configuration,
-- staff HR, staff advances and WhatsApp templates — a signed-in user
-- could read, and in some cases rewrite, all of it straight through
-- /rest/v1/.
--
-- Fix: enable RLS (with no policy, which denies every role subject to
-- RLS) and drop the grants. `service_role` has rolbypassrls = true —
-- verified on this project — so the Next.js API layer is unaffected.
--
-- Deliberately NOT included: public.library_state. Currently-deployed
-- browser code still reads it directly via domainBlobPersistence, so
-- locking it now would break the live app. It is covered by
-- 20260808100000_revoke_authenticated_table_access, which is held until
-- the server-routed build is deployed.
--
-- Also left alone: auth_tenant_id() and is_tenant_member(). The linter
-- suggests revoking EXECUTE from `authenticated`, but 20+ RLS policies
-- call is_tenant_member() and policy expressions are evaluated as the
-- querying role — revoking would break every one of those policies.
-- Moving them into a non-exposed schema is the correct fix and is left
-- as follow-up rather than done blind here.

do $$
declare
  t text;
  exposed text[] := array[
    -- foundation tables readable by any signed-in user
    'academic_years',
    'campuses',
    'tenant_modules',
    -- secondary desk-slice modules (all reached via /api/school-data/
    -- desk-slice/*, never queried directly from the browser)
    'rbac_desk_slices',                  'rbac_desk_sync_meta',
    'staff_hr_desk_slices',              'staff_hr_desk_sync_meta',
    'staff_advances_desk_slices',        'staff_advances_desk_sync_meta',
    'staff_chat_desk_slices',            'staff_chat_desk_sync_meta',
    'certificates_desk_slices',          'certificates_desk_sync_meta',
    'exam_papers_desk_slices',           'exam_papers_desk_sync_meta',
    'fee_recovery_tasks_desk_slices',    'fee_recovery_tasks_desk_sync_meta',
    'module_registry_desk_slices',       'module_registry_desk_sync_meta',
    'wa_templates_desk_slices',          'wa_templates_desk_sync_meta',
    'automation_desk_slices',            'automation_desk_sync_meta',
    'erp_chat_desk_slices',              'erp_chat_desk_sync_meta',
    -- RLS already on with no policy, but the stale grant is noise
    'school_comms_cross_posts'
  ];
begin
  foreach t in array exposed loop
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) then
      execute format('alter table public.%I enable row level security;', t);
      execute format('revoke all on table public.%I from anon, authenticated;', t);
    end if;
  end loop;
end $$;

-- fee_open_dues_v joins open dues to student names, admission numbers and
-- guardian mobiles. It is SECURITY DEFINER, so it served that join while
-- bypassing RLS on the underlying tables, and `authenticated` could read
-- it. Nothing in the application references it. Make it honour the
-- caller's permissions and drop the grants.
alter view public.fee_open_dues_v set (security_invoker = on);
revoke all on public.fee_open_dues_v from anon, authenticated;
