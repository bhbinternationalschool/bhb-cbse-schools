-- erp_versions(p_tenant): the one change signal (data-layer step 1.3, rule R3).
--
-- One call, one round trip, one jsonb object:
--
--   { "<key>": { "updated_at": <timestamptz | null>, "count": <bigint | null> }, ... }
--
-- Keys, in four groups:
--
--   1. Every *_sync_meta table that exists when the function is CALLED, keyed
--      by the table name without "_desk_sync_meta" / "_sync_meta":
--      masters_desk_sync_meta -> "masters", sis_sync_meta -> "sis",
--      fee_desk_sync_meta -> "fee". updated_at is the row's updated_at (every
--      writer that owns the desk bumps it); count is the one count column
--      that best says "this desk has data" (mapping below). A tenant with no
--      sync_meta row yet gets {updated_at: null, count: null}.
--   2. Row tables with no sync_meta of their own: sis_staff, sis_departments,
--      sis_designations, masters_desk_settings ->
--      {updated_at: max(updated_at), count: count(*)} for the tenant. The
--      count is what moves on a delete, which max(updated_at) cannot see.
--   3. module_local_state, one key per module book: "module_state:<module_key>"
--      -> {updated_at, count: 1}. Each book is one row (primary key tenant_id,
--      module_key) and its writers set updated_at on every write
--      (lib/moduleLocalState.server.ts, module-state/[module] route). A count
--      of the items inside a book would mean de-TOASTing every book's jsonb
--      on every poll; that is not "fast", and updated_at already moves.
--   4. The *_state domain blob tables (one jsonb row per tenant, primary key
--      tenant_id), keyed by table name -> {updated_at, count: 0 | 1}. Named
--      here, from the migrations:
--        accounts_state admissions_state attendance_state automation_state
--        certificates_state erp_chat_state exam_papers_state exams_state
--        fee_recovery_tasks_state fees_state homework_state library_state
--        module_registry_state notifications_state payments_state
--        payroll_state ptm_state rbac_state rte_state salary_setup_state
--        school_comms_state school_mirror_state social_integrations_state
--        staff_advances_state staff_agreements_state staff_attendance_state
--        staff_chat_state staff_hr_state student_leave_state teaching_state
--        timetable_state transport_state trust_state vault_state
--        wa_bot_threads_state wa_templates_state
--      Not blobs, so not here: module_local_state (group 3),
--      admission_lead_market_state and wa_contact_state (row tables that only
--      share the suffix). purchase_state and store_state were dropped by
--      20260823220000_inventory_phase5_drop_legacy.sql.
--
-- Why the table list is looked up in pg_catalog at CALL time (not built at
-- creation time, not a fixed list behind to_regclass checks): production has
-- 35 *_sync_meta tables while the migrations create 37 — purchase_desk_ and
-- store_desk_sync_meta were dropped on 23 Aug (COMMAND.md 0.6) — and desks
-- will keep being added and dropped through Phase 6. A function body that
-- names a table fails at run time once that table is dropped; a list fixed at
-- creation time never sees a desk added later. Reading pg_catalog on each call
-- costs one small catalog scan (well under a millisecond) and means a dropped
-- table simply disappears from the answer and a new *_sync_meta table appears
-- in it with no migration. Every table is also checked for the columns the
-- query uses (tenant_id, updated_at, the count column), so a table that does
-- not fit is skipped (or reported with count null), never an error. The named
-- blobs and row tables of groups 2 and 4 get the same existence + column check.
--
-- Count column per *_sync_meta table (group 1):
--   accounts_desk          voucher_count      admission_desk     lead_count
--   attendance_desk        register_count     exam_desk          sheet_count
--   fee_desk               voucher_count      homework_desk      post_count
--   library_desk           title_count        masters_desk       class_count
--   notifications_desk     item_count         payment_desk       link_count
--   payroll_desk           run_count          ptm_desk           event_count
--   rte_desk               application_count  school_comms_desk  notice_count
--   sis                    student_count      staff_attendance_desk register_count
--   statutory_desk         batch_count        student_leave_desk request_count
--   timetable_desk         grid_count         transport_desk     route_count
--   trust_desk             project_count      vault_desk         document_count
--   wa_desk                thread_count
--   the desk-slice modules (automation, certificates, erp_chat, exam_papers,
--   fee_recovery_tasks, module_registry, rbac, staff_advances,
--   staff_agreements, staff_chat, staff_hr, wa_templates)  row_count
--   (purchase_desk order_count and store_desk item_count are kept in the
--   mapping for a database that still has them.) A *_sync_meta table not in
--   the mapping is reported with count null.
--
-- Read-only (STABLE), SECURITY DEFINER with search_path public, executable by
-- service_role only: the app calls it through the service client
-- (lib/data/server/versions.ts) and serves it at GET /api/data/views/versions
-- behind a session.

create or replace function public.erp_versions(p_tenant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  parts text[] := array[]::text[];
  r record;
  result jsonb;
begin
  if p_tenant is null then
    raise exception 'erp_versions: p_tenant is required';
  end if;

  -- 1. *_sync_meta tables present now.
  for r in
    select c.relname::text as tbl,
           regexp_replace(c.relname::text, '(_desk)?_sync_meta$', '') as k,
           (select m.col
              from (values
                ('accounts_desk_sync_meta', 'voucher_count'),
                ('admission_desk_sync_meta', 'lead_count'),
                ('attendance_desk_sync_meta', 'register_count'),
                ('automation_desk_sync_meta', 'row_count'),
                ('certificates_desk_sync_meta', 'row_count'),
                ('erp_chat_desk_sync_meta', 'row_count'),
                ('exam_desk_sync_meta', 'sheet_count'),
                ('exam_papers_desk_sync_meta', 'row_count'),
                ('fee_desk_sync_meta', 'voucher_count'),
                ('fee_recovery_tasks_desk_sync_meta', 'row_count'),
                ('homework_desk_sync_meta', 'post_count'),
                ('library_desk_sync_meta', 'title_count'),
                ('masters_desk_sync_meta', 'class_count'),
                ('module_registry_desk_sync_meta', 'row_count'),
                ('notifications_desk_sync_meta', 'item_count'),
                ('payment_desk_sync_meta', 'link_count'),
                ('payroll_desk_sync_meta', 'run_count'),
                ('ptm_desk_sync_meta', 'event_count'),
                ('purchase_desk_sync_meta', 'order_count'),
                ('rbac_desk_sync_meta', 'row_count'),
                ('rte_desk_sync_meta', 'application_count'),
                ('school_comms_desk_sync_meta', 'notice_count'),
                ('sis_sync_meta', 'student_count'),
                ('staff_advances_desk_sync_meta', 'row_count'),
                ('staff_agreements_desk_sync_meta', 'row_count'),
                ('staff_attendance_desk_sync_meta', 'register_count'),
                ('staff_chat_desk_sync_meta', 'row_count'),
                ('staff_hr_desk_sync_meta', 'row_count'),
                ('statutory_desk_sync_meta', 'batch_count'),
                ('store_desk_sync_meta', 'item_count'),
                ('student_leave_desk_sync_meta', 'request_count'),
                ('timetable_desk_sync_meta', 'grid_count'),
                ('transport_desk_sync_meta', 'route_count'),
                ('trust_desk_sync_meta', 'project_count'),
                ('vault_desk_sync_meta', 'document_count'),
                ('wa_desk_sync_meta', 'thread_count'),
                ('wa_templates_desk_sync_meta', 'row_count')
              ) as m(tbl, col)
             where m.tbl = c.relname::text
               and exists (select 1 from pg_attribute a
                            where a.attrelid = c.oid and a.attname = m.col
                              and a.attnum > 0 and not a.attisdropped)) as count_col
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and c.relname::text like '%\_sync\_meta' escape '\'
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid
                    and a.attname = 'tenant_id' and a.attnum > 0 and not a.attisdropped)
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid
                    and a.attname = 'updated_at' and a.attnum > 0 and not a.attisdropped)
     order by c.relname
  loop
    parts := array_append(parts, format(
      'select %L::text as k, coalesce((select jsonb_build_object(''updated_at'', m.updated_at, ''count'', %s) '
        'from public.%I m where m.tenant_id = $1 limit 1), '
        'jsonb_build_object(''updated_at'', null, ''count'', null)) as v',
      r.k,
      case when r.count_col is null then 'null' else format('m.%I', r.count_col) end,
      r.tbl));
  end loop;

  -- 2. Row tables without a sync_meta of their own; 4. the named blobs.
  --    Same query shape: max(updated_at) + count(*) for the tenant.
  for r in
    select t.tbl
      from unnest(array[
        'sis_staff', 'sis_departments', 'sis_designations', 'masters_desk_settings',
        'accounts_state', 'admissions_state', 'attendance_state', 'automation_state',
        'certificates_state', 'erp_chat_state', 'exam_papers_state', 'exams_state',
        'fee_recovery_tasks_state', 'fees_state', 'homework_state', 'library_state',
        'module_registry_state', 'notifications_state', 'payments_state',
        'payroll_state', 'ptm_state', 'rbac_state', 'rte_state', 'salary_setup_state',
        'school_comms_state', 'school_mirror_state', 'social_integrations_state',
        'staff_advances_state', 'staff_agreements_state', 'staff_attendance_state',
        'staff_chat_state', 'staff_hr_state', 'student_leave_state', 'teaching_state',
        'timetable_state', 'transport_state', 'trust_state', 'vault_state',
        'wa_bot_threads_state', 'wa_templates_state'
      ]) as t(tbl)
      join pg_class c on c.relname = t.tbl and c.relkind in ('r', 'p')
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where exists (select 1 from pg_attribute a where a.attrelid = c.oid
                    and a.attname = 'tenant_id' and a.attnum > 0 and not a.attisdropped)
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid
                    and a.attname = 'updated_at' and a.attnum > 0 and not a.attisdropped)
  loop
    parts := array_append(parts, format(
      'select %L::text as k, (select jsonb_build_object(''updated_at'', max(x.updated_at), ''count'', count(*)) '
        'from public.%I x where x.tenant_id = $1) as v',
      r.tbl, r.tbl));
  end loop;

  -- 3. One key per module book.
  if to_regclass('public.module_local_state') is not null then
    parts := array_append(parts, 'select ''module_state:'' || s.module_key as k, '
      'jsonb_build_object(''updated_at'', s.updated_at, ''count'', 1) as v '
      'from public.module_local_state s where s.tenant_id = $1'::text);
  end if;

  if array_length(parts, 1) is null then
    return '{}'::jsonb;
  end if;

  execute 'select coalesce(jsonb_object_agg(q.k, q.v), ''{}''::jsonb) from ('
    || array_to_string(parts, ' union all ') || ') q'
    into result
    using p_tenant;
  return result;
end;
$$;

comment on function public.erp_versions(uuid) is
  'data-layer 1.3 (R3): {key: {updated_at, count}} for every *_sync_meta table present at call time, '
  'sis_staff/sis_departments/sis_designations/masters_desk_settings, each module_local_state book '
  '(module_state:<key>) and each *_state blob. Read-only; service_role only.';

revoke all on function public.erp_versions(uuid) from public;
revoke all on function public.erp_versions(uuid) from anon;
revoke all on function public.erp_versions(uuid) from authenticated;
grant execute on function public.erp_versions(uuid) to service_role;
