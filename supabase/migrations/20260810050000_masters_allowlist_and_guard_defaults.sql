-- Stage 2.4 — two changes that belong together.
--
-- 1. Allowlist the masters_desk_* tables so desk_write_guarded will write
--    them. Deliberately separate from the migrations that created
--    (20260810030000) and populated (20260810040000) them: adding a row to
--    desk_writable_tables is a permission change. Until now the guard
--    refused every one of these with 42501 no matter what the registry or
--    the API said. Two systems, two steps.
--
-- 2. Fix desk_write_guarded so column DEFAULTs apply on insert.
--
-- The bug: the original body did
--     insert into T select * from jsonb_populate_record(null::T, incoming)
-- which names EVERY column, so a column absent from the payload was
-- inserted as an explicit NULL instead of taking its default. Any
-- `not null default ...` column then failed:
--     null value in column "is_active" violates not-null constraint
--
-- It only surfaces when INSERTING a new row. On update `incoming` is
-- `existing || payload`, so every column is already populated — which is
-- exactly why the Stage 1 tests passed: they exercised sis_students with
-- complete rows, and never inserted a partial one. The first partial insert
-- was a masters class, and it failed immediately.
--
-- The fix builds the column list from the payload's own keys, intersected
-- with the table's real columns so an unknown key is ignored rather than
-- erroring. Omitted columns are not named at all, so Postgres applies their
-- defaults. The same list drives `do update set`, which also makes the
-- conflict path a true patch rather than overwriting unmentioned columns.
--
-- Verified end-to-end through /api/data/masters.classes after applying:
-- create with a partial row (is_active defaulted to true), patch of one
-- field (group_code and sort_order survived), identical payload -> unchanged
-- with the revision held, stale base -> 409 with the stored row and nothing
-- written, delete -> gone. Real masters data untouched: Nursery byte-identical
-- before and after, 15 classes throughout.

insert into public.desk_writable_tables (table_name, soft_delete, note) values
  ('masters_desk_classes',                 false, 'Stage 2 masters'),
  ('masters_desk_sections',                false, 'Stage 2 masters'),
  ('masters_desk_campuses',                false, 'Stage 2 masters'),
  ('masters_desk_academic_years',          false, 'Stage 2 masters; Stage 3 promotes this to session system of record'),
  ('masters_desk_academic_terms',          false, 'Stage 2 masters'),
  ('masters_desk_subjects',                false, 'Stage 2 masters'),
  ('masters_desk_class_subjects',          false, 'Stage 2 masters'),
  ('masters_desk_fee_head_categories',     false, 'Stage 2 masters'),
  ('masters_desk_fee_heads',               false, 'Stage 2 masters'),
  ('masters_desk_installments',            false, 'Stage 2 masters'),
  ('masters_desk_fee_groups',              false, 'Stage 2 masters'),
  ('masters_desk_fee_structure_lines',     false, 'Stage 2 masters; 268 rows, the largest slice'),
  ('masters_desk_late_fee_rules',          false, 'Stage 2 masters'),
  ('masters_desk_special_fees',            false, 'Stage 2 masters'),
  ('masters_desk_special_fee_assignments', false, 'Stage 2 masters'),
  ('masters_desk_concession_kinds',        false, 'Stage 2 masters'),
  ('masters_desk_concessions',             false, 'Stage 2 masters'),
  ('masters_desk_concession_grants',       false, 'Stage 2 masters'),
  ('masters_desk_senior_streams',          false, 'Stage 2 masters'),
  ('masters_desk_number_series',           false, 'Stage 2 masters'),
  ('masters_desk_holidays',                false, 'Stage 2 masters'),
  ('masters_desk_settings',                false, 'Stage 2 masters; schoolProfile/schoolTiming/midYearFeePolicy')
on conflict (table_name) do nothing;

create or replace function public.desk_write_guarded(
  p_tenant_id uuid, p_table text, p_ops jsonb default '[]'::jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_soft boolean; v_has_deleted boolean;
  v_cols text; v_set text;
  item jsonb; v_op text; rec_id text; payload jsonb; incoming jsonb; existing jsonb;
  base_ts timestamptz; stored_ts timestamptz; now_ts timestamptz := clock_timestamp();
  results jsonb := '[]'::jsonb; versions jsonb := '{}'::jsonb;
  n_applied int := 0; n_unchanged int := 0; n_conflicts int := 0;
  n_deleted int := 0; n_unversioned int := 0;
begin
  select t.soft_delete into v_soft from public.desk_writable_tables t where t.table_name = p_table;
  if not found then
    raise exception 'desk_write_guarded: table % is not writable', p_table using errcode = '42501';
  end if;
  if p_tenant_id is null then
    raise exception 'desk_write_guarded: tenant_id is required' using errcode = '22004';
  end if;

  select exists (select 1 from information_schema.columns c
     where c.table_schema='public' and c.table_name=p_table and c.column_name='deleted_at')
    into v_has_deleted;

  for item in select * from jsonb_array_elements(coalesce(p_ops,'[]'::jsonb)) loop
    v_op := coalesce(item->>'op','upsert');
    rec_id := nullif(item->>'id','');
    if rec_id is null then continue; end if;
    base_ts := nullif(item->>'base','')::timestamptz;

    execute format('select to_jsonb(t) from public.%I t where t.id = $1 and t.tenant_id = $2', p_table)
      into existing using rec_id, p_tenant_id;

    if v_op = 'delete' then
      if existing is null then
        results := results || jsonb_build_array(jsonb_build_object('id',rec_id,'status','deleted'));
        continue;
      end if;
      stored_ts := (existing->>'updated_at')::timestamptz;
      if base_ts is null then n_unversioned := n_unversioned + 1;
      elsif base_ts <> stored_ts then
        n_conflicts := n_conflicts + 1;
        results := results || jsonb_build_array(jsonb_build_object(
          'id',rec_id,'status','conflict','revision',stored_ts,'stored',existing));
        versions := versions || jsonb_build_object(rec_id, stored_ts);
        continue;
      end if;
      if v_soft and v_has_deleted then
        execute format('update public.%I set deleted_at=$1, updated_at=$1 where id=$2 and tenant_id=$3', p_table)
          using now_ts, rec_id, p_tenant_id;
      else
        execute format('delete from public.%I where id=$1 and tenant_id=$2', p_table)
          using rec_id, p_tenant_id;
      end if;
      n_deleted := n_deleted + 1;
      results := results || jsonb_build_array(jsonb_build_object('id',rec_id,'status','deleted'));
      continue;
    end if;

    payload := item->'row';
    if payload is null then continue; end if;
    incoming := payload || jsonb_build_object('id',rec_id,'tenant_id',p_tenant_id);

    if existing is not null then
      -- Patch, not replace: an absent key keeps its stored value.
      incoming := existing || incoming;

      if (existing - 'updated_at') = (incoming - 'updated_at') then
        n_unchanged := n_unchanged + 1;
        versions := versions || jsonb_build_object(rec_id, existing->>'updated_at');
        results := results || jsonb_build_array(jsonb_build_object(
          'id',rec_id,'status','unchanged','revision',existing->>'updated_at'));
        continue;
      end if;
      stored_ts := (existing->>'updated_at')::timestamptz;
      if base_ts is null then n_unversioned := n_unversioned + 1;
      elsif base_ts <> stored_ts then
        n_conflicts := n_conflicts + 1;
        results := results || jsonb_build_array(jsonb_build_object(
          'id',rec_id,'status','conflict','revision',stored_ts,'stored',existing));
        versions := versions || jsonb_build_object(rec_id, stored_ts);
        continue;
      end if;
      if stored_ts >= now_ts then now_ts := stored_ts + interval '1 microsecond'; end if;
    end if;

    incoming := incoming || jsonb_build_object('updated_at', now_ts);

    -- Only the columns actually present, so omitted ones take their default.
    select string_agg(format('%I', k), ', '), string_agg(format('%I = excluded.%I', k, k), ', ')
      into v_cols, v_set
      from jsonb_object_keys(incoming) k
     where exists (select 1 from information_schema.columns c
        where c.table_schema='public' and c.table_name=p_table and c.column_name=k)
       and k not in ('id','tenant_id','created_at');

    execute format(
      'insert into public.%I (id, tenant_id, %s) select $2, $3, %s from jsonb_populate_record(null::public.%I, $1) on conflict (id) do update set %s',
      p_table, v_cols, v_cols, p_table, v_set)
      using incoming, rec_id, p_tenant_id;

    n_applied := n_applied + 1;
    versions := versions || jsonb_build_object(rec_id, now_ts);
    results := results || jsonb_build_array(jsonb_build_object(
      'id',rec_id,'status','applied','revision',now_ts));
  end loop;

  return jsonb_build_object('ok', n_conflicts = 0, 'table', p_table,
    'applied',n_applied,'unchanged',n_unchanged,'deleted',n_deleted,
    'conflicts',n_conflicts,'unversioned',n_unversioned,
    'results',results,'versions',versions);
end $$;

revoke all on function public.desk_write_guarded(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.desk_write_guarded(uuid, text, jsonb) to service_role;
