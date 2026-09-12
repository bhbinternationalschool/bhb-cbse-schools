-- sis_push_guarded: stop losing columns the function was never told about.
--
-- THE DEFECT. The guarded roster save ended in a hand-written
-- `on conflict (id) do update set …` list. Every column added to
-- sis_students / sis_households after 2026-08-18 was missing from it, so for
-- any row that already existed the value arrived from the browser, was
-- compared, was written into the INSERT — and then the conflict path assigned
-- only the columns on that list. The rest kept whatever they held.
--
-- What that cost, measured on production 2026-09-12:
--
--   * sis_students.profile (added 2026-09-06) — the full Aadhaar numbers of
--     student, father and mother, Aadhaar verification, the UDISE+ flags,
--     caste, permanent address, bank, occupation, qualification, income,
--     height/weight, CWSN, medical notes, RFID, languages, tag ids. 716 of
--     717 students held `{}`. The single exception was a child admitted the
--     same morning: a fresh INSERT does write the whole row, so its profile
--     was stored once at insert time and then frozen — its father_aadhaar_last4
--     column had since been filled in by the office while the father's full
--     number, written in the same save, never moved.
--     With SIS_READ_FROM_DB on, the next hydrate replaces the browser's copy
--     with the stored row, so those fields did not merely fail to save: they
--     disappeared from the only place they had ever existed.
--
--   * sis_households geo_lat/geo_lng and the six fields around them (added
--     2026-09-11, one day old). 0 of 200 households had a pin, so
--     findMisroutedRiders and the nearest-stop picker still had nothing to
--     read after the fix that was supposed to give them data.
--
-- This is the third time: household comms preferences were added to the list
-- by hand on 2026-08-18 and remembered; profile and geo were forgotten. A
-- list that has to be edited in step with every migration will be forgotten
-- again, so this replaces it with the catalog.
--
-- WHAT CHANGES
--
--  1. The update list is generated from information_schema — every column
--     except the key, in table order. A column added tomorrow is covered by
--     the migration that adds it.
--  2. The row written is the STORED row overlaid with the keys the client
--     actually sent, then the server-owned tenant_id/updated_at. A client
--     built before a column existed sends no key for it and therefore cannot
--     blank it; a client that sends "" or null is clearing it deliberately.
--     (Before this, the insert built the row from the payload alone, so on a
--     brand-new row a missing NOT NULL key was a constraint violation rather
--     than the column default.)
--  3. Students are classified unchanged/conflict/apply by comparing only the
--     keys the client sent — the rule households already used. An older
--     client no longer rewrites (and re-versions) every student row it pushes.
--  4. The conflict path is confined to this tenant. Before, a row whose id
--     existed under a DIFFERENT tenant read as absent (the join is
--     tenant-scoped), was treated as an insert, and the conflict path
--     overwrote that other tenant's row.
--
-- Behaviour that does not change: one transaction for the whole push, the
-- optimistic-locking token is updated_at, conflicts are reported and skipped
-- rather than overwritten, sync_meta is written in the same transaction, and
-- the 120s statement timeout.

-- Every column except the key: `col = excluded.col`, in table order.
--
-- Read from pg_catalog rather than information_schema: information_schema
-- shows a caller only the columns it holds a privilege on, so the same
-- function would generate a different list for a different role. pg_catalog
-- is visible to everyone, which is what makes the list a property of the
-- table instead of the caller.
create or replace function public.sis_push_update_set(p_table text)
returns text
language sql
stable
set search_path to 'public'
as $$
  select string_agg(
           format('%I = excluded.%I', a.attname, a.attname),
           ', ' order by a.attnum)
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = p_table
     and a.attnum > 0
     and not a.attisdropped
     and a.attgenerated = ''        -- a generated column cannot be assigned
     and a.attname <> 'id';
$$;

comment on function public.sis_push_update_set(text) is
  'The ON CONFLICT assignment list for a roster table, read from the catalog so a new column is never missed (see migration 20260912100000).';

-- The column defaults of a table as jsonb, so a payload that omits a NOT NULL
-- column inserts its default instead of failing. jsonb_populate_record on a
-- NULL base yields NULL for an absent key, not the default — hence this.
create or replace function public.sis_push_row_defaults(p_table text)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $$
declare
  expr text;
  out_row jsonb;
begin
  select string_agg(
           format('%s as %I', pg_get_expr(d.adbin, d.adrelid), a.attname),
           ', ' order by a.attnum)
    into expr
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_attrdef d
      on d.adrelid = a.attrelid and d.adnum = a.attnum
   where n.nspname = 'public'
     and c.relname = p_table
     and a.attnum > 0
     and not a.attisdropped
     and a.attgenerated = ''
     and a.attnotnull;
  if expr is null then
    return '{}'::jsonb;
  end if;
  execute format('select to_jsonb(d) from (select %s) d', expr) into out_row;
  return coalesce(out_row, '{}'::jsonb);
end;
$$;

comment on function public.sis_push_row_defaults(text) is
  'Column defaults of a roster table as jsonb — the base a pushed row is overlaid on when the row does not exist yet.';

create or replace function public.sis_push_guarded(
  p_tenant_id uuid,
  p_households jsonb default '[]'::jsonb,
  p_students jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
set search_path to 'public'
set statement_timeout to '120s'
as $function$
declare
  now_ts           timestamptz := now();

  hh_set           text := public.sis_push_update_set('sis_households');
  stu_set          text := public.sis_push_update_set('sis_students');
  hh_defaults      jsonb := public.sis_push_row_defaults('sis_households');
  stu_defaults     jsonb := public.sis_push_row_defaults('sis_students');

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
  execute format($q$
    with incoming as (
      select distinct on (id) id, row, base_ts
      from (
        select
          (item -> 'row' ->> 'id')::text as id,
          item -> 'row' as row,
          nullif(item ->> 'base', '')::timestamptz as base_ts,
          ord
        from jsonb_array_elements(coalesce($2, '[]'::jsonb))
               with ordinality as t(item, ord)
        where (item -> 'row' ->> 'id') is not null
      ) x
      order by id, ord desc
    ),
    joined as (
      select
        i.id,
        (i.row - 'updated_at') as sent,
        i.base_ts,
        to_jsonb(h) as existing,
        h.updated_at as stored_ts
      from incoming i
      left join public.sis_households h
        on h.id = i.id and h.tenant_id = $1
    ),
    classified as (
      select
        id, sent, base_ts, existing, stored_ts,
        -- Defaults, then what is stored, then what this client sent, then the
        -- fields the server owns. An absent key keeps the stored value.
        ($4 || coalesce(existing, '{}'::jsonb) || sent
             || jsonb_build_object('id', id, 'tenant_id', $1, 'updated_at', $3)
        ) as merged,
        case
          -- Compare only the keys the client sent: a client built before a
          -- column existed must read as "unchanged", not rewrite every row
          -- (and bump every version) on each push.
          when existing is not null
               and (select coalesce(jsonb_object_agg(k, existing -> k), '{}'::jsonb)
                      from jsonb_object_keys(sent) as k)
                   = sent
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
      select r.*
      from classified2 c
      cross join lateral jsonb_populate_record(null::public.sis_households, c.merged) r
      where c.action = 'apply'
      on conflict (id) do update set %s
      where sis_households.tenant_id = $1
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
        (select jsonb_object_agg(id, case when action = 'apply' then $3 else stored_ts end)
           from classified2),
        '{}'::jsonb
      )
  $q$, hh_set)
  into applied_hh, unchanged_hh, unversioned_hh, conflicts_hh, hh_versions
  using p_tenant_id, p_households, now_ts, hh_defaults;

  -- ── Students (bulk) ───────────────────────────────────────────────
  execute format($q$
    with incoming as (
      select distinct on (id) id, row, base_ts
      from (
        select
          (item -> 'row' ->> 'id')::text as id,
          item -> 'row' as row,
          nullif(item ->> 'base', '')::timestamptz as base_ts,
          ord
        from jsonb_array_elements(coalesce($2, '[]'::jsonb))
               with ordinality as t(item, ord)
        where (item -> 'row' ->> 'id') is not null
      ) x
      order by id, ord desc
    ),
    joined as (
      select
        i.id,
        (i.row - 'updated_at') as sent,
        i.base_ts,
        to_jsonb(s) as existing,
        s.updated_at as stored_ts
      from incoming i
      left join public.sis_students s
        on s.id = i.id and s.tenant_id = $1
    ),
    classified as (
      select
        id, sent, base_ts, existing, stored_ts,
        ($4 || coalesce(existing, '{}'::jsonb) || sent
             || jsonb_build_object('id', id, 'tenant_id', $1, 'updated_at', $3)
        ) as merged,
        case
          when existing is not null
               and (select coalesce(jsonb_object_agg(k, existing -> k), '{}'::jsonb)
                      from jsonb_object_keys(sent) as k)
                   = sent
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
      select r.*
      from classified2 c
      cross join lateral jsonb_populate_record(null::public.sis_students, c.merged) r
      where c.action = 'apply'
      on conflict (id) do update set %s
      where sis_students.tenant_id = $1
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
        (select jsonb_object_agg(id, case when action = 'apply' then $3 else stored_ts end)
           from classified2),
        '{}'::jsonb
      )
  $q$, stu_set)
  into applied_stu, unchanged_stu, unversioned_stu, conflicts_stu, stu_versions
  using p_tenant_id, p_students, now_ts, stu_defaults;

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
$function$;
