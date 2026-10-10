-- Restore the no-op skip that production has been missing since 2026-08-08.
--
-- 20260808150000_sis_push_guarded_stable_versions is RECORDED as applied (twice
-- — also as 20260809044047), but the function live in the database has no skip
-- at all: it checks the base revision, then writes unconditionally with
-- updated_at = now(). Its return shape has no 'unchanged' key, though the
-- TypeScript in sisNormalized.server.ts has always destructured one. The file
-- was evidently edited after it ran, and a recorded version is never re-run, so
-- the database kept the older body while the repo showed the newer one.
--
-- That is the real cause of the conflict storm. Every push rewrote all 904 rows
-- and bumped every updated_at, so every OTHER device's revision tokens went
-- stale at once and its next push came back with ~903 conflicts on records
-- nobody had touched. Chasing "the differing field" found nothing because no
-- field differed — the comparison that would have noticed simply was not there.
--
-- Measured, not assumed: the live function takes 136ms for the full 711+193
-- payload and applies all 904 records when handed data byte-identical to what
-- is already stored.
--
-- This re-applies the intended body verbatim from 20260808150000. The skip is
-- `(existing - 'updated_at') = (incoming - 'updated_at')` — keep the stored row
-- and its version, and report the version back so the client can re-stamp. It
-- is strictly safer than what is live: it can only decline to write when the
-- rows are already equal, and behaves exactly as today otherwise. Verified that
-- studentToRow/householdToRow emit exactly the 45 and 15 columns the tables
-- have — no missing or extra key — because one stray key would make the
-- comparison unequal forever and silently disable the skip.
--
-- The statement_timeout from 20260810090000 is re-applied at the end: CREATE OR
-- REPLACE resets a function's SET clauses, so leaving it out here would quietly
-- undo that fix.

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

-- Re-pin: CREATE OR REPLACE above cleared this. See 20260810090000.
alter function public.sis_push_guarded(uuid, jsonb, jsonb)
  set statement_timeout = '120s';
