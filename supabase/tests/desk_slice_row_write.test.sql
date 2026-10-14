-- Behavioural test for desk_slice_row_write and desk_slice_object_write
-- (20261014220000_data_layer_write_kernel, data-layer step 1.5).
--
-- Runs in CI against the E2E stack (every migration on Postgres 17):
--   bash scripts/e2e-stack.sh sql-test supabase/tests/desk_slice_row_write.test.sql
-- It makes its own probe school, works inside one transaction and rolls it
-- back — nothing it does survives. Any failed check raises, and psql
-- (ON_ERROR_STOP) exits non-zero. Never point it at production.

\set ON_ERROR_STOP 1
begin;

create or replace function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if;
  raise notice 'ok  %', what;
end $$;

create or replace function pg_temp.row_state(p_tenant uuid, p_table text, p_slice text, p_op text, p_id text,
  p_row jsonb, p_base text, p_key text default 'id') returns text language plpgsql as $$
declare v text;
begin
  perform public.desk_slice_row_write(p_tenant, p_table, p_slice, p_op, p_id, p_row, p_base, p_key);
  return 'ok';
exception when others then
  get stacked diagnostics v = returned_sqlstate;
  return v;
end $$;

create or replace function pg_temp.obj_state(p_tenant uuid, p_table text, p_slice text, p_value jsonb, p_base text)
returns text language plpgsql as $$
declare v text;
begin
  perform public.desk_slice_object_write(p_tenant, p_table, p_slice, p_value, p_base);
  return 'ok';
exception when others then
  get stacked diagnostics v = returned_sqlstate;
  return v;
end $$;

do $test$
declare
  t uuid := gen_random_uuid();
  r jsonb; s1 text; s2 text; s3 text; m1 timestamptz; m2 timestamptz; v1 timestamptz;
  subj jsonb;
begin
  insert into public.tenants (id, slug, name) values (t, 'slice-probe-' || left(t::text, 8), 'Slice probe');
  insert into public.masters_desk_slices (tenant_id, slice_key, payload, updated_at) values
    (t, 'classes', '[{"id":"c5","name":"Class 5","isActive":true,"sortOrder":5}]', now() - interval '1 hour'),
    (t, 'subjects', '[{"id":"s_eng","code":"ENG","nameEn":"English","isActive":true,"sortOrder":1},
                      {"id":"s_hin","code":"HIN","nameEn":"Hindi","isActive":true,"sortOrder":2}]', now() - interval '1 hour'),
    (t, 'classSubjects', '[{"id":"cs_eng","classId":"c5","subjectId":"s_eng","isActive":true,"isOptional":false}]', now() - interval '1 hour'),
    (t, 'schoolProfile', '{"name":"Probe School"}', now() - interval '1 hour');
  insert into public.masters_desk_sync_meta (tenant_id, updated_at, last_updated_at) values (t, now() - interval '1 hour', now() - interval '1 hour');
  perform public.masters_sync_rows_from_slices(t);
  select updated_at::text into s1 from public.masters_desk_slices where tenant_id = t and slice_key = 'subjects';
  select updated_at into m1 from public.masters_desk_sync_meta where tenant_id = t;
  v1 := (public.erp_versions(t)->'masters'->>'updated_at')::timestamptz;

  -- ── Refusals before anything is read ────────────────────────────────────
  perform pg_temp.check(pg_temp.row_state(t, 'sis_students', 'x', 'upsert', 'a', '{}', null) = '42501', 'a non-slice table is refused');
  perform pg_temp.check(pg_temp.row_state(t, 'profiles', 'x', 'upsert', 'a', '{}', null) = '42501', 'profiles is refused');
  perform pg_temp.check(pg_temp.row_state(t, 'masters_desk_slices', 'staff', 'upsert', 'a', '{}', s1) = '42501',
    'staff-owned Masters lists are refused');
  perform pg_temp.check(pg_temp.row_state(t, 'masters_desk_slices', 'subjects', 'upsert', '', '{}', s1) = '22023',
    'an element without an id is refused');
  perform pg_temp.check(pg_temp.row_state(t, 'masters_desk_slices', 'schoolProfile', 'upsert', 'a', '{}', s1) = '22023',
    'an object slice is refused by the row writer');
  perform pg_temp.check(pg_temp.row_state(t, 'masters_desk_slices', 'subjects', 'upsert', 's_x', '{"id":"other"}', s1) = '22023',
    'a row whose id disagrees with the op is refused');

  -- ── Masters: base = the slice's updated_at ──────────────────────────────
  r := public.desk_slice_row_write(t, 'masters_desk_slices', 'subjects', 'upsert', 's_eng',
         '{"nameEn":"English Language"}', null);
  perform pg_temp.check(not (r->>'ok')::boolean and r->>'reason' = 'unversioned', 'masters: null base on an existing slice → unversioned');

  r := public.desk_slice_row_write(t, 'masters_desk_slices', 'subjects', 'upsert', 's_eng',
         '{"nameEn":"English Language"}', s1);
  perform pg_temp.check((r->>'ok')::boolean and r->>'status' = 'applied', 'masters: a write with the slice stamp is applied');
  s2 := r->>'revision';
  perform pg_temp.check(s2::timestamptz > s1::timestamptz
    and (select updated_at from public.masters_desk_slices where tenant_id=t and slice_key='subjects') = s2::timestamptz,
    'the slice has a new updated_at, returned as the new base');
  select e into subj from public.masters_desk_slices, jsonb_array_elements(payload) e
   where tenant_id = t and slice_key = 'subjects' and e->>'id' = 's_eng';
  perform pg_temp.check(subj->>'nameEn' = 'English Language' and subj->>'code' = 'ENG' and not (subj ? '_rev'),
    'one element patched (other keys kept), no _rev on a masters element');
  perform pg_temp.check((select jsonb_array_length(payload) from public.masters_desk_slices where tenant_id=t and slice_key='subjects') = 2
    and (select payload->1->>'id' from public.masters_desk_slices where tenant_id=t and slice_key='subjects') = 's_hin',
    'the other element is untouched and in place');
  select updated_at into m2 from public.masters_desk_sync_meta where tenant_id = t;
  perform pg_temp.check(m2 > m1 and (select subject_count = 2 and class_count = 1 from public.masters_desk_sync_meta where tenant_id = t),
    'masters_desk_sync_meta bumped with its counts');
  perform pg_temp.check((public.erp_versions(t)->'masters'->>'updated_at')::timestamptz > v1, 'erp_versions(masters) moved');
  perform pg_temp.check((select name_en from public.masters_desk_subjects where tenant_id=t and id='s_eng') = 'English Language',
    'masters row tables synced in the same call');

  -- Stale base: 409, nothing written.
  r := public.desk_slice_row_write(t, 'masters_desk_slices', 'subjects', 'upsert', 's_eng', '{"nameEn":"Old copy"}', s1);
  perform pg_temp.check(r->>'reason' = 'stale' and (r->>'revision')::timestamptz = s2::timestamptz
    and r->'stored'->>'nameEn' = 'English Language', 'masters: stale base → stale, with the current stamp and element');
  perform pg_temp.check((select updated_at from public.masters_desk_slices where tenant_id=t and slice_key='subjects') = s2::timestamptz
    and (select updated_at from public.masters_desk_sync_meta where tenant_id=t) = m2, 'a refusal writes and moves nothing');

  -- Identical content: unchanged, nothing moves.
  r := public.desk_slice_row_write(t, 'masters_desk_slices', 'subjects', 'upsert', 's_eng', '{"nameEn":"English Language"}', s2);
  perform pg_temp.check(r->>'status' = 'unchanged'
    and (select updated_at from public.masters_desk_slices where tenant_id=t and slice_key='subjects') = s2::timestamptz,
    'an identical write is unchanged');

  -- Insert and delete one element.
  r := public.desk_slice_row_write(t, 'masters_desk_slices', 'subjects', 'upsert', 's_cs',
         '{"code":"CS","nameEn":"Computer","isActive":true,"sortOrder":3}', s2);
  s3 := r->>'revision';
  perform pg_temp.check(r->>'status' = 'applied'
    and (select jsonb_array_length(payload) from public.masters_desk_slices where tenant_id=t and slice_key='subjects') = 3
    and exists (select 1 from public.masters_desk_subjects where tenant_id=t and id='s_cs')
    and (select subject_count from public.masters_desk_sync_meta where tenant_id=t) = 3, 'insert appends one element, rows + count follow');
  r := public.desk_slice_row_write(t, 'masters_desk_slices', 'subjects', 'delete', 's_cs', null, s3);
  perform pg_temp.check(r->>'status' = 'deleted'
    and not exists (select 1 from public.masters_desk_subjects where tenant_id=t and id='s_cs')
    and (select subject_count from public.masters_desk_sync_meta where tenant_id=t) = 2, 'delete removes one element, rows + count follow');
  r := public.desk_slice_row_write(t, 'masters_desk_slices', 'subjects', 'delete', 's_cs', null, null);
  perform pg_temp.check((r->>'ok')::boolean and (r->>'changed')::boolean = false, 'deleting an absent element is a no-op');

  -- classSubjects without isOptional: defaulted BEFORE the slice is written,
  -- so the slice and the row tables cannot diverge (step 1.1 finding).
  select updated_at::text into s1 from public.masters_desk_slices where tenant_id = t and slice_key = 'classSubjects';
  r := public.desk_slice_row_write(t, 'masters_desk_slices', 'classSubjects', 'upsert', 'cs_hin',
         '{"classId":"c5","subjectId":"s_hin","isActive":true}', s1);
  perform pg_temp.check(r->>'status' = 'applied' and r->'element'->'isOptional' = 'false'::jsonb
    and (select is_optional from public.masters_desk_class_subjects where tenant_id=t and id='cs_hin') = false,
    'a class link without isOptional is written with isOptional:false, rows synced');
  perform pg_temp.check(pg_temp.row_state(t, 'masters_desk_slices', 'classSubjects', 'upsert', 'cs_hin',
         '{"isOptional":"yes"}', r->>'revision') = '22023', 'a non-boolean isOptional is refused');

  -- Atomic with the row sync: if masters_sync_rows_from_slices refuses the
  -- slice, the slice write rolls back too.
  select updated_at::text into s1 from public.masters_desk_slices where tenant_id = t and slice_key = 'classes';
  perform pg_temp.check(pg_temp.row_state(t, 'masters_desk_slices', 'classes', 'upsert', 'c5', '{"sortOrder":"not-a-number"}', s1) <> 'ok',
    'a row the row tables cannot take raises');
  perform pg_temp.check((select payload->0->>'sortOrder' from public.masters_desk_slices where tenant_id=t and slice_key='classes') = '5'
    and (select updated_at from public.masters_desk_slices where tenant_id=t and slice_key='classes') = s1::timestamptz,
    '…and the slice was not written (one transaction)');

  -- A slice not created yet: null base inserts it; a base on it is refused.
  perform pg_temp.check(pg_temp.row_state(t, 'masters_desk_slices', 'holidays', 'upsert', 'h1', '{"name":"Diwali"}',
    '2026-01-01T00:00:00Z') = 'ok', 'call with a base on an absent slice returns (no raise)');
  perform pg_temp.check(not exists (select 1 from public.masters_desk_slices where tenant_id=t and slice_key='holidays'),
    '…and wrote nothing');
  r := public.desk_slice_row_write(t, 'masters_desk_slices', 'holidays', 'upsert', 'h1', '{"name":"Diwali","startsOn":"2026-11-08"}', null);
  perform pg_temp.check(r->>'status' = 'applied'
    and (select jsonb_array_length(payload) from public.masters_desk_slices where tenant_id=t and slice_key='holidays') = 1,
    'null base on an absent slice creates it with one element');

  -- ── _rev desks (staff_hr): base = the element's _rev ────────────────────
  insert into public.staff_hr_desk_slices (tenant_id, slice_key, payload) values
    (t, 'leaveRequests', '[{"id":"lr1","status":"pending","_rev":3},{"id":"lr2","status":"pending"}]'),
    (t, 'leaveTypes', '[{"code":"CL","name":"Casual"}]');
  r := public.desk_slice_row_write(t, 'staff_hr_desk_slices', 'leaveRequests', 'upsert', 'lr1', '{"status":"approved"}', null);
  perform pg_temp.check(r->>'reason' = 'unversioned' and (r->>'rev')::int = 3, 'rev desk: null base on an existing element → unversioned');
  r := public.desk_slice_row_write(t, 'staff_hr_desk_slices', 'leaveRequests', 'upsert', 'lr1', '{"status":"approved"}', '2');
  perform pg_temp.check(r->>'reason' = 'stale' and (r->>'rev')::int = 3, 'rev desk: stale _rev → stale');
  r := public.desk_slice_row_write(t, 'staff_hr_desk_slices', 'leaveRequests', 'upsert', 'lr1', '{"status":"approved","_rev":99}', '3');
  perform pg_temp.check(r->>'status' = 'applied' and (r->>'rev')::int = 4 and (r->'element'->>'_rev')::int = 4,
    'rev desk: current _rev → applied, _rev + 1 (a client _rev is ignored)');
  perform pg_temp.check((select (row_count) from public.staff_hr_desk_sync_meta where tenant_id = t) = 3,
    'staff_hr_desk_sync_meta row_count = every element of every list');
  r := public.desk_slice_row_write(t, 'staff_hr_desk_slices', 'leaveRequests', 'upsert', 'lr2', '{"status":"rejected"}', '0');
  perform pg_temp.check(r->>'status' = 'applied' and (r->>'rev')::int = 1, 'an element with no _rev is at 0; changed → 1');
  r := public.desk_slice_row_write(t, 'staff_hr_desk_slices', 'leaveRequests', 'upsert', 'lr3', '{"status":"pending"}', null);
  perform pg_temp.check(r->>'status' = 'applied' and (r->>'rev')::int = 1, 'a new element gets _rev 1');
  r := public.desk_slice_row_write(t, 'staff_hr_desk_slices', 'leaveRequests', 'upsert', 'lr9', '{"status":"pending"}', '2');
  perform pg_temp.check(r->>'reason' = 'deleted', 'a base on an absent element → deleted (never resurrected)');
  r := public.desk_slice_row_write(t, 'staff_hr_desk_slices', 'leaveRequests', 'upsert', 'lr1', '{"status":"approved"}', '4');
  perform pg_temp.check(r->>'status' = 'unchanged' and (r->>'rev')::int = 4, 'identical content keeps its _rev');
  perform pg_temp.check(pg_temp.row_state(t, 'staff_hr_desk_slices', 'leaveRequests', 'upsert', 'lr1', '{}', 'abc') = '22023',
    'a non-numeric _rev base is refused');
  -- Keyed by code (lib/deskSliceRegistry mergeKeys).
  r := public.desk_slice_row_write(t, 'staff_hr_desk_slices', 'leaveTypes', 'upsert', 'CL', '{"name":"Casual leave"}', '0', 'code');
  perform pg_temp.check(r->>'status' = 'applied' and r->'element'->>'code' = 'CL' and not (r->'element' ? 'id'),
    'a list keyed by code is written by code');

  -- ── Object slices ──────────────────────────────────────────────────────
  select updated_at::text into s1 from public.masters_desk_slices where tenant_id = t and slice_key = 'schoolProfile';
  perform pg_temp.check(pg_temp.obj_state(t, 'masters_desk_slices', 'subjects', '{"x":1}', s1) = '42501',
    'an array slice is refused by the object writer');
  perform pg_temp.check(pg_temp.obj_state(t, 'masters_desk_slices', 'schoolProfile', '[]', s1) = '22023', 'a list value is refused');
  perform pg_temp.check(pg_temp.obj_state(t, 'masters_desk_slices', 'schoolProfile', 'null', s1) = '22023', 'a null value is refused');
  r := public.desk_slice_object_write(t, 'masters_desk_slices', 'schoolProfile', '{"name":"Probe School 2"}', null);
  perform pg_temp.check(r->>'reason' = 'unversioned', 'object: null base on an existing slice → unversioned');
  r := public.desk_slice_object_write(t, 'masters_desk_slices', 'schoolProfile', '{"name":"Probe School 2"}', '2020-01-01T00:00:00Z');
  perform pg_temp.check(r->>'reason' = 'stale' and r->'stored'->>'name' = 'Probe School', 'object: stale base → stale');
  select updated_at into m1 from public.masters_desk_sync_meta where tenant_id = t;
  r := public.desk_slice_object_write(t, 'masters_desk_slices', 'schoolProfile', '{"name":"Probe School 2"}', s1);
  perform pg_temp.check(r->>'status' = 'applied'
    and (select payload->>'name' from public.masters_desk_slices where tenant_id=t and slice_key='schoolProfile') = 'Probe School 2'
    -- masters_desk_settings is keyed on id alone (one school in production), so on
    -- this shared stack the sync lands on the seeded school's row; rolled back below.
    and (select payload->>'name' from public.masters_desk_settings where id='schoolProfile') = 'Probe School 2'
    and (select updated_at from public.masters_desk_sync_meta where tenant_id=t) > m1,
    'object: applied, settings row synced, signal moved');
  r := public.desk_slice_object_write(t, 'masters_desk_slices', 'schoolProfile', '{"name":"Probe School 2"}', r->>'revision');
  perform pg_temp.check(r->>'status' = 'unchanged', 'object: identical value is unchanged');
  r := public.desk_slice_object_write(t, 'module_registry_desk_slices', 'enabled', '{"library":true}', null);
  perform pg_temp.check(r->>'status' = 'applied'
    and (select row_count from public.module_registry_desk_sync_meta where tenant_id=t) = 1,
    'object: a desk-slice module''s first object slice is created with a null base');
end
$test$;

rollback;
