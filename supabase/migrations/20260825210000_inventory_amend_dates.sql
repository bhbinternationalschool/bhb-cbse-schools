-- Inventory: make the RECEIPT and BILL dates amendable, with the books
-- following along.
--
-- WHY: backdating was unblocked by opening FY2025-26, but a document that
-- had already been forced to the wrong date (Gyan Sindhu's 30/03 invoice
-- keyed in as 01/04) could not be corrected: inv_amend_grn only amended the
-- supplier-invoice fields, so the office "amended the date", saw success,
-- and the receipt/bill/voucher dates stayed wrong. An amend that silently
-- ignores what the user asked is worse than a refusal.
--
-- HOW THE LEDGER FOLLOWS: the bill's voucher is append-only, so a date
-- change is a REVERSAL of the original voucher plus a fresh posting at the
-- corrected date. ledger_post is idempotent on (source_type, source_id), and
-- the original source_id is spent forever — so reposts carry a correction
-- sequence in the source id (bill_id, then bill_id#1, #2 …). accounts_ref on
-- the bill always points at the LIVE voucher.

/* ─── 1. Vendor-bill posting learns a correction sequence ──── */

drop function if exists public.inv_ledger_post_vendor_bill(uuid, uuid, text);

create or replace function public.inv_ledger_post_vendor_bill(
  p_tenant_id uuid,
  p_bill_id uuid,
  p_actor text,
  p_source_seq integer default 0
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
  v_voucher_no text;
  v_source_id text;
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

  v_input_gst := case when v_gst_credit then v_bill.tax_paise else 0 end;
  v_goods := v_bill.total_paise - v_input_gst;

  if v_goods > 0 then
    v_lines := v_lines || jsonb_build_object(
      'account_code', '1090',
      'debit_paise', v_goods,
      'credit_paise', 0,
      'narration', 'Goods received on ' || v_bill.bill_no
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

  v_source_id := p_bill_id::text ||
    case when coalesce(p_source_seq, 0) > 0 then '#' || p_source_seq else '' end;

  v_result := public.ledger_post(p_tenant_id, jsonb_build_object(
    'voucher_type', 'purchase',
    'date', v_bill.bill_date,
    'narration', 'Vendor bill ' || v_bill.bill_no ||
                 case when coalesce(v_bill.supplier_invoice_no, '') = '' then ''
                      else ' (inv ' || v_bill.supplier_invoice_no || ')' end,
    'source_type', 'inv_vendor_bill',
    'source_id', v_source_id,
    'created_by', p_actor,
    'lines', v_lines
  ));

  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'The books refused this vendor bill: %',
      coalesce(v_result->>'error', 'unknown ledger error');
  end if;

  v_voucher_no := v_result->>'voucher_no';

  update public.inv_vendor_bills
     set posted_to_accounts = true,
         accounts_ref = coalesce(v_voucher_no, ''),
         updated_at = now()
   where id = p_bill_id and tenant_id = p_tenant_id;

  return v_voucher_no;
end;
$$;

revoke all on function public.inv_ledger_post_vendor_bill(uuid, uuid, text, integer) from public;
grant execute on function public.inv_ledger_post_vendor_bill(uuid, uuid, text, integer) to service_role;

/* ─── 2. Amend learns the real dates ───────────────────────── */

create or replace function public.inv_amend_grn(
  p_tenant_id uuid,
  p_actor text,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grn_id uuid := nullif(p_payload->>'grn_id', '')::uuid;
  v_status text;
  v_bill_id uuid;
  v_new_receipt date := nullif(p_payload->>'receipt_date', '')::date;
  v_new_bill_date date := nullif(p_payload->>'bill_date', '')::date;
  v_old_bill_date date;
  v_voucher record;
  v_rev jsonb;
  v_seq integer;
  v_new_voucher text;
begin
  select status, bill_id into v_status, v_bill_id
    from public.inv_goods_receipts
   where id = v_grn_id and tenant_id = p_tenant_id;
  if v_status is null then
    raise exception 'Goods receipt not found';
  end if;
  if v_status = 'void' then
    raise exception 'That goods receipt is cancelled and cannot be amended';
  end if;

  update public.inv_goods_receipts
     set supplier_invoice_no =
           coalesce(p_payload->>'supplier_invoice_no', supplier_invoice_no),
         supplier_invoice_date =
           coalesce(nullif(p_payload->>'supplier_invoice_date', '')::date,
                    supplier_invoice_date),
         receipt_date = coalesce(v_new_receipt, receipt_date),
         note = coalesce(p_payload->>'note', note)
   where id = v_grn_id and tenant_id = p_tenant_id;

  if v_bill_id is not null and (p_payload ? 'supplier_invoice_no') then
    update public.inv_vendor_bills
       set supplier_invoice_no = p_payload->>'supplier_invoice_no',
           updated_at = now()
     where id = v_bill_id and tenant_id = p_tenant_id;
  end if;

  -- The bill date moves the BOOKS: reverse the live voucher, restate the
  -- bill, post again at the corrected date. All in this one transaction —
  -- a refusal (locked period, missing year) rolls the whole amendment back.
  if v_bill_id is not null and v_new_bill_date is not null then
    select bill_date into v_old_bill_date
      from public.inv_vendor_bills
     where id = v_bill_id and tenant_id = p_tenant_id;

    if v_old_bill_date is distinct from v_new_bill_date then
      update public.inv_vendor_bills
         set bill_date = v_new_bill_date,
             updated_at = now()
       where id = v_bill_id and tenant_id = p_tenant_id;

      -- The live (unreversed) voucher for this bill, if the ledger is in use.
      select v.id, v.voucher_no into v_voucher
        from public.ledger_vouchers v
       where v.tenant_id = p_tenant_id
         and v.source_type = 'inv_vendor_bill'
         and (v.source_id = v_bill_id::text or v.source_id like v_bill_id::text || '#%')
         and not exists (
           select 1 from public.ledger_vouchers r
            where r.tenant_id = p_tenant_id and r.reverses_voucher_id = v.id
         )
         and v.voucher_type <> 'reversal'
       order by v.created_at desc
       limit 1;

      if v_voucher.id is not null then
        v_rev := public.ledger_reverse(
          p_tenant_id, v_voucher.id,
          format('Bill date corrected from %s to %s', v_old_bill_date, v_new_bill_date),
          null, p_actor
        );
        if not coalesce((v_rev->>'ok')::boolean, false) then
          raise exception 'Could not reverse %: %',
            v_voucher.voucher_no, coalesce(v_rev->>'error', 'unknown ledger error');
        end if;

        select count(*)::integer into v_seq
          from public.ledger_vouchers
         where tenant_id = p_tenant_id
           and source_type = 'inv_vendor_bill'
           and (source_id = v_bill_id::text or source_id like v_bill_id::text || '#%');

        v_new_voucher := public.inv_ledger_post_vendor_bill(
          p_tenant_id, v_bill_id, p_actor, v_seq
        );
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'grn_id', v_grn_id,
    'amended', true,
    'ledger_voucher_no', coalesce(v_new_voucher, '')
  );
end;
$$;

grant execute on function public.inv_amend_grn(uuid, text, jsonb) to service_role;

notify pgrst, 'reload schema';
