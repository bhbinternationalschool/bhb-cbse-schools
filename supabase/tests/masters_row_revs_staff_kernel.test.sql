-- Behavioural test for data-layer step 2.2a
-- (20261021090000_data_layer_masters_row_revs_staff_kernel):
--   A. Masters elements: _rev compare-and-set on ONE element
--   B. the ABA guard — no writer can reset an element's _rev
--   C. desk_slice_rows_write — all or none
--   D. masters_series_bump — monotone, no base
--   E. staff soft remove + restore through the kernel
--   F. sensitive staff fields refused without sis_staff_write_sensitive
--
-- Runs in CI against the E2E stack (every migration on Postgres 17):
--   bash scripts/e2e-stack.sh sql-test supabase/tests/masters_row_revs_staff_kernel.test.sql
-- Each section makes its own probe school; everything runs in one transaction
-- that is rolled back — nothing survives. Any failed check raises, and psql
-- (ON_ERROR_STOP) exits non-zero. Never point it at production.
--
-- Each `-- @section` block is self-contained (after the helpers above the
-- first one), so a section can be run alone — that is how each was shown to
-- fail on the schema before this migration.

\set ON_ERROR_STOP 1
begin;

create or replace function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if;
  raise notice 'ok  %', what;
end $$;

-- The SQLSTATE a call raises ('ok' when it returns).
create or replace function pg_temp.state_of(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v = returned_sqlstate;
  return v;
end $$;

create or replace function pg_temp.el(p_tenant uuid, p_slice text, p_id text) returns jsonb language sql as $$
  select e from public.masters_desk_slices s, jsonb_array_elements(s.payload) e
   where s.tenant_id = p_tenant and s.slice_key = p_slice and e->>'id' = p_id
$$;

create or replace function pg_temp.new_school(p_name text) returns uuid language plpgsql as $$
declare t uuid := gen_random_uuid();
begin
  insert into public.tenants (id, slug, name) values (t, p_name || '-' || left(t::text, 8), p_name);
  return t;
end $$;

-- @section A: _rev compare-and-set on one Masters element
do $test$
declare
  t uuid := pg_temp.new_school('revs-cas');
  r jsonb; ra jsonb; rb jsonb; s1 text; m1 timestamptz;
begin
  insert into public.masters_desk_slices (tenant_id, slice_key, payload, updated_at) values
    (t, 'subjects', '[{"id":"s_eng","code":"ENG","nameEn":"English","isActive":true,"sortOrder":1},
                      {"id":"s_hin","code":"HIN","nameEn":"Hindi","isActive":true,"sortOrder":2}]', now() - interval '1 hour');
  insert into public.masters_desk_sync_meta (tenant_id, updated_at, last_updated_at) values (t, now() - interval '1 hour', now() - interval '1 hour');
  perform public.masters_sync_rows_from_slices(t);
  perform pg_temp.check((pg_temp.el(t,'subjects','s_eng')->>'_rev')::int = 1 and (pg_temp.el(t,'subjects','s_hin')->>'_rev')::int = 1,
    'A: a new Masters slice row gives every element _rev 1');

  -- Two people load the subjects (both at _rev 1) and edit DIFFERENT subjects.
  ra := public.desk_slice_row_write(t, 'masters_desk_slices', 'subjects', 'upsert', 's_eng', '{"nameEn":"English Language"}', '1');
  rb := public.desk_slice_row_write(t, 'masters_desk_slices', 'subjects', 'upsert', 's_hin', '{"nameEn":"Hindi (second language)"}', '1');
  perform pg_temp.check(ra->>'status' = 'applied' and (ra->>'rev')::int = 2, 'A: the first edit lands (_rev 1 → 2)');
  perform pg_temp.check(rb->>'status' = 'applied' and (rb->>'rev')::int = 2,
    'A: a second person editing a DIFFERENT element of the same list also lands');
  perform pg_temp.check(pg_temp.el(t,'subjects','s_eng')->>'nameEn' = 'English Language'
    and pg_temp.el(t,'subjects','s_hin')->>'nameEn' = 'Hindi (second language)', 'A: both edits are in the slice');
  perform pg_temp.check((select name_en from public.masters_desk_subjects where tenant_id=t and id='s_hin') = 'Hindi (second language)',
    'A: row tables synced');

  -- A third person, still on _rev 1 of English, saves English: refused.
  select updated_at into m1 from public.masters_desk_sync_meta where tenant_id = t;
  select updated_at::text into s1 from public.masters_desk_slices where tenant_id = t and slice_key = 'subjects';
  r := public.desk_slice_row_write(t, 'masters_desk_slices', 'subjects', 'upsert', 's_eng', '{"nameEn":"ENGLISH"}', '1');
  perform pg_temp.check(r->>'reason' = 'stale' and (r->>'rev')::int = 2 and r->'stored'->>'nameEn' = 'English Language',
    'A: the SAME element edited from an older _rev → stale, with the current element and _rev');
  perform pg_temp.check(pg_temp.el(t,'subjects','s_eng')->>'nameEn' = 'English Language'
    and (select updated_at::text from public.masters_desk_slices where tenant_id=t and slice_key='subjects') = s1
    and (select updated_at from public.masters_desk_sync_meta where tenant_id=t) = m1, 'A: the refusal wrote and moved nothing');

  r := public.desk_slice_row_write(t, 'masters_desk_slices', 'subjects', 'upsert', 's_eng', '{"nameEn":"ENGLISH"}', null);
  perform pg_temp.check(r->>'reason' = 'unversioned', 'A: a null base on an existing element → unversioned');
  r := public.desk_slice_row_write(t, 'masters_desk_slices', 'subjects', 'upsert', 's_new', '{"code":"SKT","nameEn":"Sanskrit","isActive":true,"sortOrder":3}', null);
  perform pg_temp.check(r->>'status' = 'applied' and (r->>'rev')::int = 1, 'A: a new element with no base is inserted at _rev 1');
  r := public.desk_slice_row_write(t, 'masters_desk_slices', 'subjects', 'delete', 's_new', null, '0');
  perform pg_temp.check(r->>'reason' = 'stale', 'A: a delete from an older _rev → stale');
  r := public.desk_slice_row_write(t, 'masters_desk_slices', 'subjects', 'delete', 's_new', null, '1');
  perform pg_temp.check(r->>'status' = 'deleted' and pg_temp.el(t,'subjects','s_new') is null
    and not exists (select 1 from public.masters_desk_subjects where tenant_id=t and id='s_new'), 'A: a delete at the current _rev removes it');

  -- Until 2.2b the registry still sends the slice stamp: accepted, and _rev moves.
  select updated_at::text into s1 from public.masters_desk_slices where tenant_id = t and slice_key = 'subjects';
  r := public.desk_slice_row_write(t, 'masters_desk_slices', 'subjects', 'upsert', 's_hin', '{"sortOrder":5}', s1);
  perform pg_temp.check(r->>'status' = 'applied' and (r->>'rev')::int = 3 and (pg_temp.el(t,'subjects','s_hin')->>'_rev')::int = 3,
    'A: the slice-stamp base (today''s registry) still works and moves the element''s _rev');

  -- masters_sync_rows_from_slices ignores _rev: no row table has such a column.
  perform pg_temp.check(not exists (select 1 from information_schema.columns
     where table_schema='public' and table_name like 'masters\_desk\_%' escape '\' and column_name in ('_rev','rev')),
    'A: no masters_desk_* table has a _rev column, so the row sync never copies it');
end
$test$;

-- @section B: the ABA guard — the old whole-slice paths carry _rev through
do $test$
declare
  t uuid := pg_temp.new_school('revs-aba');
  r jsonb; s1 text; s2 text;
begin
  insert into public.masters_desk_slices (tenant_id, slice_key, payload, updated_at) values
    (t, 'sections', '[{"id":"sec_a","classId":"c5","name":"A","isActive":true},
                      {"id":"sec_b","classId":"c5","name":"B","isActive":true}]', now() - interval '1 hour');
  insert into public.masters_desk_sync_meta (tenant_id, updated_at, last_updated_at) values (t, now() - interval '1 hour', now() - interval '1 hour');
  -- Two kernel edits: sec_a is at _rev 3.
  r := public.desk_slice_row_write(t, 'masters_desk_slices', 'sections', 'upsert', 'sec_a', '{"name":"A1"}', '1');
  r := public.desk_slice_row_write(t, 'masters_desk_slices', 'sections', 'upsert', 'sec_a', '{"name":"A2"}', '2');
  perform pg_temp.check((pg_temp.el(t,'sections','sec_a')->>'_rev')::int = 3, 'B: sec_a is at _rev 3');

  -- An old browser saves the section list through masters_write_slices
  -- (pushMastersSlicesToDb) from its copy: no _rev on any element, sec_a's
  -- name back to "A" (its old copy), sec_b unchanged, one new section.
  select updated_at::text into s1 from public.masters_desk_slices where tenant_id = t and slice_key = 'sections';
  r := public.masters_write_slices(t, jsonb_build_array(jsonb_build_object('key','sections','base',s1,'payload',
         '[{"id":"sec_a","classId":"c5","name":"A","isActive":true},
           {"id":"sec_b","classId":"c5","name":"B","isActive":true},
           {"id":"sec_c","classId":"c5","name":"C","isActive":true}]'::jsonb)), clock_timestamp());
  perform pg_temp.check((r->>'ok')::boolean, 'B: the old whole-slice save is accepted (its slice stamp matched)');
  perform pg_temp.check((pg_temp.el(t,'sections','sec_a')->>'_rev')::int = 4,
    'B: a changed element written without _rev gets the STORED _rev + 1 (3 → 4), never reset');
  perform pg_temp.check((pg_temp.el(t,'sections','sec_b')->>'_rev')::int = 1,
    'B: an unchanged element keeps its stored _rev');
  perform pg_temp.check((pg_temp.el(t,'sections','sec_c')->>'_rev')::int = 1, 'B: a new element starts at _rev 1');

  -- The client that loaded sec_a at _rev 1 (before both kernel edits) cannot
  -- now write it: had the old path reset _rev to 0/1, this would land (ABA).
  r := public.desk_slice_row_write(t, 'masters_desk_slices', 'sections', 'upsert', 'sec_a', '{"name":"from a very old copy"}', '1');
  perform pg_temp.check(r->>'reason' = 'stale', 'B: a copy from _rev 1 is still refused after the old path wrote');
  r := public.desk_slice_row_write(t, 'masters_desk_slices', 'sections', 'upsert', 'sec_a', '{"name":"from a very old copy"}', '0');
  perform pg_temp.check(r->>'reason' = 'stale', 'B: … and from _rev 0');

  -- The whole-book path (pushMastersDeskToDb) upserts slice rows directly; a
  -- forged _rev is ignored either way.
  insert into public.masters_desk_slices as m (tenant_id, slice_key, payload, updated_at)
  values (t, 'sections', '[{"id":"sec_a","classId":"c5","name":"A9","isActive":true,"_rev":0},
                           {"id":"sec_b","classId":"c5","name":"B","isActive":true,"_rev":99},
                           {"id":"sec_c","classId":"c5","name":"C","isActive":true}]', clock_timestamp())
  on conflict (tenant_id, slice_key) do update set payload = excluded.payload, updated_at = excluded.updated_at;
  perform pg_temp.check((pg_temp.el(t,'sections','sec_a')->>'_rev')::int = 5 and pg_temp.el(t,'sections','sec_a')->>'name' = 'A9',
    'B: a direct upsert with a forged _rev 0 on a changed element → stored _rev + 1 (4 → 5)');
  perform pg_temp.check((pg_temp.el(t,'sections','sec_b')->>'_rev')::int = 1,
    'B: a forged _rev 99 on an unchanged element is ignored (stays 1)');
  r := public.desk_slice_row_write(t, 'masters_desk_slices', 'sections', 'upsert', 'sec_a', '{"name":"A10"}', '5');
  perform pg_temp.check(r->>'status' = 'applied' and (r->>'rev')::int = 6, 'B: the kernel continues from the carried _rev');
end
$test$;

-- @section C: desk_slice_rows_write — all or none
do $test$
declare
  t uuid := pg_temp.new_school('revs-batch');
  r jsonb; s1 text; m1 timestamptz; p1 jsonb; st text;
begin
  insert into public.masters_desk_slices (tenant_id, slice_key, payload, updated_at) values
    (t, 'feeGroups', '[{"id":"fg_1","name":"Day scholar","isActive":true}]', now() - interval '1 hour'),
    (t, 'feeStructureLines', '[{"id":"fl_1","feeGroupId":"fg_1","feeHeadId":"fh_t","classId":"c5","amount":1000,"academicYearCode":"2026-27"}]',
     now() - interval '1 hour');
  insert into public.masters_desk_sync_meta (tenant_id, updated_at, last_updated_at) values (t, now() - interval '1 hour', now() - interval '1 hour');
  perform public.masters_sync_rows_from_slices(t);
  -- Someone else edits fl_1 after the cloner loaded it: fl_1 is now at _rev 2.
  r := public.desk_slice_row_write(t, 'masters_desk_slices', 'feeStructureLines', 'upsert', 'fl_1', '{"amount":1100}', '1');
  select payload into p1 from public.masters_desk_slices where tenant_id = t and slice_key = 'feeStructureLines';
  select updated_at::text into s1 from public.masters_desk_slices where tenant_id = t and slice_key = 'feeStructureLines';
  select updated_at into m1 from public.masters_desk_sync_meta where tenant_id = t;

  -- The clone: a new group, two new lines, and fl_1 from the stale _rev 1.
  r := public.desk_slice_rows_write(t, 'masters_desk_slices', '[
    {"slice":"feeGroups","op":"upsert","id":"fg_2","row":{"name":"Hosteller","isActive":true},"base":null},
    {"slice":"feeStructureLines","op":"upsert","id":"fl_2","row":{"feeGroupId":"fg_2","feeHeadId":"fh_t","classId":"c5","amount":2000,"academicYearCode":"2026-27"},"base":"0"},
    {"slice":"feeStructureLines","op":"upsert","id":"fl_3","row":{"feeGroupId":"fg_2","feeHeadId":"fh_h","classId":"c5","amount":500,"academicYearCode":"2026-27"},"base":"0"},
    {"slice":"feeStructureLines","op":"upsert","id":"fl_1","row":{"amount":1200},"base":"1"}]');
  perform pg_temp.check(not (r->>'ok')::boolean and (r->>'conflicts')::int = 1
    and (select count(*) from jsonb_array_elements(r->'results') x where x->>'id' = 'fl_1' and x->>'reason' = 'stale') = 1,
    'C: one stale element → the batch is refused, the stale one named');
  perform pg_temp.check(pg_temp.el(t,'feeGroups','fg_2') is null and pg_temp.el(t,'feeStructureLines','fl_2') is null
    and (select payload from public.masters_desk_slices where tenant_id=t and slice_key='feeStructureLines') = p1
    and (select updated_at::text from public.masters_desk_slices where tenant_id=t and slice_key='feeStructureLines') = s1
    and (select updated_at from public.masters_desk_sync_meta where tenant_id=t) = m1
    and not exists (select 1 from public.masters_desk_fee_groups where tenant_id=t and id='fg_2')
    and not exists (select 1 from public.masters_desk_fee_structure_lines where tenant_id=t and id='fl_2'),
    'C: … and NOTHING of it was written: no new group, no new line, same slice, same stamp, same signal, same rows');

  -- One malformed element (its row''s id disagrees with the op): an error, nothing written.
  st := pg_temp.state_of(format($q$select public.desk_slice_rows_write(%L, 'masters_desk_slices', '[
    {"slice":"feeGroups","op":"upsert","id":"fg_2","row":{"name":"Hosteller"},"base":null},
    {"slice":"feeStructureLines","op":"upsert","id":"fl_2","row":{"id":"other","amount":1},"base":"0"}]')$q$, t));
  perform pg_temp.check(st = '22023' and pg_temp.el(t,'feeGroups','fg_2') is null, 'C: one bad element → 22023 and nothing written');
  perform pg_temp.check(pg_temp.state_of(format($q$select public.desk_slice_rows_write(%L, 'masters_desk_slices',
    '[{"slice":"feeGroups","id":"fg_2","row":{}},{"slice":"feeGroups","id":"fg_2","row":{}}]')$q$, t)) = '22023',
    'C: the same element twice in one batch is refused');
  perform pg_temp.check(pg_temp.state_of(format($q$select public.desk_slice_rows_write(%L, 'masters_desk_slices',
    '[{"slice":"feeGroups","id":"fg_2","row":{},"base":"2026-10-21T00:00:00Z"}]')$q$, t)) = '22023',
    'C: a slice-stamp base is refused in a batch (bases are element _revs)');
  perform pg_temp.check(pg_temp.state_of(format($q$select public.desk_slice_rows_write(%L, 'timetable_desk_slices',
    '[{"slice":"grids","id":"g1","row":{}}]')$q$, t)) = '22023', 'C: timetable (no _rev) is refused');
  perform pg_temp.check(pg_temp.state_of(format($q$select public.desk_slice_rows_write(%L, 'masters_desk_slices', '[]')$q$, t)) = '22023',
    'C: an empty batch is refused');
  perform pg_temp.check(pg_temp.state_of(format($q$select public.desk_slice_rows_write(%L, 'masters_desk_slices',
    '[{"slice":"staff","id":"x","row":{}}]')$q$, t)) = '42501', 'C: staff-owned Masters lists are refused here too');

  -- The same clone from the current _rev: every element lands, one signal bump.
  r := public.desk_slice_rows_write(t, 'masters_desk_slices', '[
    {"slice":"feeGroups","op":"upsert","id":"fg_2","row":{"name":"Hosteller","isActive":true},"base":null},
    {"slice":"feeStructureLines","op":"upsert","id":"fl_2","row":{"feeGroupId":"fg_2","feeHeadId":"fh_t","classId":"c5","amount":2000,"academicYearCode":"2026-27"},"base":"0"},
    {"slice":"feeStructureLines","op":"upsert","id":"fl_3","row":{"feeGroupId":"fg_2","feeHeadId":"fh_h","classId":"c5","amount":500,"academicYearCode":"2026-27"},"base":"0"},
    {"slice":"feeStructureLines","op":"upsert","id":"fl_1","row":{"amount":1200},"base":"2"}]');
  perform pg_temp.check((r->>'ok')::boolean and (r->>'applied')::int = 4, 'C: from the current _revs the whole batch lands');
  perform pg_temp.check((pg_temp.el(t,'feeStructureLines','fl_1')->>'amount')::int = 1200
    and (pg_temp.el(t,'feeStructureLines','fl_1')->>'_rev')::int = 3
    and (pg_temp.el(t,'feeStructureLines','fl_2')->>'_rev')::int = 1
    and pg_temp.el(t,'feeGroups','fg_2')->>'name' = 'Hosteller', 'C: each element has its value and _rev');
  perform pg_temp.check((select updated_at from public.masters_desk_sync_meta where tenant_id=t) > m1
    and (select count(*) from public.masters_desk_fee_structure_lines where tenant_id=t) = 3
    and exists (select 1 from public.masters_desk_fee_groups where tenant_id=t and id='fg_2'),
    'C: the signal moved and the row tables follow');
  r := public.desk_slice_rows_write(t, 'masters_desk_slices',
    '[{"slice":"feeGroups","op":"upsert","id":"fg_2","row":{"name":"Hosteller"},"base":"1"}]');
  perform pg_temp.check((r->>'ok')::boolean and r->>'status' = 'unchanged' and (r->>'unchanged')::int = 1,
    'C: an identical batch is unchanged');
end
$test$;

-- @section D: masters_series_bump — monotone, no base
do $test$
declare
  t uuid := pg_temp.new_school('revs-series');
  r jsonb; m1 timestamptz;
begin
  insert into public.masters_desk_slices (tenant_id, slice_key, payload, updated_at) values
    (t, 'numberSeries', '[{"id":"ns_adm","code":"ADMISSION","prefix":"ADM-","nextNumber":10,"padWidth":4,"resetOnAy":false,"includeSessionInPrefix":false},
                          {"id":"ns_rc","code":"RECEIPT","prefix":"RC/","nextNumber":1,"padWidth":5,"resetOnAy":true,"includeSessionInPrefix":true,
                           "countersByAy":{"2026-27":5}}]', now() - interval '1 hour');
  insert into public.masters_desk_sync_meta (tenant_id, updated_at, last_updated_at) values (t, now() - interval '1 hour', now() - interval '1 hour');

  r := public.masters_series_bump(t, 'ADMISSION', 12);
  perform pg_temp.check(r->>'status' = 'applied' and (r->>'next')::int = 13
    and (pg_temp.el(t,'numberSeries','ns_adm')->>'nextNumber')::int = 13 and (pg_temp.el(t,'numberSeries','ns_adm')->>'_rev')::int = 2,
    'D: used 12 → next 13 (no base needed), _rev moved');
  select updated_at into m1 from public.masters_desk_sync_meta where tenant_id = t;
  -- A slower counter reports an older number: the series never goes back.
  r := public.masters_series_bump(t, 'ADMISSION', 11);
  perform pg_temp.check(r->>'status' = 'unchanged' and (r->>'next')::int = 13
    and (pg_temp.el(t,'numberSeries','ns_adm')->>'nextNumber')::int = 13
    and (select updated_at from public.masters_desk_sync_meta where tenant_id=t) = m1,
    'D: an older used number changes nothing and moves nothing (monotone)');
  r := public.masters_series_bump(t, 'ns_adm', 13);
  perform pg_temp.check((r->>'next')::int = 14 and (select updated_at from public.masters_desk_sync_meta where tenant_id=t) > m1,
    'D: by id too; the signal moves');
  -- Per academic year.
  r := public.masters_series_bump(t, 'RECEIPT', 7, '2026-27');
  perform pg_temp.check((pg_temp.el(t,'numberSeries','ns_rc')->'countersByAy'->>'2026-27')::int = 8
    and (pg_temp.el(t,'numberSeries','ns_rc')->>'nextNumber')::int = 1, 'D: a reset-per-year series moves that year''s counter only');
  r := public.masters_series_bump(t, 'RECEIPT', 3, '2027-28');
  perform pg_temp.check((pg_temp.el(t,'numberSeries','ns_rc')->'countersByAy'->>'2027-28')::int = 4
    and (pg_temp.el(t,'numberSeries','ns_rc')->'countersByAy'->>'2026-27')::int = 8, 'D: a new year''s counter is added, the other kept');
  r := public.masters_series_bump(t, 'NOPE', 3);
  perform pg_temp.check(r->>'status' = 'not_found' and not (r->>'ok')::boolean, 'D: an unknown series → not_found');
  perform pg_temp.check(pg_temp.state_of(format('select public.masters_series_bump(%L, ''ADMISSION'', 0)', t)) = '22023',
    'D: a used number below 1 is refused');
  perform pg_temp.check((select number_series_count from (select count(*) as number_series_count
     from public.masters_desk_number_series where tenant_id=t) x) = 2
    and (select next_number from public.masters_desk_number_series where tenant_id=t and id='ns_adm') = 14,
    'D: the number-series row table follows');
end
$test$;

-- @section E: staff soft remove + restore through the kernel
do $test$
declare
  t uuid := pg_temp.new_school('staff-remove');
  r jsonb; v1 timestamptz; rev text; st text;
begin
  perform pg_temp.check((select soft_delete and sync_meta_table is null from public.desk_writable_tables where table_name='sis_staff')
    and exists (select 1 from public.desk_writable_tables where table_name='sis_departments' and sync_meta_table is null)
    and exists (select 1 from public.desk_writable_tables where table_name='sis_designations' and sync_meta_table is null),
    'E: sis_staff (soft delete), sis_departments, sis_designations are kernel-writable, signal read from the table');
  perform pg_temp.check(not (public.erp_versions(t) ? 'sis_staff_sync') and (public.erp_versions(t) ? 'sis_staff'),
    'E: erp_versions keeps one sis_staff key (no second key from a sync_meta table)');

  r := public.desk_write_guarded(t, 'sis_departments', '[{"op":"upsert","id":"dep_1","base":null,"row":{"code":"SCI","name":"Science"}}]');
  perform pg_temp.check((r->>'applied')::int = 1, 'E: a department is written through the kernel');
  r := public.desk_write_guarded(t, 'sis_staff',
    '[{"op":"upsert","id":"st_1","base":null,"row":{"emp_code":"E1","full_name":"Asha","department_id":"dep_1","profile":{"remarks":""}}},
      {"op":"upsert","id":"st_2","base":null,"row":{"emp_code":"E2","full_name":"Ravi","profile":{}}}]');
  perform pg_temp.check((r->>'applied')::int = 2, 'E: two staff written through the kernel');
  rev := r->'versions'->>'st_1';
  v1 := (public.erp_versions(t)->'sis_staff'->>'updated_at')::timestamptz;

  st := pg_temp.state_of(format($q$select public.desk_write_guarded(%L, 'sis_staff', '[{"op":"delete","id":"st_1","base":%s}]')$q$,
          t, to_jsonb(rev)));
  perform pg_temp.check(st = '22023', 'E: a remove without who (by) is refused');
  r := public.desk_write_guarded(t, 'sis_staff', jsonb_build_array(jsonb_build_object('op','delete','id','st_1','base',rev,'by','principal@school')));
  perform pg_temp.check((r->>'deleted')::int = 1, 'E: Remove with the revision and who is applied');
  perform pg_temp.check(exists (select 1 from public.sis_staff where tenant_id=t and id='st_1' and deleted_at is not null
                                   and deleted_by = 'principal@school' and full_name = 'Asha'),
    'E: the row is still there — soft removed, with who and when, nothing else lost');
  perform pg_temp.check((public.erp_versions(t)->'sis_staff'->>'updated_at')::timestamptz > v1, 'E: erp_versions(sis_staff) moved');
  perform pg_temp.check((select count(*) from public.sis_staff where tenant_id=t and deleted_at is null) = 1,
    'E: a list that hides deleted_at rows (repo.list for softDelete) shows one member');

  st := pg_temp.state_of(format($q$select public.desk_write_guarded(%L, 'sis_staff', '[{"op":"upsert","id":"st_2","base":%s,"row":{"deleted_at":"2026-10-21T00:00:00Z"}}]')$q$,
          t, to_jsonb((select updated_at::text from public.sis_staff where tenant_id=t and id='st_2'))));
  perform pg_temp.check(st = '22023' and (select deleted_at is null from public.sis_staff where tenant_id=t and id='st_2'),
    'E: an upsert cannot remove (setting deleted_at without who) — refused');

  -- Restore: the revision of the removed row, deleted_at back to null.
  rev := r->'versions'->>'st_1';
  r := public.desk_write_guarded(t, 'sis_staff', '[{"op":"upsert","id":"st_1","base":null,"row":{"deleted_at":null}}]');
  perform pg_temp.check(r->'results'->0->>'reason' = 'unversioned', 'E: restoring without the removed row''s revision → unversioned');
  r := public.desk_write_guarded(t, 'sis_staff', jsonb_build_array(jsonb_build_object('op','upsert','id','st_1','base',rev,'row','{"deleted_at":null}'::jsonb)));
  perform pg_temp.check((r->>'applied')::int = 1
    and exists (select 1 from public.sis_staff where tenant_id=t and id='st_1' and deleted_at is null and deleted_by is null
                   and full_name = 'Asha' and department_id = 'dep_1'),
    'E: restore brings the same record back (who cleared, everything else intact)');
end
$test$;

-- @section F: sensitive staff fields only through sis_staff_write_sensitive
do $test$
declare
  t uuid := pg_temp.new_school('staff-sensitive');
  r jsonb; rev text; st text;
begin
  -- Set up a staff row with bank details (as payroll would).
  r := public.sis_staff_write_sensitive(t,
    '[{"op":"upsert","id":"st_9","base":null,"row":{"emp_code":"E9","full_name":"Meena",
       "profile":{"bankAccountNo":"111122223333","bankIfsc":"SBIN0001234","panNo":"ABCDE1234F","remarks":"x"}}}]',
    'payroll', 'accounts.head@school');
  perform pg_temp.check((r->>'applied')::int = 1, 'F: payroll can create a staff row with bank details');
  rev := r->'versions'->>'st_9';

  -- A staff-edit caller (the generic kernel path) changes the bank account: refused.
  st := pg_temp.state_of(format($q$select public.desk_write_guarded(%L, 'sis_staff', %L)$q$, t,
    jsonb_build_array(jsonb_build_object('op','upsert','id','st_9','base',rev,'row',
      '{"profile":{"bankAccountNo":"999988887777","bankIfsc":"SBIN0001234","panNo":"ABCDE1234F","remarks":"x"}}'::jsonb))));
  perform pg_temp.check(st = '42501', 'F: changing the bank account without the payroll/accounts mark → 42501');
  perform pg_temp.check((select profile->>'bankAccountNo' from public.sis_staff where tenant_id=t and id='st_9') = '111122223333',
    'F: … and nothing was written');
  -- Dropping the sensitive keys (a profile sent without them) is a change too.
  st := pg_temp.state_of(format($q$select public.desk_write_guarded(%L, 'sis_staff', %L)$q$, t,
    jsonb_build_array(jsonb_build_object('op','upsert','id','st_9','base',rev,'row','{"profile":{"remarks":"y"}}'::jsonb))));
  perform pg_temp.check(st = '42501', 'F: a profile that blanks the PAN / bank fields is refused too');
  st := pg_temp.state_of(format($q$select public.desk_write_guarded(%L, 'sis_staff', '[{"op":"upsert","id":"st_10","base":null,"row":{"emp_code":"E10","profile":{"aadhaarNo":"123412341234"}}}]')$q$, t));
  perform pg_temp.check(st = '42501' and not exists (select 1 from public.sis_staff where tenant_id=t and id='st_10'),
    'F: a new staff row with an Aadhaar number from the generic path is refused');
  st := pg_temp.state_of(format($q$select public.desk_write_guarded(%L, 'sis_staff', %L)$q$, t,
    jsonb_build_array(jsonb_build_object('op','upsert','id','st_9','base',rev,'row',
      '{"profile":{"bankAccountNo":"111122223333","bankIfsc":"SBIN0001234","panNo":"ABCDE1234F","remarks":"x","basicPay":"30000"}}'::jsonb))));
  perform pg_temp.check(st = '42501', 'F: setting basic pay from the generic path is refused');

  -- The same caller may change everything else, sending the sensitive keys as stored.
  r := public.desk_write_guarded(t, 'sis_staff', jsonb_build_array(jsonb_build_object('op','upsert','id','st_9','base',rev,'row',
      '{"full_name":"Meena K","profile":{"bankAccountNo":"111122223333","bankIfsc":"SBIN0001234","panNo":"ABCDE1234F","remarks":"moved to block B"}}'::jsonb)));
  perform pg_temp.check((r->>'applied')::int = 1, 'F: a non-sensitive edit (name, remarks) through the generic path lands');
  rev := r->'versions'->>'st_9';

  -- Payroll changes the account: lands, and the change is recorded (names only).
  r := public.sis_staff_write_sensitive(t, jsonb_build_array(jsonb_build_object('op','upsert','id','st_9','base',rev,'row',
      '{"profile":{"bankAccountNo":"999988887777","bankIfsc":"HDFC0000001","panNo":"ABCDE1234F","remarks":"moved to block B"}}'::jsonb)),
      'payroll', 'accounts.head@school');
  perform pg_temp.check((r->>'applied')::int = 1
    and (select profile->>'bankAccountNo' from public.sis_staff where tenant_id=t and id='st_9') = '999988887777',
    'F: with the payroll mark the bank change lands');
  perform pg_temp.check((select fields = array['bankAccountNo','bankIfsc'] and authority = 'payroll' and actor = 'accounts.head@school'
       from public.sis_staff_sensitive_changes where tenant_id=t and staff_id='st_9' order by changed_at desc limit 1),
    'F: the change is recorded: which fields, who, on what authority');
  perform pg_temp.check(not exists (select 1 from public.sis_staff_sensitive_changes c where c.tenant_id=t
       and (array_to_string(c.fields, ',') like '%9999%' or c.actor like '%9999%')), 'F: the record holds no values');
  rev := r->'versions'->>'st_9';

  -- The mark does not outlive the call, even in the same transaction.
  st := pg_temp.state_of(format($q$select public.desk_write_guarded(%L, 'sis_staff', %L)$q$, t,
    jsonb_build_array(jsonb_build_object('op','upsert','id','st_9','base',rev,'row',
      '{"profile":{"bankAccountNo":"000000000000","bankIfsc":"HDFC0000001","panNo":"ABCDE1234F","remarks":"moved to block B"}}'::jsonb))));
  perform pg_temp.check(st = '42501', 'F: right after a marked call, the generic path is refused again');
  perform pg_temp.check(pg_temp.state_of(format($q$select public.sis_staff_write_sensitive(%L, '[]', 'staff', 'x')$q$, t)) = '22023',
    'F: an authority other than owner/payroll/accounts is refused');
  perform pg_temp.check(pg_temp.state_of(format($q$select public.sis_staff_write_sensitive(%L, '[]', 'owner', ' ')$q$, t)) = '22023',
    'F: the actor is required');
  perform pg_temp.check(not has_function_privilege('authenticated', 'public.sis_staff_write_sensitive(uuid, jsonb, text, text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.desk_slice_rows_write(uuid, text, jsonb)', 'EXECUTE')
    and not has_function_privilege('service_role', 'public._desk_slice_element_apply(uuid, text, text, text, text, jsonb, text, text)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.masters_series_bump(uuid, text, int, text)', 'EXECUTE')
    and has_table_privilege('service_role', 'public.sis_staff_sensitive_changes', 'INSERT')
    and not has_table_privilege('authenticated', 'public.sis_staff_sensitive_changes', 'SELECT'),
    'F: grants — service_role only; the internal apply step is not callable');
end
$test$;

rollback;
