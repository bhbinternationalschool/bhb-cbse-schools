-- A student absent from an exam.
--
-- Until now absence was a blank cell, indistinguishable from "not entered
-- yet": the report card printed "—" and nobody could tell whether the child
-- missed the paper or the teacher missed the row. One row per absent student
-- per mark sheet, with an optional reason (sick, family event …), entered
-- from the marks grid. The report card then prints AB and the reason; the
-- result sheet says Absent instead of Fail.
--
-- Child of exam_desk_sheets like marks / remarks / co-scholastic, so it is
-- added to replace_child_rows' allowlist and written inside the same
-- one-sheet transaction as the rest.

create table if not exists public.exam_desk_absences (
  id text primary key,
  mark_sheet_id text not null references public.exam_desk_sheets(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id text not null,
  reason text not null default '',
  updated_at timestamptz not null default now(),
  unique (mark_sheet_id, student_id)
);

create index if not exists exam_desk_absences_tenant_sheet_idx
  on public.exam_desk_absences (tenant_id, mark_sheet_id);

alter table public.exam_desk_absences enable row level security;
grant all on public.exam_desk_absences to service_role;

comment on table public.exam_desk_absences is
  'Students absent from an exam (one row per absent student per exam_desk_sheets row) with an optional reason; the report card prints AB.';

-- Same function as 20260907070000, with exam_desk_absences added to the
-- allowlist. Functions are replaced whole, so the body is repeated here.
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
    'exam_desk_absences',
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
