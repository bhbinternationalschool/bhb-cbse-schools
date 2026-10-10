-- Atomic, conflict-guarded SIS push.
--
-- Solves two Tier-0 problems in one call:
--
--   T0.3 (atomicity) — pushSisToDb previously issued households upsert,
--   then N chunked student upserts, then a sync_meta upsert, as separate
--   round trips. A failure part-way through left the roster half-written.
--   A plpgsql function body runs in a single transaction, so the whole
--   push now commits or rolls back together.
--
--   T0.2 (lost updates) — the client pushes its whole roster snapshot, so
--   two staff editing different students at the same time would have the
--   second push overwrite the first with its stale copy, silently. Each
--   record now carries the `updated_at` it was read at (`revisionAt` on
--   the client). We write only when that matches what is stored; anything
--   else is returned as a conflict instead of clobbering the newer row.
--
-- Payload shape for p_households / p_students:
--   [ { "row": { ...column values... }, "base": "<iso timestamp>" | null }, ... ]
--
-- Returns:
--   { "applied_households": n, "applied_students": n,
--     "conflicts": [ { "table": "...", "id": "...", "stored": "<iso>" } ],
--     "unversioned": n }
--
-- `base` = null means the client has no known base version. That happens
-- for records created locally and never synced (no stored row → a plain
-- insert, no conflict possible) and for clients running code older than
-- this change. We allow those writes rather than failing closed, so the
-- rollout cannot break saving, and count them in `unversioned` so the
-- behaviour is observable. Once every client has hydrated once, every
-- record that exists server-side carries a real base version.

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
  item            jsonb;
  payload         jsonb;
  base_ts         timestamptz;
  stored_ts       timestamptz;
  rec_id          text;
  now_ts          timestamptz := now();
  applied_hh      int := 0;
  applied_stu     int := 0;
  unversioned     int := 0;
  conflicts       jsonb := '[]'::jsonb;
  active_students int := 0;
begin
  -- ── Households ────────────────────────────────────────────────────
  for item in select * from jsonb_array_elements(coalesce(p_households, '[]'::jsonb))
  loop
    payload := item -> 'row';
    rec_id  := payload ->> 'id';
    if rec_id is null then
      continue;
    end if;

    base_ts := nullif(item ->> 'base', '')::timestamptz;

    select h.updated_at into stored_ts
      from public.sis_households h
     where h.id = rec_id and h.tenant_id = p_tenant_id;

    if stored_ts is not null then
      if base_ts is null then
        unversioned := unversioned + 1;
      elsif base_ts <> stored_ts then
        conflicts := conflicts || jsonb_build_object(
          'table', 'sis_households', 'id', rec_id, 'stored', stored_ts
        );
        continue;
      end if;
    end if;

    insert into public.sis_households
    select * from jsonb_populate_record(null::public.sis_households,
      payload || jsonb_build_object('tenant_id', p_tenant_id, 'updated_at', now_ts))
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
      updated_at      = excluded.updated_at;

    applied_hh := applied_hh + 1;
  end loop;

  -- ── Students ──────────────────────────────────────────────────────
  for item in select * from jsonb_array_elements(coalesce(p_students, '[]'::jsonb))
  loop
    payload := item -> 'row';
    rec_id  := payload ->> 'id';
    if rec_id is null then
      continue;
    end if;

    base_ts := nullif(item ->> 'base', '')::timestamptz;

    select s.updated_at into stored_ts
      from public.sis_students s
     where s.id = rec_id and s.tenant_id = p_tenant_id;

    if stored_ts is not null then
      if base_ts is null then
        unversioned := unversioned + 1;
      elsif base_ts <> stored_ts then
        conflicts := conflicts || jsonb_build_object(
          'table', 'sis_students', 'id', rec_id, 'stored', stored_ts
        );
        continue;
      end if;
    end if;

    insert into public.sis_students
    select * from jsonb_populate_record(null::public.sis_students,
      payload || jsonb_build_object('tenant_id', p_tenant_id, 'updated_at', now_ts))
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
      father_name              = excluded.father_name,
      mother_name              = excluded.mother_name,
      father_mobile            = excluded.father_mobile,
      mother_mobile            = excluded.mother_mobile,
      father_aadhaar_last4     = excluded.father_aadhaar_last4,
      mother_aadhaar_last4     = excluded.mother_aadhaar_last4,
      father_pan               = excluded.father_pan,
      mother_pan               = excluded.mother_pan,
      guardian_relation        = excluded.guardian_relation,
      emergency_name           = excluded.emergency_name,
      emergency_mobile         = excluded.emergency_mobile,
      household_id             = excluded.household_id,
      blood_group              = excluded.blood_group,
      religion                 = excluded.religion,
      category                 = excluded.category,
      nationality              = excluded.nationality,
      mother_tongue            = excluded.mother_tongue,
      place_of_birth           = excluded.place_of_birth,
      aadhaar_last4            = excluded.aadhaar_last4,
      pen                      = excluded.pen,
      pen_status               = excluded.pen_status,
      apaar_id                 = excluded.apaar_id,
      srn                      = excluded.srn,
      previous_school          = excluded.previous_school,
      previous_tc_no           = excluded.previous_tc_no,
      previous_udise           = excluded.previous_udise,
      docs                     = excluded.docs,
      notes                    = excluded.notes,
      photo_url                = excluded.photo_url,
      updated_at               = excluded.updated_at;

    applied_stu := applied_stu + 1;
  end loop;

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
    updated_at           = excluded.updated_at;

  return jsonb_build_object(
    'applied_households', applied_hh,
    'applied_students',   applied_stu,
    'unversioned',        unversioned,
    'conflicts',          conflicts
  );
end;
$$;

-- Only the API layer (service_role) may call this. The browser has no
-- direct table access after 20260808100000_revoke_authenticated_table_access.
revoke all on function public.sis_push_guarded(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.sis_push_guarded(uuid, jsonb, jsonb) to service_role;
