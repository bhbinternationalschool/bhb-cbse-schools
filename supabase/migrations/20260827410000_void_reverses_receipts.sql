-- Voiding a paid sale must hand the money back in the books.
--
-- inv_void_sale reversed the SALE voucher (revenue / COGS / dues) but left
-- every RECEIPT voucher standing: money collected against the sale stayed in
-- the cash book after the void. counterSummary's comment already promised
-- "the void hands the money back and reverses the receipt in the books" —
-- this makes that true. Found on SL/0001–SL/0002 (2026-08-27): two duplicate
-- family-sale entries were voided, stock returned, revenue reversed, and
-- ₹5,700 of phantom cash/UPI remained until RC/00002–00003 were reversed by
-- hand (RV/00008–00009).
--
-- The reversal loops the sale's payment rows (which stay as history) and
-- reverses each payment's receipt voucher. Already-reversed receipts are
-- skipped by ledger_reverse's own idempotency (it returns the existing
-- reversal), so voiding twice or repairing old data cannot double-reverse.

create or replace function public.inv_ledger_reverse_sale(
  p_tenant_id uuid,
  p_sale_id uuid,
  p_reason text,
  p_actor text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_voucher_id uuid;
  v_result jsonb;
  v_pay record;
  v_receipt uuid;
  v_no text := null;
begin
  if not public.inv_ledger_active(p_tenant_id) then
    return null;
  end if;

  -- The sale voucher (revenue / COGS / store dues).
  select id into v_voucher_id from public.ledger_vouchers
   where tenant_id = p_tenant_id
     and source_type = 'inv_sale'
     and source_id = p_sale_id::text;
  if v_voucher_id is not null then
    v_result := public.ledger_reverse(p_tenant_id, v_voucher_id, p_reason, null, p_actor);
    if not coalesce((v_result->>'ok')::boolean, false) then
      raise exception 'The books refused this cancellation: %',
        coalesce(v_result->>'error', 'unknown ledger error');
    end if;
    v_no := v_result->>'voucher_no';
  end if;

  -- Every receipt collected against the sale. The payment rows themselves
  -- stay — they are the history of money that changed hands and back.
  for v_pay in
    select id from public.inv_sale_payments
     where tenant_id = p_tenant_id and sale_id = p_sale_id
       and amount_paise > 0
  loop
    select id into v_receipt from public.ledger_vouchers
     where tenant_id = p_tenant_id
       and source_type = 'inv_sale_payment'
       and source_id = v_pay.id::text;
    if v_receipt is null then
      continue;
    end if;
    v_result := public.ledger_reverse(
      p_tenant_id, v_receipt,
      p_reason || ' — receipt returned on void', null, p_actor);
    if not coalesce((v_result->>'ok')::boolean, false) then
      raise exception 'The books refused returning a receipt on this cancellation: %',
        coalesce(v_result->>'error', 'unknown ledger error');
    end if;
  end loop;

  return v_no;
end;
$$;

grant execute on function public.inv_ledger_reverse_sale(uuid, uuid, text, text) to service_role;

notify pgrst, 'reload schema';
