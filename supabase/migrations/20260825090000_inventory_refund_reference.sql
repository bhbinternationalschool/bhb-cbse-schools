-- Record HOW a refund left, and its reference.
--
-- The return flow already chose correctly between reducing what a family owes
-- and handing money back, and already refused to refund more than was ever
-- paid. What it did not record was the way the money left. `refund_mode`
-- existed on the table and the ledger already picked its account from it —
-- `inv_ledger_tender_account(refund_mode)` — but no caller ever set it, so
-- every refund defaulted to cash.
--
-- That is not cosmetic. A parent refunded by UPI was posted as cash out of the
-- drawer: the day's cash count came up short by exactly the refund, and the
-- bank never showed it leaving. The books said the money went one way; it went
-- another.
--
-- There was also nowhere to put the reference. Taking money IN by UPI has
-- needed a transaction id since split tender; giving money BACK had no such
-- field — and an unreferenced payment out is the harder one to answer
-- questions about months later.
--
-- The check lives in the database rather than only in the counter screen
-- because this is money leaving the school. A screen binds one caller; this
-- binds every caller.

alter table public.inv_sale_returns
  add column if not exists refund_reference text not null default '';

/**
 * Post a sale return, recording how any refund was paid out.
 *
 * `refund_mode` and `refund_reference` matter only when money actually moves.
 * Reducing an outstanding balance moves none, so it carries neither.
 *
 * This is the wrapper around `inv_post_sale_return_core`; it keeps the ledger
 * posting the core deliberately does not do, so that a refusal from the books
 * still rolls the whole return back.
 */
create or replace function public.inv_post_sale_return(
  p_tenant_id uuid,
  p_actor text,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inner jsonb;
  v_voucher text;
  v_return_id uuid;
  v_refunded bigint;
  v_mode text := lower(btrim(coalesce(p_payload->>'refund_mode', 'cash')));
  v_ref text := btrim(coalesce(p_payload->>'refund_reference', ''));
  v_settlement text := coalesce(p_payload->>'settlement', 'reduce_balance');
begin
  -- Refused BEFORE anything is posted. A return that has already moved stock
  -- and money is not something to unwind over a missing reference.
  if v_settlement = 'refund' and v_mode <> 'cash' and v_ref = '' then
    raise exception
      'A % refund needs its transaction reference — money leaving the school must be traceable to the bank',
      v_mode;
  end if;

  v_inner := public.inv_post_sale_return_core(p_tenant_id, p_actor, p_payload);
  v_return_id := (v_inner->>'return_id')::uuid;
  v_refunded := coalesce((v_inner->>'refunded_paise')::bigint, 0);

  -- Recorded only when money actually moved: a balance-reduction carrying a
  -- stray transaction id would read as a payment that never happened.
  update public.inv_sale_returns
     set refund_reference = case when v_refunded > 0 then v_ref else '' end
   where id = v_return_id and tenant_id = p_tenant_id;

  -- Unchanged from before, and deliberately last: a refusal here raises and
  -- takes the return, the stock movement and the refund down with it.
  v_voucher := public.inv_ledger_post_sale_return(p_tenant_id, v_return_id, p_actor);

  return v_inner || jsonb_build_object(
    'ledger_voucher_no', coalesce(v_voucher, ''),
    'refund_reference', case when v_refunded > 0 then v_ref else '' end
  );
end;
$$;

grant execute on function public.inv_post_sale_return(uuid, text, jsonb) to service_role;

notify pgrst, 'reload schema';
