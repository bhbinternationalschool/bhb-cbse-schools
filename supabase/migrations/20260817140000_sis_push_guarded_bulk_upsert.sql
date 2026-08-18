-- Replace sis_push_guarded's per-row PL/pgSQL loop with set-based bulk
-- upserts. The function is functionally unchanged (same skip-if-identical
-- check, same base-vs-stored conflict detection, same combined
-- unchanged/unversioned counters and merged conflicts array, same
-- {household,student}_versions maps, same sync-meta upsert) — only the
-- *mechanism* changes, from "SELECT existing, then INSERT ON CONFLICT,
-- once per row inside a loop" to "one bulk JOIN to classify every row,
-- one bulk INSERT ON CONFLICT for the rows that need writing."
--
-- Why: this function was already caught doing ~17s for 904 records back on
-- 2026-08-10 (see 20260810110000's own comment) and has since been living
-- on a 120s statement_timeout as a safety net rather than a real fix. In
-- production right now it is measured taking 10-55s per call, well past
-- the 30s window sisSyncRecentlyPushed() (sisNormalizedClient.ts) uses to
-- decide "trust local data, skip re-fetching from the server" — so a
-- client navigating shortly after a real edit (e.g. merging duplicate
-- students) can hit ensureSisHydrated() while the push is still in
-- flight, fetch the still-stale server copy, and silently overwrite the
-- correct local write with it. A fast push closes that race back down to
-- effectively nothing; the 30s guard was sized assuming pushes are fast,
-- not for a function that can now take the better part of a minute.
--
-- Row-by-row work here doesn't scale with roster size because every
-- iteration pays its own planner/executor round trip; a bulk JOIN +
-- bulk INSERT pays that cost once regardless of row count. Duplicate ids
-- within one payload (shouldn't happen from a keyed client collection,
-- but not guaranteed) are resolved keep-last, matching what the old
-- imperative loop did by construction.

create or replace function public.sis_push_guarded(
  p_tenant_id uuid,
  p_households jsonb default '[]'::jsonb,
  p_students jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  now_ts           timestamptz := now();

  applied_hh       int := 0;
  unchanged_hh     int := 0;
  unversioned_hh   int := 0;
  conflicts_hh     jsonb := '[]'::jsonb;
  hh_versions      jsonb := '{}'::jsonb;

  applied_stu      int := 0;
  unchanged_stu    int := 0;
  unversioned_stu  int := 0;
  conflicts_stu    jsonb := '[]'::jsonb;
  stu_versions     jsonb := '{}'::jsonb;

  unchanged        int;
  unversioned      int;
  conflicts        jsonb;
  active_students  int := 0;
begin
  -- ── Households (bulk) ─────────────────────────────────────────────
  with incoming as (
    select distinct on (id) id, row, base_ts
    from (
      select
        (item -> 'row' ->> 'id')::text as id,
        item -> 'row' as row,
        nullif(item ->> 'base', '')::timestamptz as base_ts,
        ord
      from jsonb_array_elements(coalesce(p_households, '[]'::jsonb))
             with ordinality as t(item, ord)
      where (item -> 'row' ->> 'id') is not null
    ) x
    order by id, ord desc
  ),
  joined as (
    select
      i.id,
      (i.row || jsonb_build_object('tenant_id', p_tenant_id)) as incoming_row,
      i.base_ts,
      to_jsonb(h) as existing,
      h.updated_at as stored_ts
    from incoming i
    left join public.sis_households h
      on h.id = i.id and h.tenant_id = p_tenant_id
  ),
  classified as (
    select
      id, incoming_row, base_ts, existing, stored_ts,
      case
        when existing is not null
             and (existing - 'updated_at') = (incoming_row - 'updated_at')
          then 'unchanged'
        when existing is not null and base_ts is not null and base_ts <> stored_ts
          then 'conflict'
        else 'apply'
      end as action
    from joined
  ),
  classified2 as (
    select *,
      (action = 'apply' and existing is not null and base_ts is null) as is_unversioned
    from classified
  ),
  applied as (
    insert into public.sis_households
    select (jsonb_populate_record(
              null::public.sis_households,
              incoming_row || jsonb_build_object('updated_at', now_ts)
            )).*
    from classified2
    where action = 'apply'
    on conflict (id) do update set
      code            = excluded.code,
      guardian_name   = excluded.guardian_name,
      mobile          = excluded.mobile,
      whatsapp_mobile = excluded.whatsapp_mobile,
      email           = excluded.email,
      address         = excluded.address,
      locality        = excluded.locality,
      landmark        = excluded.landmark,
      city            = excluded.city,
      state           = excluded.state,
      pincode         = excluded.pincode,
      alt_mobile      = excluded.alt_mobile,
      updated_at      = excluded.updated_at
    returning id
  )
  select
    (select count(*) from applied),
    (select count(*) from classified2 where action = 'unchanged'),
    (select count(*) from classified2 where is_unversioned),
    coalesce(
      (select jsonb_agg(jsonb_build_object('table', 'sis_households', 'id', id, 'stored', stored_ts))
         from classified2 where action = 'conflict'),
      '[]'::jsonb
    ),
    coalesce(
      (select jsonb_object_agg(id, case when action = 'apply' then now_ts else stored_ts end)
         from classified2),
      '{}'::jsonb
    )
  into applied_hh, unchanged_hh, unversioned_hh, conflicts_hh, hh_versions;

  -- ── Students (bulk) ───────────────────────────────────────────────
  with incoming as (
    select distinct on (id) id, row, base_ts
    from (
      select
        (item -> 'row' ->> 'id')::text as id,
        item -> 'row' as row,
        nullif(item ->> 'base', '')::timestamptz as base_ts,
        ord
      from jsonb_array_elements(coalesce(p_students, '[]'::jsonb))
             with ordinality as t(item, ord)
      where (item -> 'row' ->> 'id') is not null
    ) x
    order by id, ord desc
  ),
  joined as (
    select
      i.id,
      (i.row || jsonb_build_object('tenant_id', p_tenant_id)) as incoming_row,
      i.base_ts,
      to_jsonb(s) as existing,
      s.updated_at as stored_ts
    from incoming i
    left join public.sis_students s
      on s.id = i.id and s.tenant_id = p_tenant_id
  ),
  classified as (
    select
      id, incoming_row, base_ts, existing, stored_ts,
      case
        when existing is not null
             and (existing - 'updated_at') = (incoming_row - 'updated_at')
          then 'unchanged'
        when existing is not null and base_ts is not null and base_ts <> stored_ts
          then 'conflict'
        else 'apply'
      end as action
    from joined
  ),
  classified2 as (
    select *,
      (action = 'apply' and existing is not null and base_ts is null) as is_unversioned
    from classified
  ),
  applied as (
    insert into public.sis_students
    select (jsonb_populate_record(
              null::public.sis_students,
              incoming_row || jsonb_build_object('updated_at', now_ts)
            )).*
    from classified2
    where action = 'apply'
    on conflict (id) do update set
      admission_no             = excluded.admission_no,
      full_name                = excluded.full_name,
      gender                   = excluded.gender,
      dob                      = excluded.dob,
      status                   = excluded.status,
      campus_id                = excluded.campus_id,
      class_id                 = excluded.class_id,
      section_id               = excluded.section_id,
      roll_no                  = excluded.roll_no,
      academic_year_code       = excluded.academic_year_code,
      student_type             = excluded.student_type,
      fee_group_id             = excluded.fee_group_id,
      joined_on                = excluded.joined_on,
      father_name               = excluded.father_name,
      mother_name               = excluded.mother_name,
      father_mobile             = excluded.father_mobile,
      mother_mobile             = excluded.mother_mobile,
      father_aadhaar_last4      = excluded.father_aadhaar_last4,
      mother_aadhaar_last4      = excluded.mother_aadhaar_last4,
      father_pan                = excluded.father_pan,
      mother_pan                = excluded.mother_pan,
      guardian_relation         = excluded.guardian_relation,
      emergency_name            = excluded.emergency_name,
      emergency_mobile          = excluded.emergency_mobile,
      household_id              = excluded.household_id,
      blood_group               = excluded.blood_group,
      religion                  = excluded.religion,
      category                  = excluded.category,
      nationality               = excluded.nationality,
      mother_tongue             = excluded.mother_tongue,
      place_of_birth            = excluded.place_of_birth,
      aadhaar_last4             = excluded.aadhaar_last4,
      pen                       = excluded.pen,
      pen_status                = excluded.pen_status,
      apaar_id                  = excluded.apaar_id,
      srn                       = excluded.srn,
      previous_school           = excluded.previous_school,
      previous_tc_no            = excluded.previous_tc_no,
      previous_udise            = excluded.previous_udise,
      docs                      = excluded.docs,
      notes                     = excluded.notes,
      photo_url                 = excluded.photo_url,
      updated_at                = excluded.updated_at
    returning id
  )
  select
    (select count(*) from applied),
    (select count(*) from classified2 where action = 'unchanged'),
    (select count(*) from classified2 where is_unversioned),
    coalesce(
      (select jsonb_agg(jsonb_build_object('table', 'sis_students', 'id', id, 'stored', stored_ts))
         from classified2 where action = 'conflict'),
      '[]'::jsonb
    ),
    coalesce(
      (select jsonb_object_agg(id, case when action = 'apply' then now_ts else stored_ts end)
         from classified2),
      '{}'::jsonb
    )
  into applied_stu, unchanged_stu, unversioned_stu, conflicts_stu, stu_versions;

  unchanged := unchanged_hh + unchanged_stu;
  unversioned := unversioned_hh + unversioned_stu;
  conflicts := conflicts_hh || conflicts_stu;

  -- ── Sync meta (same transaction as the rows it describes) ─────────
  select count(*) into active_students
    from public.sis_students
   where tenant_id = p_tenant_id and status = 'active';

  insert into public.sis_sync_meta as m (
    tenant_id, household_count, student_count, active_student_count, updated_at
  )
  values (
    p_tenant_id,
    (select count(*) from public.sis_households where tenant_id = p_tenant_id),
    (select count(*) from public.sis_students   where tenant_id = p_tenant_id),
    active_students,
    now_ts
  )
  on conflict (tenant_id) do update set
    household_count      = excluded.household_count,
    student_count        = excluded.student_count,
    active_student_count = excluded.active_student_count,
    updated_at            = excluded.updated_at;

  return jsonb_build_object(
    'applied_households',  applied_hh,
    'applied_students',    applied_stu,
    'unchanged',           unchanged,
    'unversioned',         unversioned,
    'conflicts',           conflicts,
    'household_versions',  hh_versions,
    'student_versions',    stu_versions
  );
end;
$$;

revoke all on function public.sis_push_guarded(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.sis_push_guarded(uuid, jsonb, jsonb) to service_role;

alter function public.sis_push_guarded(uuid, jsonb, jsonb)
  set statement_timeout = '120s';
