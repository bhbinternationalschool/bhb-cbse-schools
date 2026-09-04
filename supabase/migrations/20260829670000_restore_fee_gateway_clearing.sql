-- Restore gateway clearing on the fee posting path.
--
-- 20260829560000_fee_ledger_gateway_clearing taught fee_ledger_post_collection
-- to send a gateway-captured tender to 1100 Payment Gateway Clearing rather
-- than to a bank, because the bank does not receive that money on that day —
-- it receives the cycle's net, later, less fee and GST.
--
-- 20260829540000_fee_ledger_posting was then written as though the function
-- were new, and its create-or-replace dropped the fourth argument and with it
-- the gateway branch. Online payments would have debited a bank account and
-- driven 1100 permanently negative once settlements began.
--
-- No money was mis-booked: at the time of the fix every fee tender on file
-- was a counter payment (zero rows with tender_json.gatewayProvider set), so
-- the regression was caught before the first online receipt. This file is the
-- correction, kept separate so the sequence stays legible.
--
-- The lesson worth keeping: create or replace on a function you did not write
-- is a silent revert. Read the live definition first.

create or replace function public.fee_ledger_post_collection(
  p_tenant_id uuid, p_voucher_id text, p_actor text default 'system'
) returns text
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_v record; v_lines jsonb := '[]'::jsonb; v_total bigint := 0;
  v_t record; v_gateway text; v_result jsonb;
begin
  if not public.inv_ledger_active(p_tenant_id) then return null; end if;

  select * into v_v from public.fee_desk_vouchers
   where id = p_voucher_id and tenant_id = p_tenant_id;
  if not found then return null; end if;
  if v_v.voided_at is not null then return null; end if;

  for v_t in
    select * from public.fee_desk_voucher_tenders
     where voucher_id = p_voucher_id and tenant_id = p_tenant_id and amount_paise > 0
     order by tender_index
  loop
    v_gateway := coalesce(v_t.tender_json->>'gatewayProvider', '');
    v_total := v_total + v_t.amount_paise;
    v_lines := v_lines || jsonb_build_object(
      'account_code', public.inv_ledger_tender_account(
                        v_t.mode, coalesce(v_t.tender_json->>'bankAccountId', ''),
                        p_tenant_id, v_gateway),
      'debit_paise', v_t.amount_paise, 'credit_paise', 0,
      'narration', case when v_gateway <> ''
                        then upper(coalesce(v_t.mode, 'cash')) || ' via ' || v_gateway
                        else upper(coalesce(v_t.mode, 'cash')) end,
      'instrument', jsonb_build_object(
                      'mode', coalesce(v_t.mode, 'cash'),
                      'ref', coalesce(v_t.ref, ''),
                      'bank_account_id', coalesce(v_t.tender_json->>'bankAccountId', '')));
  end loop;

  if v_total <= 0 then return null; end if;

  v_lines := v_lines || jsonb_build_object(
    'account_code', '4000', 'debit_paise', 0, 'credit_paise', v_total,
    'narration', 'Fees collected — ' || coalesce(v_v.receipt_no, p_voucher_id));

  v_result := public.ledger_post(p_tenant_id, jsonb_build_object(
    'voucher_type', 'receipt', 'date', v_v.collection_date,
    'narration', 'Fee receipt ' || coalesce(v_v.receipt_no, p_voucher_id),
    'source_type', 'fee_voucher', 'source_id', p_voucher_id,
    'created_by', coalesce(nullif(p_actor, ''), v_v.cashier_name, 'system'),
    'lines', v_lines));

  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'The books refused fee receipt %: %',
      coalesce(v_v.receipt_no, p_voucher_id),
      coalesce(v_result->>'error', 'unknown ledger error');
  end if;
  return v_result->>'voucher_no';
end;
$function$;

notify pgrst, 'reload schema';
