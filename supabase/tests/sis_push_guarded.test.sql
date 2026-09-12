-- Behavioural test for sis_push_guarded (rewritten in 20260912100000).
--
-- Like desk_write_guarded.test.sql this cannot live in scripts/verify.sh: the
-- logic is plpgsql, so it needs a real database.
--
--   psql "$DATABASE_URL" -f supabase/tests/sis_push_guarded.test.sql
--
-- Read the `pass` column — every row must be true. The whole file is ONE
-- transaction and ends in ROLLBACK, so it writes nothing permanent and is safe
-- to run against production. It uses a probe tenant of its own rather than the
-- school's, so no real row is ever a subject.
--
-- What it is guarding against. Until 2026-09-12 the function ended in a
-- hand-written `on conflict do update set` list, and every column added after
-- 2026-08-18 was missing from it: for a row that already existed the value
-- arrived, was compared, was written into the INSERT, and was then dropped by
-- the conflict path. sis_students.profile (the full Aadhaar numbers of student,
-- father and mother, verification, the UDISE+ flags, caste, permanent address,
-- bank, occupation, qualification, income, health, RFID, languages, tags) was
-- `{}` on 716 of 717 production rows; the geocode columns added the day before
-- were empty on all 200 households. The office reported it as "we enter the
-- Aadhaar numbers and education and occupation, and everything vanishes".
begin;

insert into public.tenants (id, name)
values ('00000000-0000-4000-8000-00000000ffff', 'sis_push_guarded probe')
on conflict (id) do nothing;

create or replace function pg_temp.stu(p_extra jsonb default '{}'::jsonb)
returns jsonb language sql as $$
  select jsonb_build_object(
    'id','stu_probe','admission_no','PROBE-1','full_name','Probe Child',
    'status','active','class_id','c1','section_id','s1','campus_id','cam1',
    'roll_no','1','academic_year_code','2026-27','student_type','NEW',
    'fee_group_id',null,'joined_on','2026-04-01','dob','2016-04-01','gender','M',
    'father_name','Probe Father','mother_name','Probe Mother',
    'father_mobile','9000000001','mother_mobile','9000000002',
    'father_aadhaar_last4','7141','mother_aadhaar_last4','7639',
    'father_pan','','mother_pan','','guardian_relation','Father',
    'emergency_name','','emergency_mobile','','household_id',null,
    'blood_group','','religion','','category','GEN','nationality','Indian',
    'mother_tongue','','place_of_birth','','aadhaar_last4','5109',
    'pen','','pen_status','','apaar_id','','srn','','previous_school','',
    'previous_tc_no','','previous_udise','','docs','{}'::jsonb,'notes','',
    'photo_url','',
    'profile', jsonb_build_object(
      'aadhaarNumber','111122223333','fatherAadhaarNumber','444455557141',
      'motherAadhaarNumber','666677777639','fatherOccupation','Farmer',
      'fatherQualification','Intermediate','motherOccupation','Homemaker',
      'aadhaarVerification','received')
  ) || p_extra
$$;

create or replace function pg_temp.push(p_tenant uuid, p_row jsonb, p_base timestamptz)
returns jsonb language sql as $$
  select public.sis_push_guarded(
    p_tenant, '[]'::jsonb,
    jsonb_build_array(jsonb_build_object('row', p_row, 'base', p_base)))
$$;

create or replace function pg_temp.run(p_tenant uuid)
returns table (check_name text, pass boolean, detail jsonb)
language plpgsql as $$
declare
  r jsonb;
  base timestamptz;
  before_ts timestamptz;
  row_ jsonb;
  n_stu int := (select count(*) from public.sis_students);
  n_hh  int := (select count(*) from public.sis_households);
begin
  -- 1. a new student: the whole row lands, profile included
  r := pg_temp.push(p_tenant, pg_temp.stu(), null);
  select to_jsonb(s) into row_ from public.sis_students s where s.id = 'stu_probe';
  check_name := 'new student: full Aadhaar + occupation stored';
  detail := row_ -> 'profile';
  pass := (r->>'applied_students')::int = 1
      and row_->'profile'->>'fatherAadhaarNumber' = '444455557141'
      and row_->'profile'->>'motherAadhaarNumber' = '666677777639'
      and row_->'profile'->>'fatherOccupation' = 'Farmer'
      and row_->>'father_mobile' = '9000000001'
      and row_->>'mother_mobile' = '9000000002'; return next;

  -- 2. an edit to an existing student: the profile change is written.
  --    THIS is what the old function dropped.
  select updated_at into base from public.sis_students where id = 'stu_probe';
  r := pg_temp.push(
    p_tenant,
    pg_temp.stu(jsonb_build_object('profile',
      (select profile from public.sis_students where id='stu_probe')
        || jsonb_build_object('motherQualification','Graduate','annualIncome','120000'))),
    base);
  check_name := 'edit: a profile-only change reaches the row';
  detail := (select profile from public.sis_students where id='stu_probe');
  pass := (r->>'applied_students')::int = 1
      and (select profile->>'motherQualification' from public.sis_students where id='stu_probe') = 'Graduate'
      and (select profile->>'fatherAadhaarNumber' from public.sis_students where id='stu_probe') = '444455557141'; return next;

  -- 3. a client built before a column existed cannot blank it
  select updated_at into base from public.sis_students where id = 'stu_probe';
  r := pg_temp.push(
    p_tenant,
    jsonb_build_object('id','stu_probe','full_name','Probe Child Renamed','pen','PEN-PROBE'),
    base);
  select to_jsonb(s) into row_ from public.sis_students s where s.id = 'stu_probe';
  check_name := 'sparse payload: sends 3 keys, keeps the other 43';
  detail := jsonb_build_object('full_name', row_->>'full_name', 'pen', row_->>'pen',
    'father_aadhaar', row_->'profile'->>'fatherAadhaarNumber', 'adm', row_->>'admission_no');
  pass := (r->>'applied_students')::int = 1
      and row_->>'full_name' = 'Probe Child Renamed'
      and row_->>'pen' = 'PEN-PROBE'
      and row_->'profile'->>'fatherAadhaarNumber' = '444455557141'
      and row_->>'admission_no' = 'PROBE-1'
      and row_->>'father_mobile' = '9000000001'; return next;

  -- 4. the same values twice: unchanged, and the version is not bumped
  select updated_at into before_ts from public.sis_students where id = 'stu_probe';
  r := pg_temp.push(p_tenant,
        (select to_jsonb(s) from public.sis_students s where s.id='stu_probe'), before_ts);
  check_name := 'idempotent: same values report unchanged, version held';
  detail := jsonb_build_object('applied', r->'applied_students', 'unchanged', r->'unchanged');
  pass := (r->>'applied_students')::int = 0
      and (r->>'unchanged')::int = 1
      and (select updated_at from public.sis_students where id='stu_probe') = before_ts; return next;

  -- 5. a stale base is a conflict, and the row is untouched
  select updated_at into before_ts from public.sis_students where id = 'stu_probe';
  r := pg_temp.push(p_tenant,
        (select to_jsonb(s) || jsonb_build_object('full_name','Stale Write')
           from public.sis_students s where s.id='stu_probe'),
        before_ts - interval '1 hour');
  check_name := 'stale base: refused, reported, row kept';
  detail := r->'conflicts';
  pass := (r->>'applied_students')::int = 0
      and jsonb_array_length(r->'conflicts') = 1
      and (select full_name from public.sis_students where id='stu_probe') = 'Probe Child Renamed'
      and (select updated_at from public.sis_students where id='stu_probe') = before_ts; return next;

  -- 6. no base at all still applies, and says so
  r := pg_temp.push(p_tenant,
        (select to_jsonb(s) || jsonb_build_object('roll_no','7')
           from public.sis_students s where s.id='stu_probe'), null);
  check_name := 'unversioned write applies and is counted';
  detail := jsonb_build_object('applied', r->'applied_students', 'unversioned', r->'unversioned');
  pass := (r->>'applied_students')::int = 1
      and (r->>'unversioned')::int = 1
      and (select roll_no from public.sis_students where id='stu_probe') = '7'; return next;

  -- 7. the same id twice in one payload: the last one wins
  r := public.sis_push_guarded(p_tenant, '[]'::jsonb, jsonb_build_array(
        jsonb_build_object('row', jsonb_build_object('id','stu_probe','notes','first'), 'base', null),
        jsonb_build_object('row', jsonb_build_object('id','stu_probe','notes','second'), 'base', null)));
  check_name := 'duplicate ids in one payload: last wins, once';
  detail := jsonb_build_object('applied', r->'applied_students',
    'notes', (select notes from public.sis_students where id='stu_probe'));
  pass := (r->>'applied_students')::int = 1
      and (select notes from public.sis_students where id='stu_probe') = 'second'; return next;

  -- 8. another tenant cannot overwrite this tenant's row
  r := pg_temp.push('00000000-0000-4000-8000-00000000fffe'::uuid,
        jsonb_build_object('id','stu_probe','full_name','Hijacked'), null);
  check_name := 'cross-tenant id collision does not overwrite';
  detail := jsonb_build_object('applied', r->'applied_students',
    'full_name', (select full_name from public.sis_students where id='stu_probe'),
    'tenant', (select tenant_id from public.sis_students where id='stu_probe'));
  pass := (select full_name from public.sis_students where id='stu_probe') = 'Probe Child Renamed'
      and (select tenant_id from public.sis_students where id='stu_probe') = p_tenant
      and (r->>'applied_students')::int = 0; return next;

  -- 9. household: the geocode and a separate WhatsApp number both survive
  r := public.sis_push_guarded(p_tenant,
    jsonb_build_array(jsonb_build_object('row', jsonb_build_object(
      'id','hh_probe','code','HH-PROBE','guardian_name','Probe Father',
      'mobile','9000000001','whatsapp_mobile','9000000003','alt_mobile','',
      'email','','address','Ayar','locality','','landmark','','city','Varanasi',
      'state','Uttar Pradesh','pincode','221204','preferred_language','hi',
      'channel_preference','','quiet_hours_start','','quiet_hours_end','',
      'geo_lat',25.2138,'geo_lng',82.9012,'geo_place_id','pl_probe',
      'geo_formatted_address','Ayar, Varanasi','geo_geocoded_at','2026-09-12',
      'geo_source','places','geo_confidence','high','geo_address_key','ayar|221204'),
      'base', null)), '[]'::jsonb);
  check_name := 'household: geocode stored, WhatsApp kept apart from mobile';
  detail := (select to_jsonb(h) - 'tenant_id' from public.sis_households h where h.id='hh_probe');
  pass := (r->>'applied_households')::int = 1
      and (select geo_lat from public.sis_households where id='hh_probe') = 25.2138
      and (select geo_source from public.sis_households where id='hh_probe') = 'places'
      and (select whatsapp_mobile from public.sis_households where id='hh_probe') = '9000000003'
      and (select mobile from public.sis_households where id='hh_probe') = '9000000001'
      and (select preferred_language from public.sis_households where id='hh_probe') = 'hi'; return next;

  -- 10. an explicit blank clears; an absent key does not
  r := public.sis_push_guarded(p_tenant,
    jsonb_build_array(jsonb_build_object(
      'row', jsonb_build_object('id','hh_probe','pincode',''),
      'base', (select updated_at from public.sis_households where id='hh_probe'))), '[]'::jsonb);
  check_name := 'explicit "" clears, absent key keeps the pin';
  detail := jsonb_build_object(
    'pincode', (select pincode from public.sis_households where id='hh_probe'),
    'geo_lat', (select geo_lat from public.sis_households where id='hh_probe'),
    'city', (select city from public.sis_households where id='hh_probe'));
  pass := (select pincode from public.sis_households where id='hh_probe') = ''
      and (select geo_lat from public.sis_households where id='hh_probe') = 25.2138
      and (select city from public.sis_households where id='hh_probe') = 'Varanasi'; return next;

  -- 11. a sparse INSERT takes the column defaults instead of failing
  r := pg_temp.push(p_tenant,
        jsonb_build_object('id','stu_probe_sparse','full_name','Sparse Child','class_id','c1'),
        null);
  select to_jsonb(s) into row_ from public.sis_students s where s.id='stu_probe_sparse';
  check_name := 'sparse insert: defaults, not a not-null violation';
  detail := jsonb_build_object('docs', row_->'docs', 'profile', row_->'profile',
    'nationality', row_->>'nationality', 'status', row_->>'status');
  pass := (r->>'applied_students')::int = 1
      and row_->'docs' = '{}'::jsonb and row_->'profile' = '{}'::jsonb
      and row_->>'nationality' = 'Indian' and row_->>'status' = 'active'
      and row_->>'dob' is null; return next;

  -- 12. nothing was done to anybody else's rows
  check_name := 'touched only its own probe rows';
  detail := jsonb_build_object('students', (select count(*) from public.sis_students),
    'households', (select count(*) from public.sis_households),
    'expected_students', n_stu + 2, 'expected_households', n_hh + 1);
  pass := (select count(*) from public.sis_students) = n_stu + 2
      and (select count(*) from public.sis_households) = n_hh + 1
      and (select count(*) from public.sis_students
            where tenant_id <> p_tenant and updated_at > now() - interval '1 minute') = 0; return next;
end $$;

select check_name, pass, detail from pg_temp.run('00000000-0000-4000-8000-00000000ffff'::uuid);

-- Every row above must report pass = true. Nothing is kept either way.
rollback;
