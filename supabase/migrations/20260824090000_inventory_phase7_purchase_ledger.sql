-- Inventory & Procurement — Phase 7: post the purchase side into Ledger v2.
--
-- Goods receipts raise the payable, vendor payments settle it, and purchase
-- returns reduce it — each posted inside the transaction that does the work,
-- for the same reason sales are (Phase 6): a refusal must roll the whole thing
-- back rather than leave stock moved and the books silent.
--
-- Source types are prefixed `inv_` so they cannot collide with the desk
-- projection's own `vendor_bill` / `grn` keys. Both paths are idempotent but
-- key on different ids, and a bill reaching the ledger down both roads would
-- be counted twice.
--
-- The chart expenses purchases rather than capitalising them: goods are
-- debited to Store Purchases (5060) on receipt, which is why the sale side
-- deliberately posts no cost of goods sold. Freight and other charges join
-- them — they are part of what the goods cost — and so does GST when the
-- school cannot reclaim it, matching the landed cost the stock ledger records.

/* ─── Goods receipt / vendor bill ──────────────────────────── */

/**
 * Post the payable a goods receipt raises.
 *
 * Keyed on the bill rather than the receipt: the bill is the document the
 * vendor will chase, and a receipt taken in without one (`create_bill: false`,
 * a delivery note pending its invoice) has no payable to record yet. Such a
 * receipt still moves stock; nothing is posted until its bill exists.
 */
create or replace function public.inv_ledger_post_vendor_bill(
  p_tenant_id uuid,
  p_bill_id uuid,
  p_actor text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bill record;
  v_vendor record;
  v_party jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_gst_credit boolean;
  v_goods bigint;
  v_input_gst bigint;
  v_result jsonb;
begin
  if not public.inv_ledger_active(p_tenant_id) then
    return null;
  end if;

  select * into v_bill from public.inv_vendor_bills
   where id = p_bill_id and tenant_id = p_tenant_id;
  if not found or v_bill.total_paise <= 0 or v_bill.status = 'cancelled' then
    return null;
  end if;

  select * into v_vendor from public.inv_vendors
   where id = v_bill.vendor_id and tenant_id = p_tenant_id;

  v_party := jsonb_build_object(
    'kind', 'vendor',
    'external_id', v_bill.vendor_id::text,
    'name', coalesce(v_vendor.name, '')
  );

  select coalesce(gst_credit_eligible, false) into v_gst_credit
    from public.inv_settings where tenant_id = p_tenant_id;
  v_gst_credit := coalesce(v_gst_credit, false);

  -- Reclaimable GST is an asset; unreclaimable GST is part of the cost, which
  -- is exactly how the stock ledger valued the same goods.
  v_input_gst := case when v_gst_credit then v_bill.tax_paise else 0 end;
  v_goods := v_bill.total_paise - v_input_gst;

  if v_goods > 0 then
    v_lines := v_lines || jsonb_build_object(
      'account_code', '5060',
      'debit_paise', v_goods,
      'credit_paise', 0,
      'narration', 'Goods on ' || v_bill.bill_no
    );
  end if;

  if v_input_gst > 0 then
    v_lines := v_lines || jsonb_build_object(
      'account_code', '1080',
      'debit_paise', v_input_gst,
      'credit_paise', 0,
      'narration', 'Input GST on ' || v_bill.bill_no
    );
  end if;

  v_lines := v_lines || jsonb_build_object(
    'account_code', '2000',
    'debit_paise', 0,
    'credit_paise', v_bill.total_paise,
    'narration', 'Payable to ' || coalesce(v_vendor.name, 'vendor'),
    'party', v_party
  );

  v_result := public.ledger_post(p_tenant_id, jsonb_build_object(
    'voucher_type', 'purchase',
    'date', v_bill.bill_date,
    'narration', 'Vendor bill ' || v_bill.bill_no ||
                 case when coalesce(v_bill.supplier_invoice_no, '') = '' then ''
                      else ' (inv ' || v_bill.supplier_invoice_no || ')' end,
    'source_type', 'inv_vendor_bill',
    'source_id', p_bill_id::text,
    'created_by', p_actor,
    'lines', v_lines
  ));

  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'The books refused this vendor bill: %',
      coalesce(v_result->>'error', 'unknown ledger error');
  end if;

  return v_result->>'voucher_no';
end;
$$;

/* ─── Vendor payment ───────────────────────────────────────── */

/**
 * Pay a vendor bill, and post the payment.
 *
 * Moved into SQL from the TypeScript path so the payment row, the bill's new
 * balance and the ledger entry commit together. Over-payment is refused here
 * as it was there — a bill showing more paid than it is worth hides either a
 * keying error or a duplicate payment.
 */
create or replace function public.inv_pay_vendor_bill(
  p_tenant_id uuid,
  p_actor text,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bill record;
  v_vendor record;
  v_amount bigint := coalesce((p_payload->>'amount_paise')::bigint, 0);
  v_mode text := coalesce(p_payload->>'mode', 'bank');
  v_paid_on date := coalesce(nullif(p_payload->>'paid_on', '')::date, current_date);
  v_payment_no text;
  v_payment_id uuid;
  v_paid bigint;
  v_status text;
  v_result jsonb;
  v_voucher text := null;
begin
  if v_amount <= 0 then
    raise exception 'Payment amount must be more than zero';
  end if;

  select * into v_bill from public.inv_vendor_bills
   where id = (p_payload->>'bill_id')::uuid and tenant_id = p_tenant_id
   for update;
  if not found then
    raise exception 'Bill not found';
  end if;
  if v_bill.status = 'cancelled' then
    raise exception 'This bill is cancelled';
  end if;
  if v_amount > (v_bill.total_paise - v_bill.paid_paise) then
    raise exception 'Only % is outstanding on this bill',
      to_char((v_bill.total_paise - v_bill.paid_paise) / 100.0, 'FM999999990.00');
  end if;

  select * into v_vendor from public.inv_vendors
   where id = v_bill.vendor_id and tenant_id = p_tenant_id;

  v_payment_no := public.inv_next_doc_no(
    p_tenant_id, 'payment', coalesce(v_bill.academic_year_code, ''),
    coalesce((select doc_prefixes->>'payment' from public.inv_settings
               where tenant_id = p_tenant_id), 'PAY')
  );

  insert into public.inv_vendor_payments (
    tenant_id, payment_no, vendor_id, bill_id, paid_on, amount_paise,
    mode, reference, note, created_by
  ) values (
    p_tenant_id, v_payment_no, v_bill.vendor_id, v_bill.id, v_paid_on, v_amount,
    v_mode, coalesce(p_payload->>'reference', ''),
    coalesce(p_payload->>'note', ''), p_actor
  ) returning id into v_payment_id;

  v_paid := v_bill.paid_paise + v_amount;
  v_status := case when v_paid >= v_bill.total_paise then 'paid' else 'part_paid' end;

  update public.inv_vendor_bills
     set paid_paise = v_paid, status = v_status, updated_at = now()
   where id = v_bill.id and tenant_id = p_tenant_id;

  if public.inv_ledger_active(p_tenant_id) then
    v_result := public.ledger_post(p_tenant_id, jsonb_build_object(
      'voucher_type', 'payment',
      'date', v_paid_on,
      'narration', 'Paid ' || coalesce(v_vendor.name, 'vendor') ||
                   ' against ' || v_bill.bill_no,
      'source_type', 'inv_vendor_payment',
      'source_id', v_payment_id::text,
      'created_by', p_actor,
      'lines', jsonb_build_array(
        jsonb_build_object(
          'account_code', '2000',
          'debit_paise', v_amount,
          'credit_paise', 0,
          'narration', 'Settling ' || v_bill.bill_no,
          'party', jsonb_build_object(
            'kind', 'vendor',
            'external_id', v_bill.vendor_id::text,
            'name', coalesce(v_vendor.name, '')
          )
        ),
        jsonb_build_object(
          'account_code', public.inv_ledger_tender_account(v_mode),
          'debit_paise', 0,
          'credit_paise', v_amount,
          'narration', upper(v_mode),
          'instrument', jsonb_build_object(
            'mode', v_mode, 'ref', coalesce(p_payload->>'reference', '')
          )
        )
      )
    ));

    if not coalesce((v_result->>'ok')::boolean, false) then
      raise exception 'The books refused this payment: %',
        coalesce(v_result->>'error', 'unknown ledger error');
    end if;
    v_voucher := v_result->>'voucher_no';
  end if;

  return jsonb_build_object(
    'payment_id', v_payment_id,
    'payment_no', v_payment_no,
    'paid_paise', v_paid,
    'balance_paise', greatest(0, v_bill.total_paise - v_paid),
    'status', v_status,
    'ledger_voucher_no', coalesce(v_voucher, '')
  );
end;
$$;

/* ─── Purchase return (debit note) ─────────────────────────── */

/**
 * Post a debit note for goods sent back.
 *
 * Dr Accounts Payable — we owe the vendor less — and credit back the purchase
 * expense and any input GST that was claimed on it.
 */
create or replace function public.inv_ledger_post_purchase_return(
  p_tenant_id uuid,
  p_return_id uuid,
  p_actor text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ret record;
  v_vendor record;
  v_gst_credit boolean;
  v_input_gst bigint;
  v_goods bigint;
  v_lines jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if not public.inv_ledger_active(p_tenant_id) then
    return null;
  end if;

  select * into v_ret from public.inv_purchase_returns
   where id = p_return_id and tenant_id = p_tenant_id;
  if not found or v_ret.total_paise <= 0 then
    return null;
  end if;

  select * into v_vendor from public.inv_vendors
   where id = v_ret.vendor_id and tenant_id = p_tenant_id;

  select coalesce(gst_credit_eligible, false) into v_gst_credit
    from public.inv_settings where tenant_id = p_tenant_id;
  v_gst_credit := coalesce(v_gst_credit, false);

  v_input_gst := case when v_gst_credit then v_ret.tax_paise else 0 end;
  v_goods := v_ret.total_paise - v_input_gst;

  v_lines := v_lines || jsonb_build_object(
    'account_code', '2000',
    'debit_paise', v_ret.total_paise,
    'credit_paise', 0,
    'narration', 'Debit note ' || v_ret.return_no,
    'party', jsonb_build_object(
      'kind', 'vendor',
      'external_id', v_ret.vendor_id::text,
      'name', coalesce(v_vendor.name, '')
    )
  );

  if v_goods > 0 then
    v_lines := v_lines || jsonb_build_object(
      'account_code', '5060',
      'debit_paise', 0,
      'credit_paise', v_goods,
      'narration', 'Goods returned on ' || v_ret.return_no
    );
  end if;

  if v_input_gst > 0 then
    v_lines := v_lines || jsonb_build_object(
      'account_code', '1080',
      'debit_paise', 0,
      'credit_paise', v_input_gst,
      'narration', 'Input GST reversed'
    );
  end if;

  v_result := public.ledger_post(p_tenant_id, jsonb_build_object(
    'voucher_type', 'purchase',
    'date', v_ret.return_date,
    'narration', 'Purchase return ' || v_ret.return_no ||
                 ' — ' || coalesce(v_ret.reason, ''),
    'source_type', 'inv_purchase_return',
    'source_id', p_return_id::text,
    'created_by', p_actor,
    'lines', v_lines
  ));

  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'The books refused this purchase return: %',
      coalesce(v_result->>'error', 'unknown ledger error');
  end if;

  return v_result->>'voucher_no';
end;
$$;

/* ─── Wire into the receipt and return paths ───────────────── */

do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'inv_post_grn'
  ) and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'inv_post_grn_core'
  ) then
    alter function public.inv_post_grn(uuid, text, jsonb) rename to inv_post_grn_core;
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'inv_post_purchase_return'
  ) and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'inv_post_purchase_return_core'
  ) then
    alter function public.inv_post_purchase_return(uuid, text, jsonb)
      rename to inv_post_purchase_return_core;
  end if;
end
$$;

create or replace function public.inv_post_grn(
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
  v_bill_id uuid;
  v_voucher text;
begin
  v_inner := public.inv_post_grn_core(p_tenant_id, p_actor, p_payload);
  v_bill_id := nullif(v_inner->>'bill_id', '')::uuid;

  if v_bill_id is not null then
    v_voucher := public.inv_ledger_post_vendor_bill(p_tenant_id, v_bill_id, p_actor);
  end if;

  return v_inner || jsonb_build_object('ledger_voucher_no', coalesce(v_voucher, ''));
end;
$$;

create or replace function public.inv_post_purchase_return(
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
begin
  v_inner := public.inv_post_purchase_return_core(p_tenant_id, p_actor, p_payload);
  v_voucher := public.inv_ledger_post_purchase_return(
    p_tenant_id, (v_inner->>'return_id')::uuid, p_actor);
  return v_inner || jsonb_build_object('ledger_voucher_no', coalesce(v_voucher, ''));
end;
$$;

grant execute on function public.inv_ledger_post_vendor_bill(uuid, uuid, text) to service_role;
grant execute on function public.inv_pay_vendor_bill(uuid, text, jsonb) to service_role;
grant execute on function public.inv_ledger_post_purchase_return(uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';

/* ─── A debit note must reduce the bill it is against ──────── */

-- Found in testing: the ledger showed a vendor net payable of 231.20 while the
-- store's bill still read 500.00 — out by exactly the debit note. The ledger
-- was right; goods went back, so less is owed. The return recorded the stock
-- and the debit note but never told the bill.
--
-- The return now finds the bill behind its receipt, links to it, and reduces
-- its total. The total is allowed to fall below what has already been paid:
-- that leaves the vendor owing us, which is the truth in that case and shows
-- as a debit balance on their account rather than being quietly floored away.
create or replace function public.inv_post_purchase_return(
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
  v_return_id uuid;
  v_ret record;
  v_bill_id uuid;
  v_bill record;
  v_new_total bigint;
  v_voucher text;
begin
  v_inner := public.inv_post_purchase_return_core(p_tenant_id, p_actor, p_payload);
  v_return_id := (v_inner->>'return_id')::uuid;

  select * into v_ret from public.inv_purchase_returns
   where id = v_return_id and tenant_id = p_tenant_id;

  if v_ret.grn_id is not null then
    select bill_id into v_bill_id from public.inv_goods_receipts
     where id = v_ret.grn_id and tenant_id = p_tenant_id;
  end if;

  if v_bill_id is not null then
    select * into v_bill from public.inv_vendor_bills
     where id = v_bill_id and tenant_id = p_tenant_id
     for update;

    if found and v_bill.status <> 'cancelled' then
      v_new_total := greatest(0, v_bill.total_paise - v_ret.total_paise);

      update public.inv_vendor_bills
         set total_paise = v_new_total,
             status = case
               when v_new_total <= 0 then 'paid'
               when paid_paise >= v_new_total then 'paid'
               when paid_paise > 0 then 'part_paid'
               else 'open'
             end,
             updated_at = now()
       where id = v_bill_id and tenant_id = p_tenant_id;

      update public.inv_purchase_returns
         set bill_id = v_bill_id
       where id = v_return_id and tenant_id = p_tenant_id;
    end if;
  end if;

  v_voucher := public.inv_ledger_post_purchase_return(p_tenant_id, v_return_id, p_actor);
  return v_inner || jsonb_build_object('ledger_voucher_no', coalesce(v_voucher, ''));
end;
$$;
