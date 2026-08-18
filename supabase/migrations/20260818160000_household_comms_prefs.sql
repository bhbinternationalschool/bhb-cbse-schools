-- Household communication preferences (AI roadmap 2.1, 2026-08-18).
--
-- preferred_language: language code the family wants to be addressed in --
--   en | hi | bn | ur | mai ... ; '' = not asked yet (callers fall back to the
--   school default, never assume). Drives which WhatsApp template language is
--   picked, which language AI drafts are written in, and -- for languages Meta
--   templates don't cover -- a Sarvam translation of free text.
-- channel_preference: whatsapp | sms | call | '' (unset).
-- quiet_hours_start/end: HH:MM IST, '' = none. Non-urgent sends should wait
--   outside this window (helper: lib/householdPrefs.ts isInQuietHours).
--
-- Columns are nullable-with-default so a client built before this migration
-- (which sends no key -> jsonb_populate_record NULL) can still insert; the
-- push function below coalesces on conflict so it also cannot wipe a value.

alter table public.sis_households
  add column if not exists preferred_language text default '',
  add column if not exists channel_preference text default '',
  add column if not exists quiet_hours_start  text default '',
  add column if not exists quiet_hours_end    text default '';

comment on column public.sis_households.preferred_language is
  'Family preferred language code (en|hi|bn|ur|mai...); empty = not asked';
comment on column public.sis_households.channel_preference is
  'whatsapp | sms | call | empty (unset)';
comment on column public.sis_households.quiet_hours_start is
  'HH:MM IST start of do-not-disturb window; empty = none';
comment on column public.sis_households.quiet_hours_end is
  'HH:MM IST end of do-not-disturb window; empty = none';

-- Same function as 20260817140000 with (a) the four new columns in the
-- household ON CONFLICT set (coalesced) and (b) the household "unchanged"
-- test comparing only the keys the client sent. Students block unchanged.

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
        -- Compare only the keys the client sent: a client built before a
        -- column existed must read as "unchanged", not rewrite every
        -- household (and bump every version) on each push.
        when existing is not null
             and (select coalesce(jsonb_object_agg(k, existing -> k), '{}'::jsonb)
                    from jsonb_object_keys(incoming_row - 'updated_at') as k)
                 = (incoming_row - 'updated_at')
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
      -- Comms preferences (2026-08-18). coalesce: a client built before these
      -- columns existed sends no key -> jsonb_populate_record yields NULL -> must
      -- not wipe a preference a newer client already saved.
      preferred_language = coalesce(excluded.preferred_language, sis_households.preferred_language),
      channel_preference = coalesce(excluded.channel_preference, sis_households.channel_preference),
      quiet_hours_start  = coalesce(excluded.quiet_hours_start,  sis_households.quiet_hours_start),
      quiet_hours_end    = coalesce(excluded.quiet_hours_end,    sis_households.quiet_hours_end),
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
