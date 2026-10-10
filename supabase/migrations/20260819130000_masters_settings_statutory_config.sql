-- Add statutoryConfig (EPF/ESIC establishment config: wage ceilings, rates)
-- to the single-document slices mirrored into masters_desk_settings.
-- Until 2026-08-19 the slice was never pushed at all (not in the client's
-- MASTERS_OBJECT_SLICES), so the ceilings lived in one browser's
-- localStorage only; the client fix ships with this migration.
-- Identical to 20260817183200 except the two settings slice_key lists.

create or replace function public.masters_sync_rows_from_slices(p_tenant_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  pair       record;
  rows_json  jsonb;
  ids        text[];
  n_up       int := 0;
  n_del      int := 0;
  removed    int;
  report     jsonb := '{}'::jsonb;
  cols       text;
  cols_pr    text;
  sets       text;
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
    -- Build every row's snake-cased, enriched object as ONE set, instead of
    -- one round trip per item. `ordinal` still carries array position
    -- (jsonb_array_elements preserves array order, same guarantee the
    -- original per-row `ord := ord + 1` counter relied on).
    with items as (
      select e, row_number() over () - 1 as ord
      from public.masters_desk_slices s, jsonb_array_elements(s.payload) e
      where s.tenant_id = p_tenant_id and s.slice_key = pair.slice_key
        and nullif(e ->> 'id', '') is not null
    ),
    snaked as (
      select
        (select coalesce(jsonb_object_agg(public._masters_snake(k), v), '{}'::jsonb)
           from jsonb_each(items.e) as kv(k, v))
        || jsonb_build_object('tenant_id', p_tenant_id, 'ordinal', items.ord,
                               'updated_at', clock_timestamp()) as row_obj
      from items
    )
    select jsonb_agg(row_obj), array_agg(row_obj ->> 'id')
      into rows_json, ids
      from snaked;

    ids := coalesce(ids, array[]::text[]);

    if rows_json is not null and jsonb_array_length(rows_json) > 0 then
      -- Real columns only, union across the whole batch -- an unknown key
      -- is ignored rather than erroring (a new field in the slice cannot
      -- break the sync), same as before, just computed once for the batch
      -- instead of once per row.
      select string_agg(format('%I', k), ', '),
             string_agg(format('pr.%I', k), ', '),
             string_agg(format('%I = excluded.%I', k, k), ', ')
        into cols, cols_pr, sets
        from (
          select distinct k
          from jsonb_array_elements(rows_json) r, jsonb_object_keys(r) k
        ) keys
       where exists (select 1 from information_schema.columns c
          where c.table_schema = 'public' and c.table_name = pair.tbl
            and c.column_name = keys.k)
         and keys.k not in ('id', 'tenant_id', 'created_at');

      if cols is not null then
        execute format(
          'insert into public.%I (id, tenant_id, %s)
           select pr.id, pr.tenant_id, %s
           from jsonb_array_elements($1) as x(rec),
                lateral jsonb_populate_record(null::public.%I, x.rec) as pr
           on conflict (id) do update set %s',
          pair.tbl, cols, cols_pr, pair.tbl, sets
        ) using rows_json;
      end if;
    end if;

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

    n_up := n_up + coalesce(jsonb_array_length(rows_json), 0);
  end loop;

  -- The three single-document slices (unchanged -- already set-based).
  insert into public.masters_desk_settings (id, tenant_id, payload, updated_at)
  select s.slice_key, p_tenant_id, s.payload, clock_timestamp()
    from public.masters_desk_slices s
   where s.tenant_id = p_tenant_id
     and s.slice_key in ('schoolProfile','schoolTiming','midYearFeePolicy','statutoryConfig')
  on conflict (id) do update set
    payload = excluded.payload, updated_at = excluded.updated_at;

  delete from public.masters_desk_settings
   where tenant_id = p_tenant_id
     and id not in (select slice_key from public.masters_desk_slices
                     where tenant_id = p_tenant_id
                       and slice_key in ('schoolProfile','schoolTiming','midYearFeePolicy','statutoryConfig'));

  return jsonb_build_object('ok', true, 'upserted', n_up, 'deleted', n_del,
                            'deletedBy', report);
end;
$$;

revoke all on function public.masters_sync_rows_from_slices(uuid) from public, anon, authenticated;
grant execute on function public.masters_sync_rows_from_slices(uuid) to service_role;
