-- fee_desk_replace_open_dues: atomic rebuild of one academic year's open-dues
-- cache. Replaces the app's delete-everything-then-upsert (two+ PostgREST
-- round trips, delete error ignored), which deadlocked when two browsers
-- pushed together and left readers a window where every due read as zero
-- (audit 2026-08-18: 2 deadlocks, 5 delete timeouts in 24 h).
--
-- Rows for the (tenant, ay) that are absent from p_rows are deleted; present
-- rows are upserted; the sync meta is updated in the same transaction. Only
-- rows that actually differ are rewritten, so a no-op rebuild is cheap and
-- takes no row locks it does not need.

create or replace function public.fee_desk_replace_open_dues(
  p_tenant_id uuid,
  p_academic_year_code text,
  p_rows jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
set search_path to 'public'
set statement_timeout to '60s'
as $$
declare
  now_ts   timestamptz := now();
  n_upsert int := 0;
  n_delete int := 0;
  n_total  int := 0;
begin
  -- Serialise concurrent rebuilds of the same (tenant, ay) instead of
  -- letting them deadlock on interleaved row locks.
  perform pg_advisory_xact_lock(
    hashtext('fee_desk_open_dues:' || p_tenant_id::text || ':' || p_academic_year_code)
  );

  drop table if exists _incoming;
  create temp table _incoming on commit drop as
  select
    (r->>'student_id')::text            as student_id,
    (r->>'due_key')::text               as due_key,
    nullif(r->>'household_id','')::text as household_id,
    coalesce(r->>'kind','academic')     as kind,
    coalesce(r->>'label','')            as label,
    nullif(r->>'due_on','')::date       as due_on,
    coalesce((r->>'billed_paise')::bigint, 0)     as billed_paise,
    coalesce((r->>'concession_paise')::bigint, 0) as concession_paise,
    coalesce((r->>'balance_paise')::bigint, 0)    as balance_paise
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  where r->>'student_id' is not null and r->>'due_key' is not null;

  with del as (
    delete from public.fee_desk_open_dues d
     where d.tenant_id = p_tenant_id
       and d.academic_year_code = p_academic_year_code
       and not exists (
         select 1 from _incoming i
          where i.student_id = d.student_id and i.due_key = d.due_key
       )
    returning 1
  )
  select count(*) into n_delete from del;

  with up as (
    insert into public.fee_desk_open_dues as d (
      tenant_id, student_id, academic_year_code, due_key, household_id,
      kind, label, due_on, billed_paise, concession_paise, balance_paise, updated_at
    )
    select
      p_tenant_id, i.student_id, p_academic_year_code, i.due_key, i.household_id,
      i.kind, i.label, i.due_on, i.billed_paise, i.concession_paise, i.balance_paise, now_ts
    from _incoming i
    on conflict (tenant_id, student_id, academic_year_code, due_key) do update set
      household_id     = excluded.household_id,
      kind             = excluded.kind,
      label            = excluded.label,
      due_on           = excluded.due_on,
      billed_paise     = excluded.billed_paise,
      concession_paise = excluded.concession_paise,
      balance_paise    = excluded.balance_paise,
      updated_at       = excluded.updated_at
    where d.household_id     is distinct from excluded.household_id
       or d.kind             is distinct from excluded.kind
       or d.label            is distinct from excluded.label
       or d.due_on           is distinct from excluded.due_on
       or d.billed_paise     is distinct from excluded.billed_paise
       or d.concession_paise is distinct from excluded.concession_paise
       or d.balance_paise    is distinct from excluded.balance_paise
    returning 1
  )
  select count(*) into n_upsert from up;

  select count(*) into n_total from _incoming;

  insert into public.fee_desk_sync_meta as m (tenant_id, open_dues_count, updated_at)
  values (p_tenant_id, n_total, now_ts)
  on conflict (tenant_id) do update set
    open_dues_count = excluded.open_dues_count,
    updated_at      = excluded.updated_at;

  return jsonb_build_object(
    'count', n_total, 'upserted', n_upsert, 'deleted', n_delete
  );
end;
$$;

revoke all on function public.fee_desk_replace_open_dues(uuid, text, jsonb) from public;
grant execute on function public.fee_desk_replace_open_dues(uuid, text, jsonb) to service_role;
