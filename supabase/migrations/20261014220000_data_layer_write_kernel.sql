-- data-layer step 1.5 — the write kernel (docs/data-layer-rebuild/COMMAND.md §4 1.5, rule R4).
--
-- APPLY TO PRODUCTION BEFORE THE APP THAT CALLS IT IS DEPLOYED. The app fails
-- closed without it (the generic route answers 503 for a missing function);
-- it never falls back to a whole-desk path.
--
-- Four pieces, one transaction:
--
-- 1. desk_writable_tables learns which change signal each table moves
--    (sync_meta_table, sync_count_column), two small *_sync_meta tables are
--    added for the website and the UDISE+ working sheet (the two writers that
--    had none), and the masters_desk_* row tables LEAVE the allowlist: they
--    are derived — masters_sync_rows_from_slices rewrites them from
--    masters_desk_slices on every Masters save, deleting any row the slice
--    does not hold — so a write straight into them was silently reverted by
--    the next save. Masters is written through desk_slice_row_write below.
--    (No code in the app wrote them; checked 14 Oct 2026.)
--
-- 2. desk_write_guarded v3 (rows):
--    - a null base on a row that EXISTS is refused: status 'conflict',
--      reason 'unversioned', with the stored row (409 at the route). A null
--      base is legal only to insert an id that is absent. A soft-deleted row
--      exists: reviving it needs its revision.
--    - a base on an absent row is refused (reason 'deleted': it was removed
--      after the client loaded it) — it is never re-created by a stale copy.
--    - all or none: every op is judged first (rows locked FOR UPDATE); one
--      refusal writes nothing. v2 applied the rest and reported the refused.
--    - an op without an id, an unknown op, or an id twice in one batch is an
--      error (22023), never silently skipped.
--    - every batch that changes anything bumps the table's sync_meta row
--      (updated_at + its count column) in the same transaction, so
--      erp_versions (step 1.3) moves.
--    Deletes of sis_students / sis_households need the `students` approve
--    permission on top of edit (lib/data/registry.ts approval.onDelete,
--    enforced by POST /api/data/<collection>); this function is reachable
--    by service_role only.
--
-- 3. desk_slice_row_write: one element of a jsonb array slice in one of the
--    16 *_desk_slices tables, by id. Locks the slice (FOR UPDATE + an
--    advisory lock that also covers a slice row not yet created). Base:
--    masters and timetable — the slice's updated_at; every other desk — the
--    element's _rev, bumped exactly as lib/sliceRevMerge.ts does (new row
--    _rev 1, changed row _rev + 1, identical content unchanged). Patch, not
--    replace: a key the op does not carry keeps its stored value. Writes a
--    new slice updated_at, bumps <desk>_desk_sync_meta, and for masters runs
--    masters_sync_rows_from_slices in the same transaction — if the row
--    tables refuse the slice (e.g. a class link without isOptional, the
--    step 1.1 finding) the slice write rolls back with it. A classSubjects
--    element without isOptional is written with isOptional:false (what every
--    app-written link carries); a non-boolean isOptional is refused.
--
-- 4. desk_slice_object_write: the object slices (Masters' schoolProfile,
--    schoolTiming, midYearFeePolicy, statutoryConfig and the desks' own
--    object slices), base = the slice's updated_at.

-- ── 1. The allowlist names its change signal ──────────────────────────────

alter table public.desk_writable_tables
  add column if not exists sync_meta_table text,
  add column if not exists sync_count_column text;

comment on column public.desk_writable_tables.sync_meta_table is
  'The *_sync_meta table desk_write_guarded bumps (updated_at) in the same '
  'transaction as every applied op — the desk''s key in erp_versions.';
comment on column public.desk_writable_tables.sync_count_column is
  'The column of sync_meta_table that holds this table''s live row count for the tenant.';

create table if not exists public.website_desk_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  page_count int not null default 0,
  block_count int not null default 0,
  media_count int not null default 0,
  menu_count int not null default 0,
  publication_count int not null default 0,
  updated_at timestamptz not null default now()
);
comment on table public.website_desk_sync_meta is
  'Change signal for the website tables (site_*), bumped by desk_write_guarded (data-layer 1.5).';

create table if not exists public.udise_sheet_desk_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  sheet_count int not null default 0,
  row_count int not null default 0,
  updated_at timestamptz not null default now()
);
comment on table public.udise_sheet_desk_sync_meta is
  'Change signal for the UDISE+ working sheet (udise_upload_*), bumped by desk_write_guarded (data-layer 1.5).';

alter table public.website_desk_sync_meta enable row level security;
alter table public.udise_sheet_desk_sync_meta enable row level security;
revoke all on public.website_desk_sync_meta from public, anon, authenticated;
revoke all on public.udise_sheet_desk_sync_meta from public, anon, authenticated;
-- desk_write_guarded is SECURITY INVOKER (service_role): it needs these.
grant select, insert, update, delete on public.website_desk_sync_meta to service_role;
grant select, insert, update, delete on public.udise_sheet_desk_sync_meta to service_role;

update public.desk_writable_tables set sync_meta_table = 'sis_sync_meta', sync_count_column = 'student_count'
 where table_name = 'sis_students';
update public.desk_writable_tables set sync_meta_table = 'sis_sync_meta', sync_count_column = 'household_count'
 where table_name = 'sis_households';
update public.desk_writable_tables set sync_meta_table = 'website_desk_sync_meta', sync_count_column = 'page_count'
 where table_name = 'site_pages';
update public.desk_writable_tables set sync_meta_table = 'website_desk_sync_meta', sync_count_column = 'block_count'
 where table_name = 'site_blocks';
update public.desk_writable_tables set sync_meta_table = 'website_desk_sync_meta', sync_count_column = 'media_count'
 where table_name = 'site_media';
update public.desk_writable_tables set sync_meta_table = 'website_desk_sync_meta', sync_count_column = 'menu_count'
 where table_name = 'site_menu';
update public.desk_writable_tables set sync_meta_table = 'website_desk_sync_meta', sync_count_column = 'publication_count'
 where table_name = 'site_publications';
update public.desk_writable_tables set sync_meta_table = 'udise_sheet_desk_sync_meta', sync_count_column = 'sheet_count'
 where table_name = 'udise_upload_sheets';
update public.desk_writable_tables set sync_meta_table = 'udise_sheet_desk_sync_meta', sync_count_column = 'row_count'
 where table_name = 'udise_upload_rows';

-- Derived tables are not written directly (see the header).
delete from public.desk_writable_tables where table_name like 'masters\_desk\_%' escape '\';

-- ── 2. desk_write_guarded v3 ──────────────────────────────────────────────

create or replace function public.desk_write_guarded(
  p_tenant_id uuid, p_table text, p_ops jsonb default '[]'::jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_soft boolean; v_meta text; v_count_col text; v_has_deleted boolean;
  v_cols text; v_set text;
  item jsonb; v_op text; rec_id text; base_txt text; payload jsonb; incoming jsonb; existing jsonb;
  base_ts timestamptz; stored_ts timestamptz; now_ts timestamptz := clock_timestamp();
  plan jsonb := '[]'::jsonb; step jsonb;
  results jsonb := '[]'::jsonb; refused jsonb := '[]'::jsonb; versions jsonb := '{}'::jsonb;
  n_applied int := 0; n_unchanged int := 0; n_deleted int := 0;
begin
  select t.soft_delete, t.sync_meta_table, t.sync_count_column
    into v_soft, v_meta, v_count_col
    from public.desk_writable_tables t where t.table_name = p_table;
  if not found then
    raise exception 'desk_write_guarded: table % is not writable', p_table using errcode = '42501';
  end if;
  if p_tenant_id is null then
    raise exception 'desk_write_guarded: tenant_id is required' using errcode = '22004';
  end if;
  if jsonb_typeof(coalesce(p_ops, '[]'::jsonb)) <> 'array' then
    raise exception 'desk_write_guarded: ops must be an array' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_ops,'[]'::jsonb)) x
              where nullif(x->>'id','') is not null
              group by x->>'id' having count(*) > 1) then
    raise exception 'desk_write_guarded: an id appears twice in one batch' using errcode = '22023';
  end if;

  select exists (select 1 from information_schema.columns c
     where c.table_schema='public' and c.table_name=p_table and c.column_name='deleted_at')
    into v_has_deleted;

  -- Pass 1: lock every named row and judge every op. Nothing is written.
  for item in select * from jsonb_array_elements(coalesce(p_ops,'[]'::jsonb)) loop
    v_op := coalesce(item->>'op','upsert');
    if v_op not in ('upsert','delete') then
      raise exception 'desk_write_guarded: unknown op %', v_op using errcode = '22023';
    end if;
    rec_id := nullif(item->>'id','');
    if rec_id is null then
      raise exception 'desk_write_guarded: every op needs an id' using errcode = '22023';
    end if;
    base_txt := nullif(item->>'base','');
    base_ts := base_txt::timestamptz;

    execute format('select to_jsonb(t) from public.%I t where t.id = $1 and t.tenant_id = $2 for update', p_table)
      into existing using rec_id, p_tenant_id;

    if existing is null then
      if v_op = 'delete' then
        plan := plan || jsonb_build_array(jsonb_build_object('kind','noop_delete','id',rec_id));
      elsif base_ts is not null then
        -- Edited from a copy of a row that has since been removed.
        refused := refused || jsonb_build_array(jsonb_build_object(
          'id',rec_id,'status','conflict','reason','deleted','revision',null,'stored',null));
      else
        payload := item->'row';
        if payload is null or jsonb_typeof(payload) <> 'object' then
          raise exception 'desk_write_guarded: upsert % has no row object', rec_id using errcode = '22023';
        end if;
        plan := plan || jsonb_build_array(jsonb_build_object('kind','write','id',rec_id,
          'row', payload || jsonb_build_object('id',rec_id,'tenant_id',p_tenant_id)));
      end if;
      continue;
    end if;

    stored_ts := (existing->>'updated_at')::timestamptz;
    if base_ts is null then
      refused := refused || jsonb_build_array(jsonb_build_object(
        'id',rec_id,'status','conflict','reason','unversioned','revision',existing->'updated_at','stored',existing));
      continue;
    end if;
    if stored_ts is distinct from base_ts then
      refused := refused || jsonb_build_array(jsonb_build_object(
        'id',rec_id,'status','conflict','reason','stale','revision',existing->'updated_at','stored',existing));
      continue;
    end if;

    if v_op = 'delete' then
      plan := plan || jsonb_build_array(jsonb_build_object('kind','delete','id',rec_id,'stored_ts',stored_ts));
      continue;
    end if;

    payload := item->'row';
    if payload is null or jsonb_typeof(payload) <> 'object' then
      raise exception 'desk_write_guarded: upsert % has no row object', rec_id using errcode = '22023';
    end if;
    -- Patch, not replace: an absent key keeps its stored value.
    incoming := existing || payload || jsonb_build_object('id',rec_id,'tenant_id',p_tenant_id);
    if (existing - 'updated_at') = (incoming - 'updated_at') then
      plan := plan || jsonb_build_array(jsonb_build_object('kind','unchanged','id',rec_id,
        'revision',existing->'updated_at'));
    else
      plan := plan || jsonb_build_array(jsonb_build_object('kind','write','id',rec_id,
        'row',incoming,'stored_ts',stored_ts));
    end if;
  end loop;

  if jsonb_array_length(refused) > 0 then
    return jsonb_build_object('ok', false, 'table', p_table,
      'applied',0,'unchanged',0,'deleted',0,
      'conflicts',jsonb_array_length(refused),
      'unversioned',(select count(*) from jsonb_array_elements(refused) r where r->>'reason'='unversioned'),
      'results',refused,'versions','{}'::jsonb);
  end if;

  -- Pass 2: apply.
  for step in select * from jsonb_array_elements(plan) loop
    rec_id := step->>'id';
    stored_ts := (step->>'stored_ts')::timestamptz;
    if stored_ts is not null and stored_ts >= now_ts then now_ts := stored_ts + interval '1 microsecond'; end if;

    if step->>'kind' = 'noop_delete' then
      results := results || jsonb_build_array(jsonb_build_object('id',rec_id,'status','deleted'));
    elsif step->>'kind' = 'unchanged' then
      n_unchanged := n_unchanged + 1;
      versions := versions || jsonb_build_object(rec_id, step->'revision');
      results := results || jsonb_build_array(jsonb_build_object(
        'id',rec_id,'status','unchanged','revision',step->'revision'));
    elsif step->>'kind' = 'delete' then
      if v_soft and v_has_deleted then
        execute format('update public.%I set deleted_at=$1, updated_at=$1 where id=$2 and tenant_id=$3', p_table)
          using now_ts, rec_id, p_tenant_id;
        versions := versions || jsonb_build_object(rec_id, now_ts);
        results := results || jsonb_build_array(jsonb_build_object('id',rec_id,'status','deleted','revision',now_ts));
      else
        execute format('delete from public.%I where id=$1 and tenant_id=$2', p_table)
          using rec_id, p_tenant_id;
        results := results || jsonb_build_array(jsonb_build_object('id',rec_id,'status','deleted'));
      end if;
      n_deleted := n_deleted + 1;
    else
      incoming := (step->'row') || jsonb_build_object('updated_at', now_ts);
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
    end if;
  end loop;

  -- The change signal moves with the data, in this transaction.
  if v_meta is not null and (n_applied + n_deleted) > 0 then
    execute format(
      'insert into public.%I as m (tenant_id, updated_at) values ($1, $2) '
      'on conflict (tenant_id) do update set updated_at = greatest(excluded.updated_at, m.updated_at + interval ''1 microsecond'')',
      v_meta) using p_tenant_id, now_ts;
    if v_count_col is not null then
      execute format('update public.%I set %I = (select count(*) from public.%I x where x.tenant_id = $1%s) where tenant_id = $1',
        v_meta, v_count_col, p_table, case when v_has_deleted then ' and x.deleted_at is null' else '' end)
        using p_tenant_id;
    end if;
    if p_table = 'sis_students' then
      update public.sis_sync_meta
         set active_student_count = (select count(*) from public.sis_students s
                                      where s.tenant_id = p_tenant_id and s.status = 'active')
       where tenant_id = p_tenant_id;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'table', p_table,
    'applied',n_applied,'unchanged',n_unchanged,'deleted',n_deleted,
    'conflicts',0,'unversioned',0,
    'results',results,'versions',versions);
end $$;

revoke all on function public.desk_write_guarded(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.desk_write_guarded(uuid, text, jsonb) to service_role;

-- ── 3. Slices: shared pieces ──────────────────────────────────────────────

-- The 16 slice tables (production, 14 Oct 2026). A name not here is refused.
create or replace function public._desk_slice_table_ok(p_table text)
returns boolean language sql immutable set search_path = public as $$
  select p_table = any (array[
    'automation_desk_slices','certificates_desk_slices','erp_chat_desk_slices',
    'exam_papers_desk_slices','fee_recovery_tasks_desk_slices','masters_desk_slices',
    'module_registry_desk_slices','rbac_desk_slices','staff_advances_desk_slices',
    'staff_agreements_desk_slices','staff_chat_desk_slices','staff_hr_desk_slices',
    'timetable_desk_slices','transport_desk_slices','trust_desk_slices',
    'wa_templates_desk_slices'])
$$;

-- Object slices (not lists). Everything else written here is an array slice.
create or replace function public._desk_slice_is_object(p_table text, p_key text)
returns boolean language sql immutable set search_path = public as $$
  select (p_table, p_key) in (
    ('masters_desk_slices','midYearFeePolicy'), ('masters_desk_slices','schoolProfile'),
    ('masters_desk_slices','schoolTiming'), ('masters_desk_slices','statutoryConfig'),
    ('rbac_desk_slices','mobile'), ('exam_papers_desk_slices','importMappings'),
    ('wa_templates_desk_slices','lastMetaSyncAt'), ('staff_hr_desk_slices','leaveSettings'),
    ('module_registry_desk_slices','enabled'), ('automation_desk_slices','lastTickAt'),
    ('transport_desk_slices','feePolicy'), ('timetable_desk_slices','config'))
$$;

-- Bump <desk>_desk_sync_meta: updated_at (strictly later), last_updated_at and
-- the desk's count columns, computed from the slices as the TypeScript
-- writers compute them (mastersNormalized/timetableNormalized/
-- transportNormalized/trustNormalized/deskSliceNormalized .server.ts).
create or replace function public._desk_slice_meta_bump(p_tenant uuid, p_table text, p_now timestamptz)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  v_meta text := regexp_replace(p_table, '_desk_slices$', '_desk_sync_meta');
  v_len jsonb;
  v_cols text[] := array[]::text[];
  v_vals int[] := array[]::int[];
  v_sql text;
  v_out timestamptz;
  i int;
begin
  execute format(
    'select coalesce(jsonb_object_agg(slice_key, case when jsonb_typeof(payload) = ''array'' then jsonb_array_length(payload) '
    'when payload is null or payload = ''null''::jsonb or payload = ''""''::jsonb then 0 else 1 end), ''{}''::jsonb) '
    'from public.%I where tenant_id = $1', p_table) into v_len using p_tenant;

  if p_table = 'masters_desk_slices' then
    v_cols := array['class_count','fee_head_count','subject_count'];
    v_vals := array[coalesce((v_len->>'classes')::int,0), coalesce((v_len->>'feeHeads')::int,0),
                    coalesce((v_len->>'subjects')::int,0)];
  elsif p_table = 'timetable_desk_slices' then
    v_cols := array['grid_count','published_grid_count','substitution_count'];
    v_vals := array[coalesce((v_len->>'grids')::int,0), coalesce((v_len->>'publishedGrids')::int,0),
                    coalesce((v_len->>'substitutions')::int,0)];
  elsif p_table = 'transport_desk_slices' then
    v_cols := array['route_count','vehicle_count','assignment_count'];
    v_vals := array[coalesce((v_len->>'routes')::int,0), coalesce((v_len->>'vehicles')::int,0),
                    coalesce((v_len->>'assignments')::int,0)];
  elsif p_table = 'trust_desk_slices' then
    v_cols := array['project_count','work_item_count'];
    v_vals := array[coalesce((v_len->>'projects')::int,0), coalesce((v_len->>'workItems')::int,0)];
  else
    v_cols := array['row_count'];
    v_vals := array[(select coalesce(sum(value::int),0)::int from jsonb_each_text(v_len))];
  end if;

  v_sql := format('insert into public.%I as m (tenant_id, updated_at, last_updated_at', v_meta);
  for i in 1 .. array_length(v_cols, 1) loop v_sql := v_sql || format(', %I', v_cols[i]); end loop;
  v_sql := v_sql || ') values ($1, $2, $2';
  for i in 1 .. array_length(v_cols, 1) loop v_sql := v_sql || format(', %s', v_vals[i]); end loop;
  v_sql := v_sql || ') on conflict (tenant_id) do update set '
    || 'updated_at = greatest(excluded.updated_at, m.updated_at + interval ''1 microsecond''), '
    || 'last_updated_at = excluded.last_updated_at';
  for i in 1 .. array_length(v_cols, 1) loop v_sql := v_sql || format(', %I = excluded.%I', v_cols[i], v_cols[i]); end loop;
  v_sql := v_sql || ' returning m.updated_at';
  execute v_sql into v_out using p_tenant, p_now;
  return v_out;
end $$;

revoke all on function public._desk_slice_table_ok(text) from public, anon, authenticated;
revoke all on function public._desk_slice_is_object(text, text) from public, anon, authenticated;
revoke all on function public._desk_slice_meta_bump(uuid, text, timestamptz) from public, anon, authenticated;

-- ── 3. desk_slice_row_write ───────────────────────────────────────────────

create or replace function public.desk_slice_row_write(
  p_tenant uuid, p_table text, p_slice_key text, p_op text, p_id text,
  p_row jsonb, p_base text, p_key text default 'id')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_mode text;            -- 'slice' (base = slice updated_at) | 'rev' (base = element _rev)
  v_payload jsonb; v_stored_at timestamptz; v_found boolean := false;
  v_idx int; v_el jsonb; v_cur_rev int := 0; v_new jsonb; v_new_rev int;
  v_base text := nullif(btrim(coalesce(p_base, '')), '');
  v_base_rev int;
  v_now timestamptz := clock_timestamp();
  v_written_at timestamptz;
  v_arr jsonb;
  v_sync jsonb;
begin
  if p_tenant is null then
    raise exception 'desk_slice_row_write: tenant is required' using errcode = '22004';
  end if;
  if not public._desk_slice_table_ok(p_table) then
    raise exception 'desk_slice_row_write: % is not a slice table', p_table using errcode = '42501';
  end if;
  if p_slice_key is null or p_slice_key !~ '^[A-Za-z][A-Za-z0-9_]*$' then
    raise exception 'desk_slice_row_write: bad slice key' using errcode = '22023';
  end if;
  if public._desk_slice_is_object(p_table, p_slice_key) then
    raise exception 'desk_slice_row_write: % is an object slice — use desk_slice_object_write', p_slice_key using errcode = '22023';
  end if;
  -- Staff-owned Masters lists live in sis_staff/sis_departments/sis_designations;
  -- `students` is SIS's projection. Neither is written as a Masters element.
  if p_table = 'masters_desk_slices' and p_slice_key in ('staff','departments','designations','students') then
    raise exception 'desk_slice_row_write: masters.% is not written here', p_slice_key using errcode = '42501';
  end if;
  if p_key is null or p_key !~ '^[A-Za-z_][A-Za-z0-9_]*$' then
    raise exception 'desk_slice_row_write: bad key field' using errcode = '22023';
  end if;
  if p_op not in ('upsert','delete') then
    raise exception 'desk_slice_row_write: unknown op %', p_op using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_id,'')),'') is null then
    raise exception 'desk_slice_row_write: an element needs an id' using errcode = '22023';
  end if;

  v_mode := case when p_table in ('masters_desk_slices','timetable_desk_slices') then 'slice' else 'rev' end;

  -- Lock: an advisory lock covers a slice row that does not exist yet; FOR
  -- UPDATE (as masters_write_slices) holds the row against every other writer.
  perform pg_advisory_xact_lock(hashtext(p_table), hashtext(p_tenant::text || '/' || p_slice_key));
  execute format('select payload, updated_at, true from public.%I where tenant_id = $1 and slice_key = $2 for update', p_table)
    into v_payload, v_stored_at, v_found using p_tenant, p_slice_key;
  v_found := coalesce(v_found, false);
  if not v_found then v_payload := '[]'::jsonb; end if;
  if jsonb_typeof(v_payload) <> 'array' then
    raise exception 'desk_slice_row_write: %.% is not a list', p_table, p_slice_key using errcode = '22023';
  end if;

  select e.ord - 1, e.el into v_idx, v_el
    from jsonb_array_elements(v_payload) with ordinality as e(el, ord)
   where jsonb_typeof(e.el) = 'object' and e.el->>p_key = p_id
   limit 1;
  if v_el is not null then
    v_cur_rev := case when jsonb_typeof(v_el->'_rev') = 'number' and (v_el->>'_rev')::numeric > 0
                      then floor((v_el->>'_rev')::numeric)::int else 0 end;
  end if;

  -- A delete of an element that is not there: nothing to do, nothing moves.
  if p_op = 'delete' and v_el is null then
    return jsonb_build_object('ok', true, 'status', 'deleted', 'changed', false,
      'revision', v_stored_at, 'rev', null);
  end if;

  -- ── Base check ──
  if v_mode = 'slice' then
    if v_found and v_base is null then
      return jsonb_build_object('ok', false, 'status', 'conflict', 'reason', 'unversioned',
        'revision', v_stored_at, 'stored', v_el);
    end if;
    if v_base is not null and (not v_found or v_stored_at is distinct from v_base::timestamptz) then
      return jsonb_build_object('ok', false, 'status', 'conflict', 'reason', case when v_found then 'stale' else 'deleted' end,
        'revision', v_stored_at, 'stored', v_el);
    end if;
  else
    if v_base is not null and v_base !~ '^[0-9]+$' then
      raise exception 'desk_slice_row_write: base for %.% is an element _rev (a whole number)', p_table, p_slice_key
        using errcode = '22023';
    end if;
    v_base_rev := v_base::int;
    if v_el is null then
      if coalesce(v_base_rev, 0) <> 0 then
        return jsonb_build_object('ok', false, 'status', 'conflict', 'reason', 'deleted',
          'revision', v_stored_at, 'rev', null, 'stored', null);
      end if;
    else
      if v_base_rev is null then
        return jsonb_build_object('ok', false, 'status', 'conflict', 'reason', 'unversioned',
          'revision', v_stored_at, 'rev', v_cur_rev, 'stored', v_el);
      end if;
      if v_base_rev <> v_cur_rev then
        return jsonb_build_object('ok', false, 'status', 'conflict', 'reason', 'stale',
          'revision', v_stored_at, 'rev', v_cur_rev, 'stored', v_el);
      end if;
    end if;
  end if;

  -- ── The new list ──
  if p_op = 'delete' then
    select coalesce(jsonb_agg(e.el order by e.ord), '[]'::jsonb) into v_arr
      from jsonb_array_elements(v_payload) with ordinality as e(el, ord)
     where e.ord - 1 <> v_idx;
    v_new := null;
  else
    if p_row is null or jsonb_typeof(p_row) <> 'object' then
      raise exception 'desk_slice_row_write: upsert needs a row object' using errcode = '22023';
    end if;
    if p_row ? p_key and p_row->>p_key is distinct from p_id then
      raise exception 'desk_slice_row_write: the row''s % does not match the op''s id', p_key using errcode = '22023';
    end if;
    -- Patch, not replace; the server owns _rev.
    v_new := coalesce(v_el, '{}'::jsonb) || (p_row - '_rev') || jsonb_build_object(p_key, p_id);
    v_new := v_new - '_rev';
    if p_table = 'masters_desk_slices' and p_slice_key = 'classSubjects' then
      if not (v_new ? 'isOptional') or v_new->'isOptional' = 'null'::jsonb then
        v_new := v_new || jsonb_build_object('isOptional', false);
      elsif jsonb_typeof(v_new->'isOptional') <> 'boolean' then
        raise exception 'desk_slice_row_write: classSubjects.isOptional must be true or false' using errcode = '22023';
      end if;
    end if;
    if v_el is not null and (v_el - '_rev') = v_new then
      return jsonb_build_object('ok', true, 'status', 'unchanged', 'changed', false,
        'revision', v_stored_at, 'rev', case when v_mode = 'rev' then v_cur_rev end, 'element', v_el);
    end if;
    if v_mode = 'rev' then
      v_new_rev := case when v_el is null then 1 else v_cur_rev + 1 end;
      v_new := v_new || jsonb_build_object('_rev', v_new_rev);
    end if;
    if v_el is null then
      v_arr := v_payload || jsonb_build_array(v_new);
    else
      v_arr := jsonb_set(v_payload, array[v_idx::text], v_new);
    end if;
  end if;

  v_written_at := case when v_stored_at is not null and v_stored_at >= v_now
                       then v_stored_at + interval '1 microsecond' else v_now end;
  execute format(
    'insert into public.%I (tenant_id, slice_key, payload, updated_at) values ($1, $2, $3, $4) '
    'on conflict (tenant_id, slice_key) do update set payload = excluded.payload, updated_at = excluded.updated_at',
    p_table) using p_tenant, p_slice_key, v_arr, v_written_at;

  perform public._desk_slice_meta_bump(p_tenant, p_table, v_written_at);

  if p_table = 'masters_desk_slices' then
    -- Same transaction: if the row tables refuse this slice, nothing lands.
    v_sync := public.masters_sync_rows_from_slices(p_tenant);
  end if;

  return jsonb_build_object('ok', true,
    'status', case when p_op = 'delete' then 'deleted' else 'applied' end,
    'changed', true,
    'revision', v_written_at,
    'rev', case when v_mode = 'rev' and p_op = 'upsert' then v_new_rev end,
    'element', v_new);
end $$;

revoke all on function public.desk_slice_row_write(uuid, text, text, text, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.desk_slice_row_write(uuid, text, text, text, text, jsonb, text, text) to service_role;

-- ── 4. desk_slice_object_write ────────────────────────────────────────────

create or replace function public.desk_slice_object_write(
  p_tenant uuid, p_table text, p_slice_key text, p_value jsonb, p_base text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_payload jsonb; v_stored_at timestamptz; v_found boolean := false;
  v_base text := nullif(btrim(coalesce(p_base, '')), '');
  v_now timestamptz := clock_timestamp();
  v_written_at timestamptz;
  v_sync jsonb;
begin
  if p_tenant is null then
    raise exception 'desk_slice_object_write: tenant is required' using errcode = '22004';
  end if;
  if not public._desk_slice_table_ok(p_table) then
    raise exception 'desk_slice_object_write: % is not a slice table', p_table using errcode = '42501';
  end if;
  if not public._desk_slice_is_object(p_table, p_slice_key) then
    raise exception 'desk_slice_object_write: %.% is not an object slice', p_table, p_slice_key using errcode = '42501';
  end if;
  if p_value is null or p_value = 'null'::jsonb or jsonb_typeof(p_value) = 'array' then
    raise exception 'desk_slice_object_write: a value is required (not null, not a list)' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_table), hashtext(p_tenant::text || '/' || p_slice_key));
  execute format('select payload, updated_at, true from public.%I where tenant_id = $1 and slice_key = $2 for update', p_table)
    into v_payload, v_stored_at, v_found using p_tenant, p_slice_key;
  v_found := coalesce(v_found, false);

  if v_found and v_base is null then
    return jsonb_build_object('ok', false, 'status', 'conflict', 'reason', 'unversioned',
      'revision', v_stored_at, 'stored', v_payload);
  end if;
  if v_base is not null and (not v_found or v_stored_at is distinct from v_base::timestamptz) then
    return jsonb_build_object('ok', false, 'status', 'conflict', 'reason', case when v_found then 'stale' else 'deleted' end,
      'revision', v_stored_at, 'stored', v_payload);
  end if;
  if v_found and v_payload = p_value then
    return jsonb_build_object('ok', true, 'status', 'unchanged', 'changed', false,
      'revision', v_stored_at, 'value', v_payload);
  end if;

  v_written_at := case when v_stored_at is not null and v_stored_at >= v_now
                       then v_stored_at + interval '1 microsecond' else v_now end;
  execute format(
    'insert into public.%I (tenant_id, slice_key, payload, updated_at) values ($1, $2, $3, $4) '
    'on conflict (tenant_id, slice_key) do update set payload = excluded.payload, updated_at = excluded.updated_at',
    p_table) using p_tenant, p_slice_key, p_value, v_written_at;

  perform public._desk_slice_meta_bump(p_tenant, p_table, v_written_at);
  if p_table = 'masters_desk_slices' then
    v_sync := public.masters_sync_rows_from_slices(p_tenant);
  end if;

  return jsonb_build_object('ok', true, 'status', 'applied', 'changed', true,
    'revision', v_written_at, 'value', p_value);
end $$;

revoke all on function public.desk_slice_object_write(uuid, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.desk_slice_object_write(uuid, text, text, jsonb, text) to service_role;

notify pgrst, 'reload schema';
