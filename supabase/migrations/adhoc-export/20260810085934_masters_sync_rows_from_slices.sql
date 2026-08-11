-- Keep the masters row tables derived from masters_desk_slices.
--
-- The read-path switch cannot happen while writes reach only the slices:
-- reads would come from somewhere the writes never touch, and every masters
-- edit would save fine and never appear. This makes the rows a DERIVED copy
-- that is reconciled on every push, so they can never become a second,
-- diverging source of truth.
--
-- Direction matters. The slices stay authoritative and the rows follow.
-- Writing both independently would mean two writers and a merge problem,
-- which is the disease being cured, not a treatment for it.
--
-- Reconciliation is upsert AND delete. The one-off copy migration was
-- upsert-only, so a class removed from the slice would have survived in the
-- row table — a phantom class, which is exactly how orphaned references
-- start. An absent slice key empties its table for the same reason.

-- camelCase -> snake_case, so the 21 entity mappings do not have to be
-- written out by hand (and cannot drift from each other).
create or replace function public._masters_snake(t text)
returns text language sql immutable as $$
  select lower(regexp_replace(t, '([a-z0-9])([A-Z])', '\1_\2', 'g'))
$$;

create or replace function public.masters_sync_rows_from_slices(p_tenant_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  pair    record;
  item    jsonb;
  ord     int;
  snake   jsonb;
  cols    text;
  sets    text;
  ids     text[];
  n_up    int := 0;
  n_del   int := 0;
  removed int;
  report  jsonb := '{}'::jsonb;
begin
  if p_tenant_id is null then
    raise exception 'masters_sync_rows_from_slices: tenant_id is required'
      using errcode = '22004';
  end if;

  for pair in
    select * from (values
      ('classes','masters_desk_classes'),('sections','masters_desk_sections'),
      ('campuses','masters_desk_campuses'),('academicYears','masters_desk_academic_years'),
      ('academicTerms','masters_desk_academic_terms'),('subjects','masters_desk_subjects'),
      ('classSubjects','masters_desk_class_subjects'),
      ('feeHeadCategories','masters_desk_fee_head_categories'),
      ('feeHeads','masters_desk_fee_heads'),('installments','masters_desk_installments'),
      ('feeGroups','masters_desk_fee_groups'),
      ('feeStructureLines','masters_desk_fee_structure_lines'),
      ('lateFeeRules','masters_desk_late_fee_rules'),('specialFees','masters_desk_special_fees'),
      ('specialFeeAssignments','masters_desk_special_fee_assignments'),
      ('concessionKinds','masters_desk_concession_kinds'),
      ('concessions','masters_desk_concessions'),
      ('concessionGrants','masters_desk_concession_grants'),
      ('seniorStreams','masters_desk_senior_streams'),
      ('numberSeries','masters_desk_number_series'),('holidays','masters_desk_holidays')
    ) as t(slice_key, tbl)
  loop
    ids := array[]::text[];
    ord := 0;

    for item in
      select e from public.masters_desk_slices s,
                    jsonb_array_elements(s.payload) e
       where s.tenant_id = p_tenant_id and s.slice_key = pair.slice_key
    loop
      if nullif(item->>'id','') is null then
        continue;
      end if;
      ids := ids || (item->>'id');

      -- Rewrite the record's keys to column names, and carry the array
      -- position so the reader can reproduce the slice's order exactly.
      select coalesce(jsonb_object_agg(public._masters_snake(k), v), '{}'::jsonb)
        into snake
        from jsonb_each(item) as kv(k, v);
      snake := snake
            || jsonb_build_object('tenant_id', p_tenant_id,
                                  'ordinal', ord,
                                  'updated_at', clock_timestamp());

      -- Only keys that are real columns; anything else is ignored rather
      -- than erroring, so a new field in the slice cannot break the sync.
      select string_agg(format('%I', k), ', '),
             string_agg(format('%I = excluded.%I', k, k), ', ')
        into cols, sets
        from jsonb_object_keys(snake) k
       where exists (select 1 from information_schema.columns c
          where c.table_schema = 'public' and c.table_name = pair.tbl
            and c.column_name = k)
         and k not in ('id','tenant_id','created_at');

      execute format(
        'insert into public.%I (id, tenant_id, %s) select $2, $3, %s from jsonb_populate_record(null::public.%I, $1) on conflict (id) do update set %s',
        pair.tbl, cols, cols, pair.tbl, sets)
        using snake, item->>'id', p_tenant_id;

      n_up := n_up + 1;
      ord := ord + 1;
    end loop;

    -- Anything no longer in the slice is gone. Without this the row table
    -- keeps deleted records and the two stores silently diverge.
    execute format(
      'delete from public.%I where tenant_id = $1 and not (id = any($2))',
      pair.tbl) using p_tenant_id, ids;
    get diagnostics removed = row_count;
    n_del := n_del + removed;

    if removed > 0 then
      report := report || jsonb_build_object(pair.slice_key, removed);
    end if;
  end loop;

  -- The three single-document slices.
  insert into public.masters_desk_settings (id, tenant_id, payload, updated_at)
  select s.slice_key, p_tenant_id, s.payload, clock_timestamp()
    from public.masters_desk_slices s
   where s.tenant_id = p_tenant_id
     and s.slice_key in ('schoolProfile','schoolTiming','midYearFeePolicy')
  on conflict (id) do update set
    payload = excluded.payload, updated_at = excluded.updated_at;

  delete from public.masters_desk_settings
   where tenant_id = p_tenant_id
     and id not in (select slice_key from public.masters_desk_slices
                     where tenant_id = p_tenant_id
                       and slice_key in ('schoolProfile','schoolTiming','midYearFeePolicy'));

  return jsonb_build_object('ok', true, 'upserted', n_up, 'deleted', n_del,
                            'deletedBy', report);
end $$;

revoke all on function public.masters_sync_rows_from_slices(uuid)
  from public, anon, authenticated;
grant execute on function public.masters_sync_rows_from_slices(uuid) to service_role;
