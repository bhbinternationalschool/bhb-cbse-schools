-- Fix version-token churn in sis_push_guarded.
--
-- The first version bumped updated_at on every row of every push, even
-- when the payload was byte-identical to what was stored. Since the
-- client caches updated_at as its optimistic-locking token, one routine
-- full-roster sync invalidated every token — including the pushing
-- client's own — so the next push reported all 904 records as conflicts
-- and refused to write any of them. A guard that blocks normal saves is
-- worse than no guard.
--
-- Two changes:
--
--   1. Skip no-op writes. If the incoming row matches what is stored
--      (ignoring updated_at), leave the row alone so its version stays
--      stable. Routine snapshot pushes then cost nothing and invalidate
--      nobody, and a conflict once again means a genuine concurrent edit.
--
--   2. Return the authoritative version per record. After a write the
--      client must learn the new updated_at, otherwise its next push of
--      that record carries a stale token and self-conflicts. The caller
--      re-stamps local records from this map.

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
  item             jsonb;
  payload          jsonb;
  incoming         jsonb;
  existing         jsonb;
  base_ts          timestamptz;
  stored_ts        timestamptz;
  rec_id           text;
  now_ts           timestamptz := now();
  applied_hh       int := 0;
  applied_stu      int := 0;
  unchanged        int := 0;
  unversioned      int := 0;
  conflicts        jsonb := '[]'::jsonb;
  hh_versions      jsonb := '{}'::jsonb;
  stu_versions     jsonb := '{}'::jsonb;
  active_students  int := 0;
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

    select to_jsonb(h) into existing
      from public.sis_households h
     where h.id = rec_id and h.tenant_id = p_tenant_id;

    incoming := payload || jsonb_build_object('tenant_id', p_tenant_id);

    if existing is not null then
      -- Nothing to do: keep the stored row and its version untouched.
      if (existing - 'updated_at') = (incoming - 'updated_at') then
        hh_versions := hh_versions
          || jsonb_build_object(rec_id, existing ->> 'updated_at');
        unchanged := unchanged + 1;
        continue;
      end if;

      stored_ts := (existing ->> 'updated_at')::timestamptz;
      if base_ts is null then
        unversioned := unversioned + 1;
      elsif base_ts <> stored_ts then
        conflicts := conflicts || jsonb_build_object(
          'table', 'sis_households', 'id', rec_id, 'stored', stored_ts
        );
        hh_versions := hh_versions || jsonb_build_object(rec_id, stored_ts);
        continue;
      end if;
    end if;

    insert into public.sis_households
    select * from jsonb_populate_record(null::public.sis_households,
      incoming || jsonb_build_object('updated_at', now_ts))
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

    hh_versions := hh_versions || jsonb_build_object(rec_id, now_ts);
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

    select to_jsonb(s) into existing
      from public.sis_students s
     where s.id = rec_id and s.tenant_id = p_tenant_id;

    incoming := payload || jsonb_build_object('tenant_id', p_tenant_id);

    if existing is not null then
      if (existing - 'updated_at') = (incoming - 'updated_at') then
        stu_versions := stu_versions
          || jsonb_build_object(rec_id, existing ->> 'updated_at');
        unchanged := unchanged + 1;
        continue;
      end if;

      stored_ts := (existing ->> 'updated_at')::timestamptz;
      if base_ts is null then
        unversioned := unversioned + 1;
      elsif base_ts <> stored_ts then
        conflicts := conflicts || jsonb_build_object(
          'table', 'sis_students', 'id', rec_id, 'stored', stored_ts
        );
        stu_versions := stu_versions || jsonb_build_object(rec_id, stored_ts);
        continue;
      end if;
    end if;

    insert into public.sis_students
    select * from jsonb_populate_record(null::public.sis_students,
      incoming || jsonb_build_object('updated_at', now_ts))
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

    stu_versions := stu_versions || jsonb_build_object(rec_id, now_ts);
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
