-- The receipt HEADER must not survive a failed write of its lines.
--
-- 20260907060000 fixed the delete/insert half but left the header upsert
-- outside the transaction, running first. On 2026-09-07 that produced the same
-- damage in a new shape: seven counter receipts (RCV-00503..00509, ₹34,500)
-- landed as headers with an amount and NO student, head, month or payment
-- mode, because the line write behind them failed, returned 502, and the
-- header had already committed.
--
-- A receipt with no breakdown is worse than no receipt at all. The money reads
-- as collected, every month it paid reads as unpaid, and the counter is
-- invited to take them again — which is exactly the loss the office nearly
-- made after 2026-09-01. A receipt that never reached the server is still in
-- the operator's browser and pushes on the next sync.
--
-- Headers now go in with their lines. p_headers defaults to null so the shape
-- of the old five-argument call still works, and the old overload is DROPPED:
-- with a default on the sixth argument, keeping both made a five-argument call
-- ambiguous and PostgREST could not resolve it — which would have broken the
-- very pushes this exists to fix.

create or replace function public.replace_fee_desk_voucher_lines(
  p_tenant_id uuid,
  p_line_voucher_ids text[],
  p_tender_voucher_ids text[],
  p_lines jsonb,
  p_tenders jsonb,
  p_headers jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lines int := 0;
  v_tenders int := 0;
  v_headers int := 0;
  cols text;
begin
  if p_tenant_id is null then
    raise exception 'replace_fee_desk_voucher_lines: tenant_id is required';
  end if;

  -- Headers first WITHIN the transaction: the lines' foreign key points at
  -- them, so a brand-new receipt's lines cannot be inserted before the receipt
  -- exists. Being inside the transaction is what matters; being first is only
  -- ordering. Only the columns the payload actually carries are written, so
  -- anything omitted keeps its DEFAULT instead of turning NULL.
  if p_headers is not null
     and jsonb_typeof(p_headers) = 'array'
     and jsonb_array_length(p_headers) > 0 then
    select string_agg(quote_ident(k), ', ')
      into cols
      from (
        select distinct jsonb_object_keys(e) as k
          from jsonb_array_elements(p_headers) e
      ) keys
     where exists (
       select 1 from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name = 'fee_desk_vouchers'
          and c.column_name = keys.k
     );
    if cols is null then
      raise exception 'replace_fee_desk_voucher_lines: no header key matches a column';
    end if;
    execute format(
      'insert into public.fee_desk_vouchers (%s) select %s from '
      || 'jsonb_populate_recordset(null::public.fee_desk_vouchers, %L) '
      || 'on conflict (id) do update set %s',
      cols, cols, p_headers,
      (select string_agg(format('%1$s = excluded.%1$s', c), ', ')
         from unnest(string_to_array(cols, ', ')) c
        where c <> 'id')
    );
    get diagnostics v_headers = row_count;
  end if;

  if p_line_voucher_ids is not null and array_length(p_line_voucher_ids, 1) > 0 then
    delete from public.fee_desk_voucher_lines
     where tenant_id = p_tenant_id
       and voucher_id = any (p_line_voucher_ids);

    insert into public.fee_desk_voucher_lines
      (id, voucher_id, tenant_id, student_id, due_key, kind, label, amount_paise, line_json)
    select
      e ->> 'id',
      e ->> 'voucher_id',
      p_tenant_id,
      e ->> 'student_id',
      e ->> 'due_key',
      e ->> 'kind',
      e ->> 'label',
      (e ->> 'amount_paise')::bigint,
      coalesce(e -> 'line_json', '{}'::jsonb)
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) as e;
    get diagnostics v_lines = row_count;
  end if;

  if p_tender_voucher_ids is not null and array_length(p_tender_voucher_ids, 1) > 0 then
    delete from public.fee_desk_voucher_tenders
     where tenant_id = p_tenant_id
       and voucher_id = any (p_tender_voucher_ids);

    insert into public.fee_desk_voucher_tenders
      (id, voucher_id, tenant_id, tender_index, mode, amount_paise, ref,
       instrument_date, bank_name, realisation, tender_json)
    select
      e ->> 'id',
      e ->> 'voucher_id',
      p_tenant_id,
      (e ->> 'tender_index')::int,
      e ->> 'mode',
      (e ->> 'amount_paise')::bigint,
      coalesce(e ->> 'ref', ''),
      -- ::date, and nullif first so "" becomes NULL rather than a cast error.
      --
      -- Without the cast Postgres refuses the whole statement ("column
      -- instrument_date is of type date but expression is of type text"), the
      -- transaction rolls the lines back with it, and the receipt is left
      -- blank. Every counter receipt carries a tender, so this failed EVERY
      -- push from the moment the function went live — RCV-00503..00509,
      -- ₹34,500, on 2026-09-07. It survived the first proof because that test
      -- only reached the LINES insert: a rollback test that never executes the
      -- statement underneath it proves the rollback, not the write.
      nullif(e ->> 'instrument_date', '')::date,
      coalesce(e ->> 'bank_name', ''),
      coalesce(e ->> 'realisation', ''),
      coalesce(e -> 'tender_json', '{}'::jsonb)
    from jsonb_array_elements(coalesce(p_tenders, '[]'::jsonb)) as e;
    get diagnostics v_tenders = row_count;
  end if;

  return jsonb_build_object(
    'headers', v_headers, 'lines', v_lines, 'tenders', v_tenders
  );
end;
$$;

-- Ambiguity kills the resolve, so the five-argument form goes.
drop function if exists public.replace_fee_desk_voucher_lines(
  uuid, text[], text[], jsonb, jsonb
);

grant execute on function public.replace_fee_desk_voucher_lines(
  uuid, text[], text[], jsonb, jsonb, jsonb
) to service_role;
