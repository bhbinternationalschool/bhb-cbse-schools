-- Stage 1 of the server-authoritative data layer.
--
-- One generic per-record write path for every desk table, generalised from
-- sis_push_guarded (20260808150000). That function is correct but bound to
-- two tables because it hardcodes its `on conflict do update set` list; the
-- list is derivable from information_schema, so the rest generalises.
--
-- What it replaces: today a client POSTs its ENTIRE module state and the
-- server reconstructs intent by diffing. Deletions are inferred from what is
-- absent, which is how a truncated payload silently erases rows, and how a
-- removed student was never deleted at all (no caller ever passed
-- `pruneMissing`). Here every change is stated: an op, an id, and the
-- revision the client believed it was editing.
--
-- Semantics preserved from sis_push_guarded, each for a reason learned the
-- hard way:
--   * no-op skip — an identical row keeps its stored revision. Without it,
--     routine whole-state pushes bump every row and invalidate every other
--     client's token. The first version of that migration did exactly this
--     and reported all 904 records as conflicts on the next push.
--   * a NULL base is allowed and counted (`unversioned`) so browsers
--     deployed before this shipped keep saving during rollout.
--   * a mismatched base is refused and the STORED row is returned, so the
--     client can show a real diff rather than "reload and redo".

-- ── Allowlist ────────────────────────────────────────────────────────────
-- The function takes a table name from the request. Even as SECURITY
-- INVOKER — and it is invoker, deliberately, so the caller's grants still
-- apply — the executing role is service_role, which can write anything.
-- Without this allowlist a bug or a crafted request reaches `profiles`,
-- `api_keys` or `user_role_assignments`. 20260808130000 exists because that
-- class of mistake has already been made here once.
create table if not exists public.desk_writable_tables (
  table_name  text primary key,
  soft_delete boolean not null default false,
  note        text    not null default '',
  created_at  timestamptz not null default now()
);

comment on table public.desk_writable_tables is
  'Tables desk_write_guarded may write. Adding a row here grants write '
  'access through the generic data API — review as a permission change, '
  'not as configuration.';

revoke all on public.desk_writable_tables from public, anon, authenticated;
grant select on public.desk_writable_tables to service_role;

-- Seeded with the two tables Stage 1 exercises. Modules are added as they
-- migrate, one per stage, so the blast radius grows only as deliberately as
-- the migration does.
insert into public.desk_writable_tables (table_name, soft_delete, note) values
  ('sis_students',   false, 'Stage 4 pilot; hard delete, audit row is the record'),
  ('sis_households', false, 'Stage 4 pilot')
on conflict (table_name) do nothing;

-- ── The write path ───────────────────────────────────────────────────────
create or replace function public.desk_write_guarded(
  p_tenant_id uuid,
  p_table     text,
  p_ops       jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_soft        boolean;
  v_set         text;
  v_has_deleted boolean;
  item          jsonb;
  v_op          text;
  rec_id        text;
  payload       jsonb;
  incoming      jsonb;
  existing      jsonb;
  base_ts       timestamptz;
  stored_ts     timestamptz;
  now_ts        timestamptz := clock_timestamp();
  results       jsonb := '[]'::jsonb;
  versions      jsonb := '{}'::jsonb;
  n_applied     int := 0;
  n_unchanged   int := 0;
  n_conflicts   int := 0;
  n_deleted     int := 0;
  n_unversioned int := 0;
begin
  -- Allowlist first, before the table name is interpolated anywhere.
  select t.soft_delete into v_soft
    from public.desk_writable_tables t
   where t.table_name = p_table;
  if not found then
    raise exception 'desk_write_guarded: table % is not writable', p_table
      using errcode = '42501';
  end if;

  if p_tenant_id is null then
    raise exception 'desk_write_guarded: tenant_id is required'
      using errcode = '22004';
  end if;

  -- Updatable columns, derived rather than hardcoded. id and tenant_id
  -- identify the row; created_at is immutable.
  select string_agg(format('%I = excluded.%I', c.column_name, c.column_name), ', ')
    into v_set
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name   = p_table
     and c.column_name not in ('id', 'tenant_id', 'created_at');

  select exists (
    select 1 from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = p_table
       and c.column_name = 'deleted_at'
  ) into v_has_deleted;

  for item in select * from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb))
  loop
    v_op   := coalesce(item ->> 'op', 'upsert');
    rec_id := nullif(item ->> 'id', '');
    if rec_id is null then
      continue;
    end if;
    base_ts := nullif(item ->> 'base', '')::timestamptz;

    execute format(
      'select to_jsonb(t) from public.%I t where t.id = $1 and t.tenant_id = $2',
      p_table
    ) into existing using rec_id, p_tenant_id;

    -- ── Delete ──────────────────────────────────────────────────────────
    if v_op = 'delete' then
      if existing is null then
        -- Already gone. Idempotent: a retried delete must not be an error.
        results := results || jsonb_build_array(jsonb_build_object(
          'id', rec_id, 'status', 'deleted'));
        continue;
      end if;

      stored_ts := (existing ->> 'updated_at')::timestamptz;
      if base_ts is null then
        n_unversioned := n_unversioned + 1;
      elsif base_ts <> stored_ts then
        n_conflicts := n_conflicts + 1;
        results := results || jsonb_build_array(jsonb_build_object(
          'id', rec_id, 'status', 'conflict',
          'revision', stored_ts, 'stored', existing));
        versions := versions || jsonb_build_object(rec_id, stored_ts);
        continue;
      end if;

      if v_soft and v_has_deleted then
        execute format(
          'update public.%I set deleted_at = $1, updated_at = $1
            where id = $2 and tenant_id = $3', p_table)
          using now_ts, rec_id, p_tenant_id;
      else
        execute format(
          'delete from public.%I where id = $1 and tenant_id = $2', p_table)
          using rec_id, p_tenant_id;
      end if;

      n_deleted := n_deleted + 1;
      results := results || jsonb_build_array(jsonb_build_object(
        'id', rec_id, 'status', 'deleted'));
      continue;
    end if;

    -- ── Upsert ──────────────────────────────────────────────────────────
    payload := item -> 'row';
    if payload is null then
      continue;
    end if;
    incoming := payload
      || jsonb_build_object('id', rec_id, 'tenant_id', p_tenant_id);

    if existing is not null then
      -- Patch, not replace. jsonb_populate_record fills any column absent
      -- from the payload with NULL, and `set col = excluded.col` would then
      -- write those NULLs — so a client sending a subset of fields would
      -- silently erase the rest. Layering the payload over the stored row
      -- means an absent key keeps its stored value, while an explicit
      -- `"col": null` still clears it. (sis_push_guarded avoids this only
      -- because its client always sends complete rows; nothing enforced it.)
      incoming := existing || incoming;

      -- Identical apart from the timestamp: keep the row AND its revision.
      -- This comparison is only meaningful after the merge above.
      if (existing - 'updated_at') = (incoming - 'updated_at') then
        n_unchanged := n_unchanged + 1;
        versions := versions
          || jsonb_build_object(rec_id, existing ->> 'updated_at');
        results := results || jsonb_build_array(jsonb_build_object(
          'id', rec_id, 'status', 'unchanged',
          'revision', existing ->> 'updated_at'));
        continue;
      end if;

      stored_ts := (existing ->> 'updated_at')::timestamptz;
      if base_ts is null then
        n_unversioned := n_unversioned + 1;
      elsif base_ts <> stored_ts then
        n_conflicts := n_conflicts + 1;
        results := results || jsonb_build_array(jsonb_build_object(
          'id', rec_id, 'status', 'conflict',
          'revision', stored_ts, 'stored', existing));
        versions := versions || jsonb_build_object(rec_id, stored_ts);
        continue;
      end if;

      -- clock_timestamp() advances within a transaction, but two writes to
      -- the same row inside one call could still land on the same instant.
      -- A revision that does not move is a revision a client cannot use.
      if stored_ts >= now_ts then
        now_ts := stored_ts + interval '1 microsecond';
      end if;
    end if;

    execute format(
      'insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)
         on conflict (id) do update set %s',
      p_table, p_table, v_set
    ) using incoming || jsonb_build_object('updated_at', now_ts);

    n_applied := n_applied + 1;
    versions := versions || jsonb_build_object(rec_id, now_ts);
    results := results || jsonb_build_array(jsonb_build_object(
      'id', rec_id, 'status', 'applied', 'revision', now_ts));
  end loop;

  return jsonb_build_object(
    'ok', n_conflicts = 0,
    'table', p_table,
    'applied', n_applied,
    'unchanged', n_unchanged,
    'deleted', n_deleted,
    'conflicts', n_conflicts,
    'unversioned', n_unversioned,
    'results', results,
    'versions', versions
  );
end;
$$;

comment on function public.desk_write_guarded(uuid, text, jsonb) is
  'Per-record guarded write for desk tables. Ops are {op,id,base,row}. '
  'Refuses a mismatched base rather than overwriting, skips no-op rows so '
  'their revisions stay stable, and only writes tables listed in '
  'desk_writable_tables.';

-- Same posture as sis_push_guarded: the API layer calls this, nothing else.
revoke all on function public.desk_write_guarded(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.desk_write_guarded(uuid, text, jsonb)
  to service_role;
