-- data-layer 2.2e follow-up — masters_series_claim: a receipt / SRN number is
-- RESERVED in the database, not computed in TypeScript
-- (docs/data-layer-rebuild/COMMAND.md §2.2e, director's approval 27 Oct 2026).
--
-- [MIGRATION — director applies]. APPLY TO PRODUCTION BEFORE THE APP THAT CALLS
-- IT IS DEPLOYED: from that app on, POST /api/data/masters.number-series/next
-- and the mobile fee counter issue RECEIPT and SRN numbers only through this
-- function, and refuse to issue (nothing is saved) when it is missing.
-- Idempotent: create-or-replace + revoke/grant; a second run changes nothing.
--
-- Why: 2.2e's /next answered max(stored counter, highest number on record + 1)
-- but did not reserve it. Two counters pressing Collect at the same instant got
-- the same number; the unique (tenant_id, receipt_no) index refused the second
-- push and that receipt was stuck in its browser.
--
-- masters_series_claim(p_tenant, p_series, p_ay): in ONE transaction
--   1. locks the numberSeries slice row — the same advisory lock + FOR UPDATE
--      as masters_series_bump and the element kernel, so claims, bumps and
--      element writes of the series serialize;
--   2. number := max(stored counter, highest number on record + 1), where
--      "stored counter" is nextNumber, or countersByAy[p_ay] when the series
--      resets per year and p_ay is given (lib/data/server/numberSeriesIssued
--      nextOf), and "on record" mirrors numberSeriesIssued exactly:
--        RECEIPT   → fee_desk_vouchers.receipt_no
--        SRN       → sis_students.srn
--        ADMISSION → sis_students.admission_no
--      a value counts when it starts with the series' prefix (with the session
--      when includeSessionInPrefix) followed by 1–12 digits, the number ≥ 1
--      (tailNumber). Every row counts, voided receipts included;
--   3. writes the counter to number + 1 through _desk_slice_element_apply with
--      the element's own `_rev` as the base read under the lock (so `_rev`
--      moves by one and the slice's updated_at moves), bumps
--      masters_desk_sync_meta once, and syncs the Masters row tables — exactly
--      as masters_series_bump does;
--   4. returns { ok, status:'claimed', id, code, number, formatted, next,
--      lifted, rev, revision }. lifted = the counter was behind the records.
--   A series with no table of record → { ok:false, status:'not_on_record' }
--   (the app keeps the old peek for those); an unknown series →
--   { ok:false, status:'not_found' }. Nothing is written in either case.
--
-- A claimed number is gone even if the caller then fails to save: a gap in the
-- receipt series, never a repeat.
--
-- lock_timeout 5s: a claim waiting on the series lock longer than that fails
-- (55P03, nothing written) and the app tells the clerk to try again.
-- security definer, search_path = public, executable by service_role only
-- (this project has no default privileges — memory note
-- erp-supabase-new-table-grant).

create or replace function public.masters_series_claim(
  p_tenant uuid, p_series text, p_ay text default null)
returns jsonb language plpgsql security definer
set search_path = public
set lock_timeout = '5s'
as $$
declare
  v_payload jsonb; v_el jsonb; v_rev int; v_next int; v_cur int; v_code text;
  v_ay text := nullif(btrim(coalesce(p_ay, '')), '');
  v_per_ay boolean; v_base text; v_prefix text; v_like text; v_pad int;
  v_max bigint := 0; v_num bigint; v_digits text; v_patch jsonb; r jsonb; v_sync jsonb;
begin
  if p_tenant is null then
    raise exception 'masters_series_claim: tenant is required' using errcode = '22004';
  end if;
  if nullif(btrim(coalesce(p_series, '')), '') is null then
    raise exception 'masters_series_claim: a series code is required' using errcode = '22023';
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
    raise exception 'masters_series_claim: series % has no id', p_series using errcode = '22023';
  end if;
  v_code := coalesce(v_el->>'code', '');
  if v_code not in ('RECEIPT', 'SRN', 'ADMISSION') then
    return jsonb_build_object('ok', false, 'status', 'not_on_record', 'changed', false,
      'id', v_el->>'id', 'code', v_code);
  end if;

  -- The stored counter (masters_series_bump / nextOf).
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

  -- The prefix (numberSeriesIssued seriesPrefix).
  v_base := coalesce(v_el->>'prefix', '');
  if v_el->'includeSessionInPrefix' = 'true'::jsonb and v_ay is not null then
    v_prefix := case when right(v_base, 1) = '/' then v_base || v_ay || '/'
                     when right(v_base, 1) = '-' then v_base || v_ay || '-'
                     else v_base || '-' || v_ay || '-' end;
  else
    v_prefix := v_base;
  end if;
  v_like := replace(replace(replace(v_prefix, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  -- The highest number on record (numberSeriesIssued maxIssuedNumber).
  select coalesce(max(substr(x.v, length(v_prefix) + 1)::bigint), 0) into v_max
    from (
      select regexp_replace(c.val, '^\s+|\s+$', '', 'g') as v
        from (
          select d.receipt_no as val from public.fee_desk_vouchers d
           where v_code = 'RECEIPT' and d.tenant_id = p_tenant and d.receipt_no like v_like
          union all
          select s.srn from public.sis_students s
           where v_code = 'SRN' and s.tenant_id = p_tenant and s.srn like v_like
          union all
          select s.admission_no from public.sis_students s
           where v_code = 'ADMISSION' and s.tenant_id = p_tenant and s.admission_no like v_like
        ) c
    ) x
   where starts_with(x.v, v_prefix)
     and substr(x.v, length(v_prefix) + 1) ~ '^[0-9]{1,12}$';

  v_num := greatest(v_cur::bigint, v_max + 1);
  if v_num + 1 > 2147483647 then
    raise exception 'masters_series_claim: % would pass the largest counter (%)', v_code, v_num using errcode = '22003';
  end if;

  v_patch := case when v_per_ay
    then jsonb_build_object('countersByAy',
           case when jsonb_typeof(v_el->'countersByAy') = 'object' then v_el->'countersByAy' else '{}'::jsonb end
           || jsonb_build_object(v_ay, v_num + 1))
    else jsonb_build_object('nextNumber', v_num + 1) end;
  -- The lock is held: the base is the element as read under it.
  r := public._desk_slice_element_apply(p_tenant, 'masters_desk_slices', 'numberSeries', 'upsert',
         v_el->>'id', v_patch, v_rev::text, 'id');
  perform public._desk_slice_meta_bump(p_tenant, 'masters_desk_slices', (r->>'revision')::timestamptz);
  v_sync := public.masters_sync_rows_from_slices(p_tenant);

  -- Formatted as lib numberSeries does: padStart never truncates.
  v_pad := case when (v_el->>'padWidth') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
                then floor((v_el->>'padWidth')::numeric)::int else 0 end;
  v_digits := v_num::text;
  if length(v_digits) < v_pad then v_digits := lpad(v_digits, v_pad, '0'); end if;

  return jsonb_build_object('ok', true, 'status', 'claimed', 'changed', true,
    'id', v_el->>'id', 'code', v_code, 'number', v_num, 'formatted', v_prefix || v_digits,
    'next', v_num + 1, 'lifted', v_max + 1 > v_cur, 'rev', r->'rev', 'revision', r->'revision');
end $$;

revoke all on function public.masters_series_claim(uuid, text, text) from public, anon, authenticated;
grant execute on function public.masters_series_claim(uuid, text, text) to service_role;

notify pgrst, 'reload schema';
