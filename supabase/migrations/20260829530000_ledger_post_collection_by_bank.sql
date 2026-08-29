-- Route a store collection to the bank that received it.
--
-- Companion to 20260829520000, which created a ledger account per bank and
-- taught inv_ledger_tender_account to resolve one. This points the collection
-- posting at it: the account_code line, and the instrument, which now carries
-- the bank so the voucher itself says where the money went.
--
-- Only new postings are affected. The ~103 lines already sitting on 1010 stay
-- there: ledger_lines is append-only (ledger_refuse_mutation), so restating
-- history means reverse-and-repost, which is a decision for the office, not a
-- side effect of a migration.

CREATE OR REPLACE FUNCTION public.inv_ledger_post_collection(p_tenant_id uuid, p_payment_id uuid, p_actor text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pay record;
  v_sale record;
  v_party jsonb;
  v_result jsonb;
begin
  if not public.inv_ledger_active(p_tenant_id) then
    return null;
  end if;

  select * into v_pay from public.inv_sale_payments
   where id = p_payment_id and tenant_id = p_tenant_id;
  if not found or v_pay.amount_paise <= 0 then
    return null;
  end if;

  select * into v_sale from public.inv_sales
   where id = v_pay.sale_id and tenant_id = p_tenant_id;
  if not found then
    return null;
  end if;

  v_party := case
    when v_sale.buyer_kind = 'student' and coalesce(v_sale.student_id, '') <> ''
      then jsonb_build_object('kind', 'student', 'external_id', v_sale.student_id,
                              'name', coalesce(v_sale.buyer_name, ''))
    when v_sale.buyer_kind = 'staff' and coalesce(v_sale.staff_id, '') <> ''
      then jsonb_build_object('kind', 'staff', 'external_id', v_sale.staff_id,
                              'name', coalesce(v_sale.buyer_name, ''))
    else null
  end;

  v_result := public.ledger_post(p_tenant_id, jsonb_build_object(
    'voucher_type', 'receipt',
    'date', v_pay.paid_on,
    'narration', 'Store dues collected — ' || v_sale.sale_no,
    'source_type', 'inv_sale_payment',
    'source_id', p_payment_id::text,
    'created_by', p_actor,
    'lines', jsonb_build_array(
      jsonb_build_object(
        'account_code', public.inv_ledger_tender_account(
                          v_pay.mode,
                          coalesce(v_pay.bank_account_id, ''),
                          p_tenant_id),
        'debit_paise', v_pay.amount_paise,
        'credit_paise', 0,
        'narration', upper(v_pay.mode),
        'instrument', jsonb_build_object(
                        'mode', v_pay.mode,
                        'ref', coalesce(v_pay.reference, ''),
                        'bank_account_id', coalesce(v_pay.bank_account_id, '')),
        'party', v_party
      ),
      jsonb_build_object(
        'account_code', '1040',
        'debit_paise', 0,
        'credit_paise', v_pay.amount_paise,
        'narration', 'Store dues settled',
        'party', v_party
      )
    )
  ));

  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'The books refused this collection: %',
      coalesce(v_result->>'error', 'unknown ledger error');
  end if;

  return v_result->>'voucher_no';
end;
$function$;

-- Note for anyone reading the books later, not executable here:
--
-- The balance that had accumulated on 1010 before this change (₹51,084.94 net
-- — ₹3,06,784.94 of store collections less ₹2,50,000 of Peerson Books vendor
-- payments and ₹5,700 of reversals) was moved to 1012 by a single journal
-- voucher, JV/FY2026-27/00001, on 2026-08-29. The vendor payments were
-- confirmed by the Director as having left UBI-Main.
--
-- It is a reclassification, not a correction: no earlier voucher was altered
-- or reversed, which is why 1010 shows equal debits and credits and a nil
-- balance rather than an empty history.
