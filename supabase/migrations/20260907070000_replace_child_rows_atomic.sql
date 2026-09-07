-- One transaction for every "wipe a parent's child rows and write them again".
--
-- Nineteen call sites did this as two statements over PostgREST — delete the
-- children of a parent, then insert the new set. Nothing tied them. When the
-- insert failed the delete stayed committed and the parent was left with no
-- children at all: a mark sheet with no marks, a register with no attendance,
-- a purchase order with no lines, a desk slice with no state.
--
-- That is not hypothetical. It is what emptied the fee book on 2026-09-06 —
-- 1,913 lines over 435 receipts, ₹20.8 lakh of collections with no student,
-- head or month — and 134 receipts on 2026-09-01 before it. The fee desk got
-- its own function; this is the same guarantee for everything else, so the
-- next module to meet a failed insert does not lose a term's marks.
--
-- The generic form is deliberate. A bespoke function per table would be
-- nineteen more things to keep in step with nineteen schemas, and the one
-- nobody remembered to write is the one that loses the data.
--
-- SAFETY OF THE DYNAMIC SQL
--   * p_table must appear in the allowlist below. Nothing else is reachable.
--   * every column named in p_match is checked against the catalog for that
--     table before it reaches format(), and is emitted with %I.
--   * every value is emitted with %L, so it is quoted as a literal and cannot
--     close the statement.
--   * the insert lists only the columns actually present in the payload, so
--     columns the caller omitted keep their DEFAULT instead of turning NULL —
--     which is what a bare `insert ... select *` would have done to
--     created_at and friends.
--   * a table carrying tenant_id may not be touched without one.

create or replace function public.replace_child_rows(
  p_table text,
  p_tenant_id uuid,
  p_match jsonb,
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed constant text[] := array[
    'ai_response_cache',
    'attendance_desk_marks',
    'exam_desk_coscholastic',
    'exam_desk_item_scores',
    'exam_desk_marks',
    'exam_desk_remarks',
    'fee_desk_charge_voucher_lines',
    'inv_indent_lines',
    'inv_kit_classes',
    'inv_kit_items',
    'inv_po_lines',
    'inv_price_list_items',
    'masters_desk_slices',
    'payment_desk_link_lines',
    'staff_attendance_desk_marks',
    'timetable_desk_slices',
    'transport_desk_slices',
    'trust_desk_slices',
    'wa_desk_bot_slices'
  ];
  has_tenant boolean;
  where_sql text;
  cols text;
  n int := 0;
begin
  if p_table is null or not (p_table = any (allowed)) then
    raise exception 'replace_child_rows: % is not a replaceable table', p_table;
  end if;

  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = p_table and column_name = 'tenant_id'
  ) into has_tenant;

  if has_tenant and p_tenant_id is null then
    raise exception 'replace_child_rows: % is tenant-scoped and needs a tenant_id', p_table;
  end if;

  if p_match is null or jsonb_typeof(p_match) <> 'object' or p_match = '{}'::jsonb then
    raise exception 'replace_child_rows: p_match must name the parent rows to replace';
  end if;

  -- Every key must be a real column of this table, or the delete is not the
  -- one the caller thinks it is. A typo that silently matched nothing would
  -- leave stale children behind; a typo that matched everything would be a
  -- disaster. Neither is allowed to compile.
  if exists (
    select 1 from jsonb_object_keys(p_match) k
     where not exists (
       select 1 from information_schema.columns c
        where c.table_schema = 'public' and c.table_name = p_table and c.column_name = k
     )
  ) then
    raise exception 'replace_child_rows: p_match names a column % does not have', p_table;
  end if;

  select string_agg(
           case when jsonb_typeof(value) = 'array'
                then format('%I = any (select jsonb_array_elements_text(%L::jsonb))', key, value)
                else format('%I = %L', key, value #>> '{}')
           end, ' and ')
    into where_sql
    from jsonb_each(p_match);

  if has_tenant then
    where_sql := format('tenant_id = %L and ', p_tenant_id) || where_sql;
  end if;

  execute format('delete from public.%I where %s', p_table, where_sql);

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    -- An empty payload is a legitimate "this parent now has no children" —
    -- the caller decided that, and the delete above is the whole operation.
    return jsonb_build_object('rows', 0);
  end if;

  select string_agg(quote_ident(k), ', ')
    into cols
    from (
      select distinct jsonb_object_keys(e) as k
        from jsonb_array_elements(p_rows) e
    ) keys
   where exists (
     select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = p_table and c.column_name = keys.k
   );

  if cols is null then
    raise exception 'replace_child_rows: no payload key matches a column of %', p_table;
  end if;

  execute format(
    'insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, %L)',
    p_table, cols, cols, p_table, p_rows
  );
  get diagnostics n = row_count;

  return jsonb_build_object('rows', n);
end;
$$;

-- Without this the app's service-role client cannot see the function and every
-- desk push fails 42501. Every new object needs the grant spelled out.
grant execute on function public.replace_child_rows(text, uuid, jsonb, jsonb)
  to service_role;
