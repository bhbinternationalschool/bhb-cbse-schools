-- Replace a fee receipt's lines and tenders in ONE transaction.
--
-- The push used to do it as four separate statements over PostgREST:
--
--   1. delete the lines of the vouchers the push carries lines for
--   2. delete their tenders
--   3. upsert the headers
--   4. upsert the lines, then the tenders
--
-- Nothing tied 1 to 4. When step 4 failed, the deletes stayed committed and
-- the receipts were left with a guardian and an amount and no student, no fee
-- head and no month. Dues clear FROM the lines, so every month those families
-- had paid read unpaid again.
--
-- That is what emptied the whole book on 2026-09-06: 1,913 lines over 435
-- receipts and 526 tenders gone, ₹20.8 lakh of collections with no breakdown,
-- while all 502 headers were rewritten in the same second. It is the second
-- time — 134 receipts went the same way on 2026-09-01 — and the guard added
-- then (only replace lines for vouchers the push actually carries lines for)
-- does not help here: it governs WHICH vouchers get deleted, not whether the
-- delete survives an insert that dies behind it.
--
-- A plpgsql function runs in a single transaction. If the insert raises, the
-- delete rolls back with it and the server keeps the lines it already had.
-- The push fails loudly instead of quietly destroying the book.
--
-- Deliberately NO "on conflict do nothing/update" on the inserts. A duplicate
-- id in the payload means two lines claim the same (voucher, due) — real money
-- detail that must not be silently collapsed into one row. Let it raise: the
-- transaction rolls back, nothing is lost, and the caller reports which
-- receipt is malformed.

create or replace function public.replace_fee_desk_voucher_lines(
  p_tenant_id uuid,
  p_line_voucher_ids text[],
  p_tender_voucher_ids text[],
  p_lines jsonb,
  p_tenders jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lines int := 0;
  v_tenders int := 0;
begin
  if p_tenant_id is null then
    raise exception 'replace_fee_desk_voucher_lines: tenant_id is required';
  end if;

  -- Lines. The id list and the payload are passed separately on purpose: the
  -- caller decides which vouchers may be replaced (see voucherIdsCarryingLines),
  -- and a voucher absent from the list keeps whatever the server holds.
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
      nullif(e ->> 'instrument_date', ''),
      coalesce(e ->> 'bank_name', ''),
      coalesce(e ->> 'realisation', ''),
      coalesce(e -> 'tender_json', '{}'::jsonb)
    from jsonb_array_elements(coalesce(p_tenders, '[]'::jsonb)) as e;
    get diagnostics v_tenders = row_count;
  end if;

  return jsonb_build_object('lines', v_lines, 'tenders', v_tenders);
end;
$$;

-- Without this the function is invisible to the app's service-role client and
-- every push fails 42501. Every new object needs the grant spelled out.
grant execute on function public.replace_fee_desk_voucher_lines(
  uuid, text[], text[], jsonb, jsonb
) to service_role;

-- A receipt whose lines are deleted but not re-inserted is the failure this
-- migration exists to prevent; a receipt whose lines never summed to its total
-- is a different, older problem. Neither is expressible as a column check, so
-- the Accounts controls page keeps raising them. Nothing more to constrain here.
