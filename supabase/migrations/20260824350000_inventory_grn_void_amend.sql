-- Correcting a goods receipt: void and re-enter, never silent edit.
--
-- A posted receipt is not just a document. It moved stock in, rolled the
-- item's weighted-average cost, updated what that vendor charges, advanced the
-- purchase order, raised a payable and posted Dr Inventory / Cr Accounts
-- Payable to the ledger. Quietly rewriting its quantities or rates would leave
-- every one of those consequences pointing at numbers that no longer exist.
--
-- So the split is deliberate and follows what an accountant would do:
--
--   * FINANCIAL content — quantities, rates, discounts, GST — cannot be
--     edited. Void the receipt and enter it again. The void is a visible
--     event with a reason and a reversing journal, so the correction leaves a
--     trail instead of erasing one.
--
--   * DESCRIPTIVE content — the supplier's invoice number and date, the note —
--     can be amended in place. Getting the invoice number wrong is the single
--     most common keying error, it changes no money, and forcing a void for it
--     would push people towards not correcting it at all.
--
-- The void REFUSES rather than forces in four cases, because each one would
-- otherwise leave the books telling a lie:
--
--   1. The goods are no longer on the shelf. If some were already sold or
--      issued, reversing the receipt drives stock negative and strips a cost
--      that a sale has already consumed.
--   2. The bill has been paid, wholly or partly. Money has left the school;
--      that is a debit note or a refund, not a cancellation.
--   3. A purchase return already exists against it. Reverse that first, or the
--      same goods are returned twice.
--   4. The ledger refuses — a locked period, most often. The exception rolls
--      the whole void back, so stock never moves without its journal.

alter table public.inv_goods_receipts
  add column if not exists status text not null default 'posted'
    check (status in ('posted', 'void')),
  add column if not exists void_reason text not null default '',
  add column if not exists voided_by text not null default '',
  add column if not exists voided_at timestamptz;

create index if not exists inv_goods_receipts_status_idx
  on public.inv_goods_receipts (tenant_id, status, receipt_date desc);

/**
 * Rebuild an item's weighted-average cost from the stock that is left.
 *
 * A receipt cannot simply be "un-rolled" out of a running average: later
 * receipts have already averaged against it, so subtracting it is not the
 * inverse of adding it. Instead the average is recomputed from every inbound
 * movement still standing, which is the same figure the item would have had if
 * the voided receipt had never been entered.
 *
 * With nothing inbound left the cost is set to zero rather than left stale —
 * an average carried over from stock the school no longer holds is exactly the
 * kind of number that quietly misprices a sale.
 */
create or replace function public.inv_recompute_avg_cost(
  p_tenant_id uuid,
  p_item_id uuid
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qty numeric;
  v_value numeric;
  v_avg bigint;
begin
  -- Inbound movements only, and NOT the ones belonging to a cancelled
  -- receipt. Voiding adds a reversing negative row rather than deleting the
  -- original, so without this exclusion the cancelled receipt would keep
  -- setting the cost of goods it no longer supplies — and every later sale
  -- would be priced from stock the school does not have.
  select coalesce(sum(l.qty_delta), 0),
         coalesce(sum(l.qty_delta * l.unit_cost_paise), 0)
    into v_qty, v_value
    from public.inv_stock_ledger l
   where l.tenant_id = p_tenant_id
     and l.item_id = p_item_id
     and l.qty_delta > 0
     and not exists (
       select 1 from public.inv_goods_receipts g
        where g.id = l.ref_id
          and g.tenant_id = p_tenant_id
          and l.ref_type = 'grn'
          and g.status = 'void'
     );

  v_avg := case when v_qty > 0 then round(v_value / v_qty) else 0 end;

  update public.inv_items
     set avg_cost_paise = v_avg, updated_at = now()
   where tenant_id = p_tenant_id and id = p_item_id;

  return v_avg;
end;
$$;

grant execute on function public.inv_recompute_avg_cost(uuid, uuid) to service_role;

/**
 * Cancel a goods receipt and everything it caused.
 */
create or replace function public.inv_void_grn(
  p_tenant_id uuid,
  p_actor text,
  p_grn_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grn record;
  v_line record;
  v_bill record;
  v_on_hand numeric;
  v_voucher_id uuid;
  v_result jsonb;
  v_reversal text := '';
begin
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'A reason is required to cancel a goods receipt';
  end if;

  select * into v_grn from public.inv_goods_receipts
   where id = p_grn_id and tenant_id = p_tenant_id
   for update;
  if not found then
    raise exception 'Goods receipt not found';
  end if;
  if v_grn.status = 'void' then
    raise exception 'That goods receipt is already cancelled';
  end if;

  if exists (
    select 1 from public.inv_purchase_returns
     where grn_id = p_grn_id and tenant_id = p_tenant_id
  ) then
    raise exception
      'This receipt has a purchase return against it — reverse that first';
  end if;

  -- The payable. A paid bill means money has left the school.
  if v_grn.bill_id is not null then
    select * into v_bill from public.inv_vendor_bills
     where id = v_grn.bill_id and tenant_id = p_tenant_id
     for update;
    if found and v_bill.paid_paise > 0 then
      raise exception
        'This receipt''s bill has been paid % — raise a purchase return instead of cancelling',
        to_char(v_bill.paid_paise / 100.0, 'FM999999990.00');
    end if;
  end if;

  -- Are the goods still here? Checked for every line BEFORE anything moves,
  -- so a receipt that is half-consumed refuses cleanly rather than reversing
  -- the lines it happens to reach first.
  for v_line in
    select l.item_id, l.qty_received, l.landed_unit_cost_paise, i.name
      from public.inv_grn_lines l
      join public.inv_items i on i.id = l.item_id
     where l.grn_id = p_grn_id and l.tenant_id = p_tenant_id
  loop
    select coalesce(sum(qty_delta), 0) into v_on_hand
      from public.inv_stock_ledger
     where tenant_id = p_tenant_id and item_id = v_line.item_id;

    if v_on_hand < v_line.qty_received then
      raise exception
        'Only % of % % are still in stock — some have been issued, so this receipt cannot be cancelled. Raise a purchase return instead',
        v_on_hand, v_line.qty_received, v_line.name;
    end if;
  end loop;

  -- Take the stock back out, at the cost it came in at.
  for v_line in
    select item_id, qty_received, landed_unit_cost_paise, po_line_id
      from public.inv_grn_lines
     where grn_id = p_grn_id and tenant_id = p_tenant_id
  loop
    insert into public.inv_stock_ledger (
      tenant_id, item_id, location_id, at, qty_delta, unit_cost_paise,
      kind, ref_type, ref_id, ref_no, note, created_by
    ) values (
      p_tenant_id, v_line.item_id, v_grn.location_id, now(),
      -v_line.qty_received, v_line.landed_unit_cost_paise,
      'purchase_return_out', 'grn_void', p_grn_id, v_grn.grn_no,
      'Receipt cancelled: ' || p_reason, p_actor
    );

    -- Give the order its outstanding quantity back.
    if v_line.po_line_id is not null then
      update public.inv_po_lines
         set qty_received = greatest(0, qty_received - v_line.qty_received)
       where tenant_id = p_tenant_id and id = v_line.po_line_id;
    end if;
  end loop;

  -- The receipt itself, marked BEFORE the averages are rebuilt. The rebuild
  -- ignores inbound rows belonging to a cancelled receipt, so it has to be able
  -- to see that this one is cancelled — recomputing first would leave the
  -- voided cost still setting the item's value.
  update public.inv_goods_receipts
     set status = 'void',
         void_reason = p_reason,
         voided_by = p_actor,
         voided_at = now()
   where id = p_grn_id and tenant_id = p_tenant_id;

  -- Now the average cost each item would have had without this receipt.
  for v_line in
    select distinct item_id
      from public.inv_grn_lines
     where grn_id = p_grn_id and tenant_id = p_tenant_id
  loop
    perform public.inv_recompute_avg_cost(p_tenant_id, v_line.item_id);
  end loop;

  -- An order closed by this receipt is open again.
  if v_grn.po_id is not null then
    update public.inv_purchase_orders po
       set status = case
             when exists (
               select 1 from public.inv_po_lines l
                where l.po_id = po.id and l.qty_received > 0
             ) then 'partial_grn'
             else 'issued'
           end,
           updated_at = now()
     where po.id = v_grn.po_id and po.tenant_id = p_tenant_id
       and po.status not in ('cancelled');
  end if;

  -- The payable, and the journal that raised it. Reversed rather than deleted:
  -- the books should show that a bill was raised and withdrawn, not that it
  -- never existed.
  if v_grn.bill_id is not null then
    select id into v_voucher_id from public.ledger_vouchers
     where tenant_id = p_tenant_id
       and source_type = 'inv_vendor_bill'
       and source_id = v_grn.bill_id::text;

    if v_voucher_id is not null then
      v_result := public.ledger_reverse(
        p_tenant_id, v_voucher_id,
        'Goods receipt ' || v_grn.grn_no || ' cancelled: ' || p_reason,
        null, p_actor
      );
      if not coalesce((v_result->>'ok')::boolean, false) then
        raise exception 'The books refused this cancellation: %',
          coalesce(v_result->>'error', 'unknown ledger error');
      end if;
      v_reversal := coalesce(v_result->>'voucher_no', '');
    end if;

    update public.inv_vendor_bills
       set status = 'cancelled', updated_at = now()
     where id = v_grn.bill_id and tenant_id = p_tenant_id;
  end if;

  return jsonb_build_object(
    'grn_id', p_grn_id,
    'grn_no', v_grn.grn_no,
    'status', 'void',
    'reversal_voucher_no', v_reversal
  );
end;
$$;

grant execute on function public.inv_void_grn(uuid, text, uuid, text) to service_role;

/**
 * Amend the descriptive parts of a receipt.
 *
 * Deliberately cannot touch quantity, rate, discount or tax — those have
 * already moved stock and money. Anything financial is a void and a re-entry.
 */
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
         note = coalesce(p_payload->>'note', note)
   where id = v_grn_id and tenant_id = p_tenant_id;

  -- The bill quotes the supplier's invoice number, so it follows along;
  -- leaving the two disagreeing is how a payment gets matched to the wrong
  -- invoice at the bank.
  if v_bill_id is not null and (p_payload ? 'supplier_invoice_no') then
    update public.inv_vendor_bills
       set supplier_invoice_no = p_payload->>'supplier_invoice_no',
           updated_at = now()
     where id = v_bill_id and tenant_id = p_tenant_id;
  end if;

  return jsonb_build_object('grn_id', v_grn_id, 'amended', true);
end;
$$;

grant execute on function public.inv_amend_grn(uuid, text, jsonb) to service_role;

notify pgrst, 'reload schema';
