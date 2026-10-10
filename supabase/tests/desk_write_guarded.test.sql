-- Behavioural test for desk_write_guarded (20260810010000).
--
-- This cannot live in scripts/verify.sh: the logic is plpgsql, so it needs a
-- real database. Run it against a Supabase project after applying the
-- migration, and read the `pass` column — every row must be true.
--
--   psql "$DATABASE_URL" -f supabase/tests/desk_write_guarded.test.sql
--
-- It is self-cleaning: it creates one probe household and one probe student,
-- exercises every verdict against them, deletes both, and asserts the table
-- counts it started with. Safe to run against production, but prefer a
-- branch or staging project once one exists.
--
-- Set the tenant before running if yours differs.
\set tenant '6558f3c4-6d12-4636-bf53-17423b0eaad3'

begin;

create or replace function pg_temp.hh_json() returns jsonb language sql as $$
  select jsonb_build_object(
    'id','hh_probe_keep','code','HHPROBE','guardian_name','Probe HH',
    'mobile','','whatsapp_mobile','','email','','address','','locality','',
    'landmark','','city','','state','','pincode','','alt_mobile','')
$$;

create or replace function pg_temp.stu_json(nm text) returns jsonb language sql as $$
  select jsonb_build_object(
    'id','stu_s1probe','full_name',nm,'status','inactive','class_id','cls_p7bw8cpc',
    'student_type','NEW','admission_no','S1PROBE','gender','male','campus_id','cmp_main',
    'section_id','sec_probe','roll_no','1','academic_year_code','2026-27',
    'father_name','','mother_name','','father_mobile','','mother_mobile','',
    'father_aadhaar_last4','','mother_aadhaar_last4','','father_pan','','mother_pan','',
    'guardian_relation','','emergency_name','','emergency_mobile','',
    'blood_group','','religion','','category','','nationality','','mother_tongue','',
    'place_of_birth','','aadhaar_last4','','pen','','pen_status','','apaar_id','','srn','',
    'previous_school','','previous_tc_no','','previous_udise','',
    'docs','{}'::jsonb,'notes','stage1 probe','photo_url','',
    'household_id','hh_probe_keep')
$$;

-- Attempting a write and reporting the refusal instead of aborting.
create or replace function pg_temp.try_write(p_tenant uuid, p_table text)
returns text language plpgsql as $$
declare v_state text;
begin
  perform public.desk_write_guarded(p_tenant, p_table,
    '[{"op":"delete","id":"nonexistent-probe"}]'::jsonb);
  return 'accepted';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate;
  return 'refused:' || v_state;
end $$;

create or replace function pg_temp.run(p_tenant uuid)
returns table(check_name text, pass boolean, detail jsonb)
language plpgsql as $$
declare
  r jsonb; rev1 text; rev2 text;
  n_stu int; n_hh int;
begin
  select count(*) into n_stu from public.sis_students;
  select count(*) into n_hh  from public.sis_households;

  -- ── Allowlist: the table name comes from the request ─────────────────
  -- SECURITY INVOKER still runs as service_role, which can write anything.
  -- Without the allowlist this reaches profiles / api_keys directly.
  check_name := 'profiles is refused';
  detail := to_jsonb(pg_temp.try_write(p_tenant, 'profiles'));
  pass := detail #>> '{}' = 'refused:42501'; return next;

  check_name := 'api_keys is refused';
  detail := to_jsonb(pg_temp.try_write(p_tenant, 'api_keys'));
  pass := detail #>> '{}' = 'refused:42501'; return next;

  check_name := 'injected table name is refused';
  detail := to_jsonb(pg_temp.try_write(p_tenant, 'sis_students; drop table sis_students--'));
  pass := detail #>> '{}' = 'refused:42501'; return next;

  -- ── Lifecycle ────────────────────────────────────────────────────────
  perform public.desk_write_guarded(p_tenant,'sis_students',
    jsonb_build_array(jsonb_build_object('op','delete','id','stu_s1probe')));
  perform public.desk_write_guarded(p_tenant,'sis_households',
    jsonb_build_array(jsonb_build_object('op','delete','id','hh_probe_keep')));

  r := public.desk_write_guarded(p_tenant,'sis_households',
        jsonb_build_array(jsonb_build_object('op','upsert','id','hh_probe_keep','row',pg_temp.hh_json())));
  check_name := 'insert household'; detail := r->'results'->0;
  pass := r->'results'->0->>'status' = 'applied'; return next;

  r := public.desk_write_guarded(p_tenant,'sis_students',
        jsonb_build_array(jsonb_build_object('op','upsert','id','stu_s1probe','row',pg_temp.stu_json('Probe A'))));
  rev1 := r->'versions'->>'stu_s1probe';
  check_name := 'insert student'; detail := r->'results'->0;
  pass := r->'results'->0->>'status' = 'applied'; return next;

  -- An identical row must keep its revision. Without this, a routine push
  -- bumps every row and invalidates every other client's token — the exact
  -- failure 20260808150000 was written to undo.
  r := public.desk_write_guarded(p_tenant,'sis_students',
        jsonb_build_array(jsonb_build_object('op','upsert','id','stu_s1probe','base',rev1,'row',pg_temp.stu_json('Probe A'))));
  check_name := 'identical row -> unchanged, revision held';
  detail := jsonb_build_object('status',r->'results'->0->>'status','held',(r->'versions'->>'stu_s1probe')=rev1);
  pass := r->'results'->0->>'status' = 'unchanged' and (r->'versions'->>'stu_s1probe') = rev1; return next;

  r := public.desk_write_guarded(p_tenant,'sis_students',
        jsonb_build_array(jsonb_build_object('op','upsert','id','stu_s1probe','base','2020-01-01T00:00:00Z','row',pg_temp.stu_json('HIJACK'))));
  check_name := 'stale base -> conflict, nothing written';
  detail := jsonb_build_object('status',r->'results'->0->>'status',
    'stored_returned',(r->'results'->0->'stored') is not null,
    'db',(select full_name from public.sis_students where id='stu_s1probe'));
  pass := r->'results'->0->>'status' = 'conflict'
      and (r->'results'->0->'stored') is not null
      and (select full_name from public.sis_students where id='stu_s1probe') = 'Probe A'; return next;

  -- A payload carrying only the changed field must not erase the rest.
  -- jsonb_populate_record fills absent columns with NULL, so without the
  -- patch merge this silently wipes household_id, admission_no and more.
  r := public.desk_write_guarded(p_tenant,'sis_students',
        jsonb_build_array(jsonb_build_object('op','upsert','id','stu_s1probe','base',rev1,
          'row',jsonb_build_object('full_name','Probe B'))));
  rev2 := r->'versions'->>'stu_s1probe';
  check_name := 'partial payload patches, does not erase';
  detail := jsonb_build_object(
    'name',(select full_name from public.sis_students where id='stu_s1probe'),
    'household_id',(select household_id from public.sis_students where id='stu_s1probe'),
    'admission_no',(select admission_no from public.sis_students where id='stu_s1probe'));
  pass := (select full_name    from public.sis_students where id='stu_s1probe') = 'Probe B'
      and (select household_id from public.sis_students where id='stu_s1probe') = 'hh_probe_keep'
      and (select admission_no from public.sis_students where id='stu_s1probe') = 'S1PROBE'; return next;

  r := public.desk_write_guarded(p_tenant,'sis_students',
        jsonb_build_array(jsonb_build_object('op','delete','id','stu_s1probe','base',rev1)));
  check_name := 'delete with stale base -> refused, row survives';
  detail := jsonb_build_object('status',r->'results'->0->>'status',
    'rows',(select count(*) from public.sis_students where id='stu_s1probe'));
  pass := r->'results'->0->>'status' = 'conflict'
      and (select count(*) from public.sis_students where id='stu_s1probe') = 1; return next;

  r := public.desk_write_guarded(p_tenant,'sis_students',
        jsonb_build_array(jsonb_build_object('op','delete','id','stu_s1probe','base',rev2)));
  check_name := 'delete with correct base -> gone';
  detail := jsonb_build_object('status',r->'results'->0->>'status',
    'rows',(select count(*) from public.sis_students where id='stu_s1probe'));
  pass := (select count(*) from public.sis_students where id='stu_s1probe') = 0; return next;

  -- A retried delete must not be an error, or a client that loses the
  -- response can never finish.
  r := public.desk_write_guarded(p_tenant,'sis_students',
        jsonb_build_array(jsonb_build_object('op','delete','id','stu_s1probe','base',rev2)));
  check_name := 'delete is idempotent'; detail := r->'results'->0;
  pass := (r->>'ok')::boolean and r->'results'->0->>'status' = 'deleted'; return next;

  perform public.desk_write_guarded(p_tenant,'sis_households',
    jsonb_build_array(jsonb_build_object('op','delete','id','hh_probe_keep')));

  check_name := 'left nothing behind';
  detail := jsonb_build_object(
    'students',(select count(*) from public.sis_students),
    'households',(select count(*) from public.sis_households));
  pass := (select count(*) from public.sis_students) = n_stu
      and (select count(*) from public.sis_households) = n_hh; return next;
end $$;

select check_name, pass, detail from pg_temp.run(:'tenant'::uuid);

-- Every row above must report pass = true.
commit;
