-- Gateway money stops at clearing on the SQL posting path too.
--
-- The TypeScript projector was taught this (projectionMap.buildFeeReceiptVoucher),
-- but fee receipts are posted by a database trigger — fee_ledger_autopost →
-- fee_ledger_post_collection — and that path resolves the tender account
-- through inv_ledger_tender_account, which knows about cash, cheques and
-- banks and nothing about payment gateways. So a parent's Cashfree payment
-- was landing as a debit to a bank account.
--
-- That is wrong twice over, and the second one is the expensive one:
--
--   1. The bank never received ₹5,000 that day. It receives the cycle's net,
--      a day later, less the gateway's fee and GST.
--   2. The settlement journal credits 1100 Payment Gateway Clearing to move
--      the money out. If nothing ever debited 1100, that credit drives the
--      clearing account permanently negative while the bank is overstated by
--      the same amount — a break that grows with every online payment and
--      that no reconciliation can close.
--
-- The tender already carries the answer: tender_json.gatewayProvider is set
-- by the settle path when a real gateway captured the money, and left empty
-- for counter tenders including a UPI paid into the school's own QR — which
-- genuinely is in the bank the same day and must keep going there.

-- A fourth argument rather than a change to the three-argument form: the
-- store's callers have no gateway to offer and their behaviour must not shift
-- underneath them.
create or replace function public.inv_ledger_tender_account(
  p_mode text,
  p_bank_account_id text,
  p_tenant_id uuid,
  p_gateway_provider text
) returns text
language plpgsql
stable
as $function$
begin
  -- Cash and cheques are never gateway money; ask the three-argument form,
  -- which owns those rules.
  if lower(coalesce(p_mode, '')) in ('cash', 'cheque', 'dd') then
    return public.inv_ledger_tender_account(p_mode, p_bank_account_id, p_tenant_id);
  end if;

  if coalesce(trim(p_gateway_provider), '') <> '' then
    return '1100';
  end if;

  return public.inv_ledger_tender_account(p_mode, p_bank_account_id, p_tenant_id);
end;
$function$;

-- Same function as before, with the tender's gateway carried into the account
-- decision and named in the narration so the entry reads for itself.
create or replace function public.fee_ledger_post_collection(
  p_tenant_id uuid,
  p_voucher_id text,
  p_actor text default 'system'
) returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_v record;
  v_lines jsonb := '[]'::jsonb;
  v_total bigint := 0;
  v_t record;
  v_gateway text;
  v_result jsonb;
begin
  if not public.inv_ledger_active(p_tenant_id) then
    return null;
  end if;

  select * into v_v from public.fee_desk_vouchers
   where id = p_voucher_id and tenant_id = p_tenant_id;
  if not found then
    return null;
  end if;

  if v_v.voided_at is not null then
    return null;
  end if;

  for v_t in
    select * from public.fee_desk_voucher_tenders
     where voucher_id = p_voucher_id and tenant_id = p_tenant_id
       and amount_paise > 0
     order by tender_index
  loop
    v_gateway := coalesce(v_t.tender_json->>'gatewayProvider', '');
    v_total := v_total + v_t.amount_paise;
    v_lines := v_lines || jsonb_build_object(
      'account_code', public.inv_ledger_tender_account(
                        v_t.mode,
                        coalesce(v_t.tender_json->>'bankAccountId', ''),
                        p_tenant_id,
                        v_gateway),
      'debit_paise', v_t.amount_paise,
      'credit_paise', 0,
      'narration', case
                     when v_gateway <> ''
                       then upper(coalesce(v_t.mode, 'cash')) || ' via ' || v_gateway
                     else upper(coalesce(v_t.mode, 'cash'))
                   end,
      'instrument', jsonb_build_object(
                      'mode', coalesce(v_t.mode, 'cash'),
                      'ref', coalesce(v_t.ref, ''),
                      'bank_account_id', coalesce(v_t.tender_json->>'bankAccountId', ''))
    );
  end loop;

  if v_total <= 0 then
    return null;
  end if;

  v_lines := v_lines || jsonb_build_object(
    'account_code', '4000',
    'debit_paise', 0,
    'credit_paise', v_total,
    'narration', 'Fees collected — ' || coalesce(v_v.receipt_no, p_voucher_id)
  );

  v_result := public.ledger_post(p_tenant_id, jsonb_build_object(
    'voucher_type', 'receipt',
    'date', v_v.collection_date,
    'narration', 'Fee receipt ' || coalesce(v_v.receipt_no, p_voucher_id),
    'source_type', 'fee_voucher',
    'source_id', p_voucher_id,
    'created_by', coalesce(nullif(p_actor, ''), v_v.cashier_name, 'system'),
    'lines', v_lines
  ));

  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'The books refused fee receipt %: %',
      coalesce(v_v.receipt_no, p_voucher_id),
      coalesce(v_result->>'error', 'unknown ledger error');
  end if;

  return v_result->>'voucher_no';
end;
$function$;

notify pgrst, 'reload schema';
