-- data-layer step 2.2a — the database part of 2.2 (docs/data-layer-rebuild/COMMAND.md §4 2.2).
--
-- APPLY TO PRODUCTION BEFORE THE APP THAT CALLS IT (2.2b) IS DEPLOYED. Idempotent:
-- every statement is create-or-replace / if-not-exists / on-conflict, so a second
-- run changes nothing. Nothing in the app calls the new functions yet; the only
-- behaviour live code can see is section 1 (Masters list elements carry `_rev`).
--
-- The director's decisions (20 Oct 2026):
--
-- 1. Masters list elements carry a per-element `_rev`. desk_slice_row_write on
--    masters_desk_slices compares-and-sets ONE element: two people editing
--    different subjects / sections / fee heads both land; only the same element
--    at once conflicts. (Until now the base was the slice's updated_at, so any
--    two edits of one list conflicted.)
--      - The base is the element's `_rev` (a whole number; absent = 0). The old
--        base — the slice's updated_at — is still accepted for Masters so that
--        today's registry (lib/data/registry.ts, base:"slice") keeps working
--        until 2.2b flips it to "rev"; it is the stricter check, and the
--        element's `_rev` moves either way.
--      - The "ABA" guard: every write to masters_desk_slices — the kernel, the
--        old whole-slice path (pushMastersSlicesToDb → masters_write_slices),
--        the old whole-book path (pushMastersDeskToDb's upsert), a script — goes
--        through the trigger masters_desk_slices_carry_revs, which does in SQL
--        what lib/sliceRevMerge.ts mergeWithRevs does without a base: an
--        element whose content (without `_rev`) is unchanged keeps the stored
--        element exactly; a changed element gets the STORED `_rev` + 1; a new
--        element gets max(its `_rev`, 1). A writer's own `_rev` on an existing
--        element is ignored, so a copy that lost or never had `_rev` can never
--        reset an element to a number an older copy still holds.
--      - masters_sync_rows_from_slices ignores `_rev`: it copies only keys that
--        are columns of the row tables, and no masters_desk_* table has a
--        `_rev` column (asserted by the SQL test).
--    Timetable keeps the slice stamp as its base (its elements carry no `_rev`).
--
-- 2. desk_slice_rows_write: an all-or-none batch of element writes (the fee-setup
--    clone), each element with its own `_rev` base. One conflict or one bad
--    element and nothing is written. One sync_meta bump (and, for Masters, one
--    row-table sync) for the whole batch.
--
-- 3. masters_series_bump(p_tenant, p_series, p_used[, p_ay]): a number series
--    moves monotonically to max(stored next, used + 1) under the slice lock. No
--    base: two counters issuing numbers at once both land and the series ends
--    past both.
--
-- 4. Staff rows through the kernel: sis_staff, sis_departments, sis_designations
--    join desk_writable_tables with NO sync_meta table — erp_versions (step 1.3)
--    already reports each of them from the table itself (group 2:
--    max(updated_at) + count(*)), and a *_sync_meta table named after them would
--    produce a second key of the same name. Every applied op sets the row's
--    updated_at, so its erp_versions value moves in the same transaction.
--      - Staff Remove is a SOFT remove (director's choice): sis_staff gains
--        deleted_at + deleted_by; a delete op sets both (deleted_by = the op's
--        `by`, which the server fills from the session and which is required),
--        repo.list already hides deleted_at rows for a softDelete collection, and
--        an upsert with the row's revision and deleted_at:null restores it
--        (deleted_by is cleared). An upsert cannot SET deleted_at (a removal must
--        be a delete, with who). Nothing is hard-deleted.
--        sis_departments / sis_designations keep a hard delete (they have
--        is_active for retiring one); 2.2b decides whether the UI deletes or
--        retires.
--      - Sensitive staff fields — bank details, UPI id, Aadhaar, PAN, basic pay,
--        visiting pay (keys of sis_staff.profile, listed in
--        _sis_staff_sensitive_keys) — are refused (42501, nothing written) by the
--        generic kernel path. Only sis_staff_write_sensitive(p_tenant, p_ops,
--        p_authority, p_actor) can change them: it marks this transaction with
--        the authority ('owner' | 'payroll' | 'accounts') and the actor, calls
--        desk_write_guarded, and every sensitive change is recorded in
--        sis_staff_sensitive_changes (field NAMES, who, on what authority —
--        never the values). The generic route (POST /api/data/sis.staff →
--        repo.write → desk_write_guarded) has no way to pass the mark, so a
--        caller that only holds staff edit cannot change these fields. 2.2b's
--        route calls sis_staff_write_sensitive only after its own check that the
--        session is the owner or holds the payroll or accounts function.
--
-- Every function: search_path = public; executable by service_role only (the
-- internal helpers by nobody but their owner). Every new table: RLS on, revoked
-- from public/anon/authenticated, granted to service_role (the repo gotcha:
-- this project has no default privileges).

-- ── 1. Masters elements carry `_rev`: the ABA guard on every writer ──────────

create or replace function public._masters_slice_carry_revs()
returns trigger language plpgsql set search_path = public as $$
declare
  v_old jsonb := '{}'::jsonb;   -- id -> the stored element (the first one with that id)
begin
  if new.payload is null or jsonb_typeof(new.payload) <> 'array' then
    return new;
  end if;
  -- The stored list as an id-keyed object: one lookup per new element, not a
  -- scan of the stored list per element (3,000 elements: ~10 ms, not ~350 ms).
  -- jsonb_object_agg keeps the LAST value of a repeated key, so aggregate in
  -- reverse order and the first stored element with an id wins.
  if tg_op = 'UPDATE' and jsonb_typeof(old.payload) = 'array' then
    select coalesce(jsonb_object_agg(x.el->>'id', x.el order by x.ord desc), '{}'::jsonb) into v_old
      from jsonb_array_elements(old.payload) with ordinality as x(el, ord)
     where jsonb_typeof(x.el) = 'object' and nullif(x.el->>'id', '') is not null;
  end if;
  new.payload := (
    select coalesce(jsonb_agg(
      case
        when jsonb_typeof(e.el) <> 'object' or nullif(e.el->>'id', '') is null then e.el
        when o.el is null then
          (e.el - '_rev') || jsonb_build_object('_rev', greatest(
            case when jsonb_typeof(e.el->'_rev') = 'number' and (e.el->>'_rev')::numeric > 0
                 then floor((e.el->>'_rev')::numeric)::int else 0 end, 1))
        when (o.el - '_rev') = (e.el - '_rev') then o.el
        else (e.el - '_rev') || jsonb_build_object('_rev',
            case when jsonb_typeof(o.el->'_rev') = 'number' and (o.el->>'_rev')::numeric > 0
                 then floor((o.el->>'_rev')::numeric)::int else 0 end + 1)
      end order by e.ord), '[]'::jsonb)
    from jsonb_array_elements(new.payload) with ordinality as e(el, ord)
    cross join lateral (select case when jsonb_typeof(e.el) = 'object' then v_old->(e.el->>'id') end as el) o);
  return new;
end $$;

revoke all on function public._masters_slice_carry_revs() from public, anon, authenticated;

drop trigger if exists masters_desk_slices_carry_revs on public.masters_desk_slices;
create trigger masters_desk_slices_carry_revs
  before insert or update of payload on public.masters_desk_slices
  for each row execute function public._masters_slice_carry_revs();

-- ── 2. One element: the shared apply step ───────────────────────────────────
--
-- Validates, locks, checks the base and writes ONE element of a list slice
-- (and the slice's new updated_at). It does NOT bump <desk>_desk_sync_meta or
-- sync the Masters row tables — the public entry points do that once per call
-- (desk_slice_row_write) or once per batch (desk_slice_rows_write).
-- Not executable by anyone but its owner.

create or replace function public._desk_slice_element_apply(
  p_tenant uuid, p_table text, p_slice_key text, p_op text, p_id text,
  p_row jsonb, p_base text, p_key text default 'id')
returns jsonb language plpgsql set search_path = public as $$
declare
  v_mode text;            -- 'slice' (base = slice updated_at) | 'rev' (base = element _rev)
  v_tracks_rev boolean;   -- the element carries _rev (every table but timetable)
  v_payload jsonb; v_stored_at timestamptz; v_found boolean := false;
  v_idx int; v_el jsonb; v_cur_rev int := 0; v_new jsonb; v_new_rev int;
  v_base text := nullif(btrim(coalesce(p_base, '')), '');
  v_base_rev int;
  v_now timestamptz := clock_timestamp();
  v_written_at timestamptz;
  v_arr jsonb;
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
  if p_op is null or p_op not in ('upsert','delete') then
    raise exception 'desk_slice_row_write: unknown op %', p_op using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_id,'')),'') is null then
    raise exception 'desk_slice_row_write: an element needs an id' using errcode = '22023';
  end if;

  v_tracks_rev := p_table <> 'timetable_desk_slices';
  -- Masters (2.2a): the element's _rev; the slice stamp (a timestamp) is still
  -- accepted until 2.2b moves the registry to "rev". Timetable: the stamp.
  v_mode := case
    when p_table = 'timetable_desk_slices' then 'slice'
    when p_table = 'masters_desk_slices' and v_base is not null and v_base !~ '^[0-9]+$' then 'slice'
    else 'rev' end;

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
   order by e.ord
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
        'revision', v_stored_at, 'rev', case when v_tracks_rev and v_el is not null then v_cur_rev end, 'stored', v_el);
    end if;
    if v_base is not null and (not v_found or v_stored_at is distinct from v_base::timestamptz) then
      return jsonb_build_object('ok', false, 'status', 'conflict', 'reason', case when v_found then 'stale' else 'deleted' end,
        'revision', v_stored_at, 'rev', case when v_tracks_rev and v_el is not null then v_cur_rev end, 'stored', v_el);
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
        'revision', v_stored_at, 'rev', case when v_tracks_rev then v_cur_rev end, 'element', v_el);
    end if;
    if v_tracks_rev then
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

  return jsonb_build_object('ok', true,
    'status', case when p_op = 'delete' then 'deleted' else 'applied' end,
    'changed', true,
    'revision', v_written_at,
    'rev', case when v_tracks_rev and p_op = 'upsert' then v_new_rev end,
    'element', v_new);
end $$;

revoke all on function public._desk_slice_element_apply(uuid, text, text, text, text, jsonb, text, text) from public, anon, authenticated;

-- ── 3. desk_slice_row_write (same signature and outcomes as 1.5) ─────────────

create or replace function public.desk_slice_row_write(
  p_tenant uuid, p_table text, p_slice_key text, p_op text, p_id text,
  p_row jsonb, p_base text, p_key text default 'id')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  v_sync jsonb;
begin
  r := public._desk_slice_element_apply(p_tenant, p_table, p_slice_key, p_op, p_id, p_row, p_base, p_key);
  if coalesce((r->>'changed')::boolean, false) then
    perform public._desk_slice_meta_bump(p_tenant, p_table, (r->>'revision')::timestamptz);
    if p_table = 'masters_desk_slices' then
      -- Same transaction: if the row tables refuse this slice, nothing lands.
      v_sync := public.masters_sync_rows_from_slices(p_tenant);
    end if;
  end if;
  return r;
end $$;

revoke all on function public.desk_slice_row_write(uuid, text, text, text, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.desk_slice_row_write(uuid, text, text, text, text, jsonb, text, text) to service_role;

-- ── 4. desk_slice_rows_write: all or none ────────────────────────────────────
--
-- p_ops: [{ "slice": <slice key>, "op": "upsert"|"delete", "id": text,
--           "row": {…}, "base": <the element's _rev, "0"/null for a new one>,
--           "key": <key field, default "id"> }, …]   (1–500 ops)
-- Every op is applied in order inside one sub-transaction; if any comes back
-- as a conflict the sub-transaction is rolled back and the answer lists every
-- op's outcome (ok:false); an op that is invalid raises and the whole call
-- fails. Either way nothing is written. Bases are element `_rev`s only — a
-- slice-stamp base (timetable, or the old Masters form) would go stale after
-- the batch's own first write to that slice.

create or replace function public.desk_slice_rows_write(p_tenant uuid, p_table text, p_ops jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  item jsonb; r jsonb;
  results jsonb := '[]'::jsonb;
  n_conflicts int := 0; n_applied int := 0; n_unchanged int := 0; n_deleted int := 0;
  v_last timestamptz;
  v_sync jsonb;
begin
  if p_tenant is null then
    raise exception 'desk_slice_rows_write: tenant is required' using errcode = '22004';
  end if;
  if not public._desk_slice_table_ok(p_table) then
    raise exception 'desk_slice_rows_write: % is not a slice table', p_table using errcode = '42501';
  end if;
  if p_table = 'timetable_desk_slices' then
    raise exception 'desk_slice_rows_write: timetable elements carry no _rev — write them one at a time' using errcode = '22023';
  end if;
  if p_ops is null or jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) = 0 then
    raise exception 'desk_slice_rows_write: ops must be a non-empty array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_ops) > 500 then
    raise exception 'desk_slice_rows_write: at most 500 ops in one batch' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_ops) x where jsonb_typeof(x) <> 'object') then
    raise exception 'desk_slice_rows_write: every op is an object' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_ops) x
              group by x->>'slice', coalesce(x->>'key','id'), x->>'id' having count(*) > 1) then
    raise exception 'desk_slice_rows_write: an element appears twice in one batch' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_ops) x
              where nullif(btrim(coalesce(x->>'base','')),'') is not null and x->>'base' !~ '^[0-9]+$') then
    raise exception 'desk_slice_rows_write: a base is an element _rev (a whole number)' using errcode = '22023';
  end if;

  begin
    for item in select x from jsonb_array_elements(p_ops) x loop
      r := public._desk_slice_element_apply(p_tenant, p_table, item->>'slice', coalesce(item->>'op','upsert'),
             item->>'id', item->'row', item->>'base', coalesce(item->>'key','id'));
      results := results || jsonb_build_array(r || jsonb_build_object('slice', item->>'slice', 'id', item->>'id'));
      if not coalesce((r->>'ok')::boolean, false) then
        n_conflicts := n_conflicts + 1;
      elsif coalesce((r->>'changed')::boolean, false) then
        if r->>'status' = 'deleted' then n_deleted := n_deleted + 1; else n_applied := n_applied + 1; end if;
        v_last := greatest(v_last, (r->>'revision')::timestamptz);
      else
        n_unchanged := n_unchanged + 1;
      end if;
    end loop;
    if n_conflicts > 0 then
      raise exception 'desk_slice_rows_write: batch refused' using errcode = 'BHB01';
    end if;
  exception when sqlstate 'BHB01' then
    -- Rolled back to the start of the block: nothing of the batch remains.
    return jsonb_build_object('ok', false, 'status', 'conflict',
      'applied', 0, 'unchanged', 0, 'deleted', 0, 'conflicts', n_conflicts,
      'results', results);
  end;

  if v_last is not null then
    perform public._desk_slice_meta_bump(p_tenant, p_table, v_last);
    if p_table = 'masters_desk_slices' then
      v_sync := public.masters_sync_rows_from_slices(p_tenant);
    end if;
  end if;

  return jsonb_build_object('ok', true, 'status', case when v_last is null then 'unchanged' else 'applied' end,
    'applied', n_applied, 'unchanged', n_unchanged, 'deleted', n_deleted, 'conflicts', 0,
    'revision', v_last, 'results', results);
end $$;

revoke all on function public.desk_slice_rows_write(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.desk_slice_rows_write(uuid, text, jsonb) to service_role;

-- ── 5. masters_series_bump: monotone, no base ────────────────────────────────
--
-- p_series: the series' code (e.g. 'ADMISSION') or its id. p_used: the number
-- just issued. The series' next number becomes max(stored next, p_used + 1) —
-- per academic year (countersByAy[p_ay]) when the series has resetOnAy and
-- p_ay is given, as lib/numberSeries.ts advanceSeriesAfterUse does. A number
-- below the stored next changes nothing and moves nothing.

create or replace function public.masters_series_bump(
  p_tenant uuid, p_series text, p_used int, p_ay text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_payload jsonb; v_el jsonb; v_rev int; v_next int; v_cur int; v_new int;
  v_ay text := nullif(btrim(coalesce(p_ay, '')), '');
  v_per_ay boolean; v_patch jsonb; r jsonb; v_sync jsonb;
begin
  if p_tenant is null then
    raise exception 'masters_series_bump: tenant is required' using errcode = '22004';
  end if;
  if nullif(btrim(coalesce(p_series, '')), '') is null then
    raise exception 'masters_series_bump: a series code is required' using errcode = '22023';
  end if;
  if p_used is null or p_used < 1 then
    raise exception 'masters_series_bump: the used number must be 1 or more' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('masters_desk_slices'), hashtext(p_tenant::text || '/numberSeries'));
  select payload into v_payload from public.masters_desk_slices
   where tenant_id = p_tenant and slice_key = 'numberSeries' for update;
  if v_payload is null or jsonb_typeof(v_payload) <> 'array' then
    return jsonb_build_object('ok', false, 'status', 'not_found', 'changed', false);
  end if;
  select e.el into v_el
    from jsonb_array_elements(v_payload) with ordinality as e(el, ord)
   where jsonb_typeof(e.el) = 'object' and (e.el->>'code' = p_series or e.el->>'id' = p_series)
   order by (e.el->>'code' = p_series) desc, e.ord
   limit 1;
  if v_el is null then
    return jsonb_build_object('ok', false, 'status', 'not_found', 'changed', false);
  end if;
  if nullif(v_el->>'id', '') is null then
    raise exception 'masters_series_bump: series % has no id', p_series using errcode = '22023';
  end if;

  v_rev := case when jsonb_typeof(v_el->'_rev') = 'number' and (v_el->>'_rev')::numeric > 0
                then floor((v_el->>'_rev')::numeric)::int else 0 end;
  v_next := case when (v_el->>'nextNumber') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
                 then floor((v_el->>'nextNumber')::numeric)::int else 1 end;
  v_per_ay := v_ay is not null and v_el->'resetOnAy' = 'true'::jsonb;
  if v_per_ay then
    v_cur := case when (v_el->'countersByAy'->>v_ay) ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
                  then floor((v_el->'countersByAy'->>v_ay)::numeric)::int else v_next end;
  else
    v_cur := v_next;
  end if;
  v_new := greatest(v_cur, p_used + 1);
  if v_new = v_cur then
    return jsonb_build_object('ok', true, 'status', 'unchanged', 'changed', false,
      'id', v_el->>'id', 'next', v_cur, 'rev', v_rev);
  end if;

  v_patch := case when v_per_ay
    then jsonb_build_object('countersByAy',
           case when jsonb_typeof(v_el->'countersByAy') = 'object' then v_el->'countersByAy' else '{}'::jsonb end
           || jsonb_build_object(v_ay, v_new))
    else jsonb_build_object('nextNumber', v_new) end;
  -- The lock is held: the base is the element as read under it.
  r := public._desk_slice_element_apply(p_tenant, 'masters_desk_slices', 'numberSeries', 'upsert',
         v_el->>'id', v_patch, v_rev::text, 'id');
  perform public._desk_slice_meta_bump(p_tenant, 'masters_desk_slices', (r->>'revision')::timestamptz);
  v_sync := public.masters_sync_rows_from_slices(p_tenant);
  return jsonb_build_object('ok', true, 'status', 'applied', 'changed', true,
    'id', v_el->>'id', 'next', v_new, 'rev', r->'rev', 'revision', r->'revision');
end $$;

revoke all on function public.masters_series_bump(uuid, text, int, text) from public, anon, authenticated;
grant execute on function public.masters_series_bump(uuid, text, int, text) to service_role;

-- ── 6. Staff rows through the kernel ────────────────────────────────────────

alter table public.sis_staff
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text;
comment on column public.sis_staff.deleted_at is
  'Soft remove (data-layer 2.2a, director 20 Oct 2026): set by a kernel delete; the row is hidden from lists and restorable.';
comment on column public.sis_staff.deleted_by is
  'Who removed the staff member (the session, set by the server). Cleared on restore.';

-- Who changed a sensitive staff field, on what authority. Field names only.
create table if not exists public.sis_staff_sensitive_changes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  staff_id text not null,
  fields text[] not null,
  authority text not null check (authority in ('owner','payroll','accounts')),
  actor text not null,
  changed_at timestamptz not null default now()
);
create index if not exists sis_staff_sensitive_changes_staff_idx
  on public.sis_staff_sensitive_changes (tenant_id, staff_id, changed_at desc);
comment on table public.sis_staff_sensitive_changes is
  'Every change to a sensitive sis_staff.profile field (bank, UPI, Aadhaar, PAN, pay), written by '
  'desk_write_guarded under sis_staff_write_sensitive. Field names only — never the values.';
alter table public.sis_staff_sensitive_changes enable row level security;
revoke all on public.sis_staff_sensitive_changes from public, anon, authenticated;
-- desk_write_guarded is SECURITY INVOKER (service_role) and inserts here.
grant select, insert, update, delete on public.sis_staff_sensitive_changes to service_role;

-- The keys of sis_staff.profile that only the owner / payroll / accounts may change.
create or replace function public._sis_staff_sensitive_keys()
returns text[] language sql immutable set search_path = public as $$
  select array['bankName','bankBranch','bankAccountNo','bankIfsc','bankAccountName','upiId',
               'aadhaarNo','panNo','basicPay','visitingPay']
$$;
revoke all on function public._sis_staff_sensitive_keys() from public, anon, authenticated;
grant execute on function public._sis_staff_sensitive_keys() to service_role;

-- Which sensitive keys differ between two profiles (blank = null = "" = absent).
create or replace function public._sis_staff_sensitive_diff(p_old jsonb, p_new jsonb)
returns text[] language sql immutable set search_path = public as $$
  select coalesce(array_agg(k order by k), array[]::text[])
    from unnest(public._sis_staff_sensitive_keys()) k
   where (case when p_old->k is null or p_old->k in ('null'::jsonb, '""'::jsonb) then null else p_old->k end)
         is distinct from
         (case when p_new->k is null or p_new->k in ('null'::jsonb, '""'::jsonb) then null else p_new->k end)
$$;
revoke all on function public._sis_staff_sensitive_diff(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public._sis_staff_sensitive_diff(jsonb, jsonb) to service_role;

insert into public.desk_writable_tables (table_name, soft_delete, note, sync_meta_table, sync_count_column) values
  ('sis_staff', true,
   'Staff roster (2.2a, 21 Oct 2026). Remove = soft (deleted_at/deleted_by, restorable). Signal: erp_versions reads the table '
   '(max(updated_at), count). Bank/Aadhaar/PAN/pay profile keys only via sis_staff_write_sensitive.', null, null),
  ('sis_departments', false, 'Departments (2.2a). Signal: erp_versions reads the table. Retire with is_active.', null, null),
  ('sis_designations', false, 'Designations (2.2a). Signal: erp_versions reads the table. Retire with is_active.', null, null)
on conflict (table_name) do update
  set soft_delete = excluded.soft_delete, note = excluded.note,
      sync_meta_table = excluded.sync_meta_table, sync_count_column = excluded.sync_count_column;

-- ── 7. desk_write_guarded v4 = v3 + the staff rules ─────────────────────────
--
-- Unchanged for every table that has no deleted_by column and is not
-- sis_staff. New:
--  - a soft delete on a table with deleted_by needs the op's `by` (22023
--    without it) and records it; an upsert there may clear deleted_at
--    (restore — deleted_by is cleared with it) but never set it (22023);
--  - sis_staff: an op that changes a sensitive profile key is refused (42501,
--    nothing written) unless sis_staff_write_sensitive marked the transaction;
--    under the mark every such change is recorded in sis_staff_sensitive_changes.

create or replace function public.desk_write_guarded(
  p_tenant_id uuid, p_table text, p_ops jsonb default '[]'::jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_soft boolean; v_meta text; v_count_col text; v_has_deleted boolean; v_has_deleted_by boolean;
  v_cols text; v_set text; v_n int;
  item jsonb; v_op text; rec_id text; base_txt text; payload jsonb; incoming jsonb; existing jsonb;
  base_ts timestamptz; stored_ts timestamptz; now_ts timestamptz := clock_timestamp();
  plan jsonb := '[]'::jsonb; step jsonb;
  results jsonb := '[]'::jsonb; refused jsonb := '[]'::jsonb; versions jsonb := '{}'::jsonb;
  n_applied int := 0; n_unchanged int := 0; n_deleted int := 0;
  v_by text; v_sens text[];
  v_sens_auth text := nullif(current_setting('bhb.staff_sensitive_authority', true), '');
  v_sens_actor text := nullif(current_setting('bhb.staff_sensitive_actor', true), '');
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
  select exists (select 1 from information_schema.columns c
     where c.table_schema='public' and c.table_name=p_table and c.column_name='deleted_by')
    into v_has_deleted_by;

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
    v_by := nullif(btrim(coalesce(item->>'by','')),'');

    -- FOR UPDATE cannot lock a row that does not exist yet: two writers
    -- inserting the same new id would both see it absent and the second would
    -- overwrite the first. The id lock makes the second wait, then see it.
    perform pg_advisory_xact_lock(hashtext(p_table), hashtext(p_tenant_id::text || '/' || rec_id));
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
        if v_has_deleted_by and payload ? 'deleted_at' and payload->'deleted_at' <> 'null'::jsonb then
          raise exception 'desk_write_guarded: % % cannot be created removed', p_table, rec_id using errcode = '22023';
        end if;
        v_sens := case when p_table = 'sis_staff' then public._sis_staff_sensitive_diff(null, payload->'profile') end;
        if coalesce(cardinality(v_sens), 0) > 0 and v_sens_auth is null then
          raise exception 'desk_write_guarded: sis_staff % — % can be set only by the owner or with the payroll or accounts function',
            rec_id, array_to_string(v_sens, ', ') using errcode = '42501';
        end if;
        plan := plan || jsonb_build_array(jsonb_build_object('kind','write','id',rec_id,
          'row', payload || jsonb_build_object('id',rec_id,'tenant_id',p_tenant_id),
          'sensitive', to_jsonb(coalesce(v_sens, array[]::text[]))));
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
      if v_soft and v_has_deleted and v_has_deleted_by and v_by is null then
        raise exception 'desk_write_guarded: removing % % needs who removed it (by)', p_table, rec_id using errcode = '22023';
      end if;
      plan := plan || jsonb_build_array(jsonb_build_object('kind','delete','id',rec_id,'stored_ts',stored_ts,'by',v_by));
      continue;
    end if;

    payload := item->'row';
    if payload is null or jsonb_typeof(payload) <> 'object' then
      raise exception 'desk_write_guarded: upsert % has no row object', rec_id using errcode = '22023';
    end if;
    -- Patch, not replace: an absent key keeps its stored value.
    incoming := existing || payload || jsonb_build_object('id',rec_id,'tenant_id',p_tenant_id);
    if v_has_deleted_by then
      if (existing->'deleted_at' is null or existing->'deleted_at' = 'null'::jsonb)
         and incoming->'deleted_at' is not null and incoming->'deleted_at' <> 'null'::jsonb then
        raise exception 'desk_write_guarded: remove % % with a delete op (it records who)', p_table, rec_id using errcode = '22023';
      end if;
      if incoming->'deleted_at' is null or incoming->'deleted_at' = 'null'::jsonb then
        incoming := incoming || jsonb_build_object('deleted_by', null);   -- restored (or never removed)
      end if;
    end if;
    if (existing - 'updated_at') = (incoming - 'updated_at') then
      plan := plan || jsonb_build_array(jsonb_build_object('kind','unchanged','id',rec_id,
        'revision',existing->'updated_at'));
    else
      v_sens := case when p_table = 'sis_staff' then public._sis_staff_sensitive_diff(existing->'profile', incoming->'profile') end;
      if coalesce(cardinality(v_sens), 0) > 0 and v_sens_auth is null then
        raise exception 'desk_write_guarded: sis_staff % — % can be changed only by the owner or with the payroll or accounts function',
          rec_id, array_to_string(v_sens, ', ') using errcode = '42501';
      end if;
      plan := plan || jsonb_build_array(jsonb_build_object('kind','write','id',rec_id,
        'row',incoming,'stored_ts',stored_ts,'sensitive', to_jsonb(coalesce(v_sens, array[]::text[]))));
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
        if v_has_deleted_by then
          execute format('update public.%I set deleted_at=$1, deleted_by=$4, updated_at=$1 where id=$2 and tenant_id=$3', p_table)
            using now_ts, rec_id, p_tenant_id, step->>'by';
        else
          execute format('update public.%I set deleted_at=$1, updated_at=$1 where id=$2 and tenant_id=$3', p_table)
            using now_ts, rec_id, p_tenant_id;
        end if;
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
      -- The tables are keyed on id alone: never let an id that belongs to
      -- another school be updated from this one.
      execute format(
        'insert into public.%I as t (id, tenant_id, %s) select $2, $3, %s from jsonb_populate_record(null::public.%I, $1) '
        'on conflict (id) do update set %s where t.tenant_id = $3',
        p_table, v_cols, v_cols, p_table, v_set)
        using incoming, rec_id, p_tenant_id;
      get diagnostics v_n = row_count;
      if v_n = 0 then
        raise exception 'desk_write_guarded: id % belongs to another school', rec_id using errcode = '42501';
      end if;
      if jsonb_array_length(coalesce(step->'sensitive','[]'::jsonb)) > 0 then
        insert into public.sis_staff_sensitive_changes (tenant_id, staff_id, fields, authority, actor, changed_at)
        values (p_tenant_id, rec_id,
                array(select jsonb_array_elements_text(step->'sensitive')),
                v_sens_auth, coalesce(v_sens_actor, ''), now_ts);
      end if;
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

-- ── 8. sis_staff_write_sensitive: the only door to the sensitive fields ──────
--
-- 2.2b's route calls this ONLY after it has checked that the session is the
-- owner or holds the payroll or accounts function, passing which of the three
-- it is and the session's staff id / login as p_actor. Same ops, outcomes and
-- all-or-none as desk_write_guarded on sis_staff. The mark is transaction-local
-- (set_config(..., true)) and cleared before returning; nothing a client sends
-- can set it — PostgREST maps no header to a bhb.* setting and exposes no
-- function that sets one.

create or replace function public.sis_staff_write_sensitive(
  p_tenant uuid, p_ops jsonb, p_authority text, p_actor text)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare r jsonb;
begin
  if p_authority is null or p_authority not in ('owner','payroll','accounts') then
    raise exception 'sis_staff_write_sensitive: authority must be owner, payroll or accounts' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_actor,'')),'') is null then
    raise exception 'sis_staff_write_sensitive: the actor is required' using errcode = '22023';
  end if;
  perform set_config('bhb.staff_sensitive_authority', p_authority, true);
  perform set_config('bhb.staff_sensitive_actor', btrim(p_actor), true);
  r := public.desk_write_guarded(p_tenant, 'sis_staff', p_ops);
  perform set_config('bhb.staff_sensitive_authority', '', true);
  perform set_config('bhb.staff_sensitive_actor', '', true);
  return r;
end $$;

revoke all on function public.sis_staff_write_sensitive(uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.sis_staff_write_sensitive(uuid, jsonb, text, text) to service_role;

notify pgrst, 'reload schema';
