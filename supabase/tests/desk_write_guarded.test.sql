-- Behavioural test for desk_write_guarded v3 (20261014220000_data_layer_write_kernel,
-- data-layer step 1.5). Replaces the probe of 10 Aug, which ran against the
-- production tenant and asserted v1 behaviour — including that a null base was
-- accepted on an existing row, the hole v3 closes.
--
-- Runs in CI against the E2E stack (every migration on Postgres 17):
--   bash scripts/e2e-stack.sh sql-test supabase/tests/desk_write_guarded.test.sql
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

-- The SQLSTATE a call raises, or 'ok'.
create or replace function pg_temp.state_of(p_tenant uuid, p_table text, p_ops jsonb) returns text language plpgsql as $$
declare v text;
begin
  perform public.desk_write_guarded(p_tenant, p_table, p_ops);
  return 'ok';
exception when others then
  get stacked diagnostics v = returned_sqlstate;
  return v;
end $$;

do $test$
declare
  t uuid := gen_random_uuid();
  r jsonb; rev1 text; rev2 text; rev3 text; m1 timestamptz; m2 timestamptz;
  hh jsonb := jsonb_build_object('code','HHP1','guardian_name','Probe One','mobile','9000000001');
  n int;
begin
  insert into public.tenants (id, slug, name) values (t, 'guard-probe-' || left(t::text, 8), 'Guard probe');

  -- ── Allowlist ───────────────────────────────────────────────────────────
  perform pg_temp.check(pg_temp.state_of(t, 'profiles', '[{"op":"delete","id":"x"}]') = '42501', 'profiles is refused');
  perform pg_temp.check(pg_temp.state_of(t, 'sis_students; drop table sis_students--', '[{"op":"delete","id":"x"}]') = '42501',
    'an injected table name is refused');
  perform pg_temp.check(pg_temp.state_of(t, 'masters_desk_classes', '[{"op":"delete","id":"x"}]') = '42501',
    'masters_desk_* row tables are no longer writable (derived from the slices)');
  perform pg_temp.check(
    (select sync_meta_table = 'sis_sync_meta' and sync_count_column = 'household_count'
       from public.desk_writable_tables where table_name = 'sis_households'),
    'sis_households names its change signal');
  perform pg_temp.check(
    not exists (select 1 from public.desk_writable_tables where sync_meta_table is null),
    'every writable table names a sync_meta table');

  -- ── Malformed batches are errors, never skipped ─────────────────────────
  perform pg_temp.check(pg_temp.state_of(t, 'sis_households', '[{"op":"upsert","row":{"code":"X"}}]') = '22023',
    'an op without an id is refused');
  perform pg_temp.check(pg_temp.state_of(t, 'sis_households',
    '[{"op":"upsert","id":"d1","row":{}},{"op":"delete","id":"d1"}]') = '22023', 'an id twice in one batch is refused');
  perform pg_temp.check(pg_temp.state_of(t, 'sis_households', '[{"op":"merge","id":"d1"}]') = '22023', 'an unknown op is refused');

  -- ── Insert of an absent id: null base is legal ──────────────────────────
  r := public.desk_write_guarded(t, 'sis_households', jsonb_build_array(jsonb_build_object(
         'op','upsert','id','hh_p1','base',null,'row',hh)));
  perform pg_temp.check((r->>'ok')::boolean and (r->>'applied')::int = 1, 'insert with null base on an absent id is applied');
  rev1 := r->'versions'->>'hh_p1';
  select updated_at, household_count into m1, n from public.sis_sync_meta where tenant_id = t;
  perform pg_temp.check(m1 is not null and n = 1, 'the insert bumped sis_sync_meta (updated_at, household_count = 1)');

  -- ── Null base on an EXISTING row: 409 unversioned, nothing written ──────
  r := public.desk_write_guarded(t, 'sis_households', jsonb_build_array(jsonb_build_object(
         'op','upsert','id','hh_p1','base',null,'row',jsonb_build_object('guardian_name','Stale Writer'))));
  perform pg_temp.check(not (r->>'ok')::boolean and r->'results'->0->>'status' = 'conflict'
    and r->'results'->0->>'reason' = 'unversioned' and (r->>'unversioned')::int = 1,
    'null base on an existing row → conflict / unversioned');
  perform pg_temp.check(r->'results'->0->'stored'->>'guardian_name' = 'Probe One', 'the refusal carries the stored row');
  perform pg_temp.check((select guardian_name from public.sis_households where id='hh_p1' and tenant_id=t) = 'Probe One',
    'nothing was written');
  perform pg_temp.check((select updated_at from public.sis_sync_meta where tenant_id=t) = m1, 'a refusal moves no signal');

  -- The same with an IDENTICAL row: still refused (no revision, no write).
  r := public.desk_write_guarded(t, 'sis_households', jsonb_build_array(jsonb_build_object(
         'op','upsert','id','hh_p1','row',hh)));
  perform pg_temp.check(r->'results'->0->>'reason' = 'unversioned', 'an unversioned identical row is refused too');

  -- Delete with a null base on an existing row: refused.
  r := public.desk_write_guarded(t, 'sis_households', '[{"op":"delete","id":"hh_p1"}]');
  perform pg_temp.check(r->'results'->0->>'reason' = 'unversioned'
    and exists (select 1 from public.sis_households where id='hh_p1' and tenant_id=t),
    'delete with null base on an existing row → unversioned, row kept');

  -- ── Correct base: applied, signal moves ─────────────────────────────────
  r := public.desk_write_guarded(t, 'sis_households', jsonb_build_array(jsonb_build_object(
         'op','upsert','id','hh_p1','base',rev1,'row',jsonb_build_object('guardian_name','Probe Two'))));
  perform pg_temp.check((r->>'ok')::boolean and r->'results'->0->>'status' = 'applied', 'a write with the current base is applied');
  rev2 := r->'versions'->>'hh_p1';
  perform pg_temp.check(rev2::timestamptz > rev1::timestamptz, 'the revision moved');
  perform pg_temp.check((select mobile from public.sis_households where id='hh_p1' and tenant_id=t) = '9000000001',
    'patch, not replace: an absent key kept its value');
  select updated_at into m2 from public.sis_sync_meta where tenant_id = t;
  perform pg_temp.check(m2 > m1, 'sis_sync_meta.updated_at moved with the applied op');

  -- Same payload again with the current base: unchanged, revision held, no signal.
  r := public.desk_write_guarded(t, 'sis_households', jsonb_build_array(jsonb_build_object(
         'op','upsert','id','hh_p1','base',rev2,'row',jsonb_build_object('guardian_name','Probe Two'))));
  perform pg_temp.check(r->'results'->0->>'status' = 'unchanged'
    and (r->'versions'->>'hh_p1')::timestamptz = rev2::timestamptz
    and (select updated_at from public.sis_sync_meta where tenant_id=t) = m2,
    'an identical write is unchanged, keeps its revision and moves nothing');

  -- ── Stale base ──────────────────────────────────────────────────────────
  r := public.desk_write_guarded(t, 'sis_households', jsonb_build_array(jsonb_build_object(
         'op','upsert','id','hh_p1','base',rev1,'row',jsonb_build_object('guardian_name','From an old copy'))));
  perform pg_temp.check(r->'results'->0->>'reason' = 'stale' and r->'results'->0->>'revision' is not null
    and (select guardian_name from public.sis_households where id='hh_p1' and tenant_id=t) = 'Probe Two',
    'stale base → conflict / stale with the current revision, nothing written');

  -- ── All or none ─────────────────────────────────────────────────────────
  r := public.desk_write_guarded(t, 'sis_households', jsonb_build_array(
         jsonb_build_object('op','upsert','id','hh_p2','row',jsonb_build_object('code','HHP2')),
         jsonb_build_object('op','upsert','id','hh_p1','base',rev1,'row',jsonb_build_object('guardian_name','Old'))));
  perform pg_temp.check(not (r->>'ok')::boolean and not exists (select 1 from public.sis_households where id='hh_p2' and tenant_id=t),
    'one refused op in a batch writes nothing (the good insert did not land)');

  -- ── A base on an absent row: it was deleted since the client loaded it ──
  r := public.desk_write_guarded(t, 'sis_households', jsonb_build_array(jsonb_build_object(
         'op','upsert','id','hh_gone','base',rev1,'row',jsonb_build_object('code','GONE'))));
  perform pg_temp.check(r->'results'->0->>'reason' = 'deleted'
    and not exists (select 1 from public.sis_households where id='hh_gone'), 'an edit of a removed row does not re-create it');

  -- ── Delete with the current base; count follows ─────────────────────────
  r := public.desk_write_guarded(t, 'sis_households', jsonb_build_array(jsonb_build_object(
         'op','delete','id','hh_p1','base',rev2)));
  perform pg_temp.check((r->>'ok')::boolean and (r->>'deleted')::int = 1
    and not exists (select 1 from public.sis_households where id='hh_p1' and tenant_id=t), 'delete with the current base deletes');
  perform pg_temp.check((select household_count from public.sis_sync_meta where tenant_id=t) = 0
    and (select updated_at from public.sis_sync_meta where tenant_id=t) > m2, 'the delete moved the signal and the count');
  r := public.desk_write_guarded(t, 'sis_households', '[{"op":"delete","id":"hh_p1"}]');
  perform pg_temp.check((r->>'ok')::boolean and r->'results'->0->>'status' = 'deleted', 'deleting an absent id is a no-op');

  -- ── Soft delete (udise sheet): a deleted row EXISTS; reviving needs its revision ──
  r := public.desk_write_guarded(t, 'udise_upload_sheets', jsonb_build_array(jsonb_build_object(
         'op','upsert','id','udise-probe','row',jsonb_build_object('academic_year_code','2026-27','files','[]'::jsonb))));
  rev1 := r->'versions'->>'udise-probe';
  perform pg_temp.check((select sheet_count from public.udise_sheet_desk_sync_meta where tenant_id=t) = 1, 'udise sheet count 1');
  r := public.desk_write_guarded(t, 'udise_upload_sheets', jsonb_build_array(jsonb_build_object(
         'op','delete','id','udise-probe','base',rev1)));
  rev2 := r->'versions'->>'udise-probe';
  perform pg_temp.check(rev2 is not null and (select deleted_at is not null from public.udise_upload_sheets where id='udise-probe'),
    'a soft delete stamps deleted_at and returns the new revision');
  perform pg_temp.check((select sheet_count from public.udise_sheet_desk_sync_meta where tenant_id=t) = 0,
    'the soft-deleted sheet is not counted');
  r := public.desk_write_guarded(t, 'udise_upload_sheets', jsonb_build_array(jsonb_build_object(
         'op','upsert','id','udise-probe','row',jsonb_build_object('deleted_at',null))));
  perform pg_temp.check(r->'results'->0->>'reason' = 'unversioned', 'reviving a soft-deleted row without its revision is refused');
  r := public.desk_write_guarded(t, 'udise_upload_sheets', jsonb_build_array(jsonb_build_object(
         'op','upsert','id','udise-probe','base',rev2,'row',jsonb_build_object('deleted_at',null))));
  rev3 := r->'versions'->>'udise-probe';
  perform pg_temp.check(rev3 is not null and (select deleted_at is null from public.udise_upload_sheets where id='udise-probe')
    and (select sheet_count from public.udise_sheet_desk_sync_meta where tenant_id=t) = 1, 'reviving with its revision works');

  -- ── sis_students: active count follows ──────────────────────────────────
  r := public.desk_write_guarded(t, 'sis_students', jsonb_build_array(jsonb_build_object(
         'op','upsert','id','stu_p1','row',jsonb_build_object('full_name','Probe Child','status','active','admission_no','P1'))));
  perform pg_temp.check((r->>'ok')::boolean
    and (select student_count = 1 and active_student_count = 1 from public.sis_sync_meta where tenant_id=t),
    'a student insert sets student_count and active_student_count');

  -- ── erp_versions sees the bump ──────────────────────────────────────────
  perform pg_temp.check((public.erp_versions(t)->'sis'->>'updated_at')::timestamptz
                        = (select updated_at from public.sis_sync_meta where tenant_id=t),
    'erp_versions(sis) is the bumped value');
  perform pg_temp.check(public.erp_versions(t) ? 'website' and public.erp_versions(t) ? 'udise_sheet',
    'the two new sync_meta tables appear in erp_versions');
end
$test$;

rollback;
