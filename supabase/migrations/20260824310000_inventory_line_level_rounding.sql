-- Extend a purchase line before rounding it, so the bill ties to the vendor's.
--
-- Found by checking a real receipt: on a 160-unit line at ₹97.46 less 30%, the
-- school's books said ₹10,915.20 where the supplier's invoice says ₹10,915.52.
-- Eight of the nine lines on that receipt agreed exactly; only the one with an
-- awkward unit price did not.
--
-- The cause was the ORDER of two operations, not the GST rate. The net unit
-- rate was rounded to whole paise first (₹97.46 × 0.7 = ₹68.222 → ₹68.22) and
-- then multiplied by the quantity. That buries a fraction of a paisa in every
-- unit, so the gap grows with the order — 32 paise at 160 units, a few rupees
-- on a thousand. A GST invoice extends the line first and rounds once.
--
-- Deliberately NOT restated: the existing receipt and its ledger voucher are
-- left alone. Correcting 32 paise on a posted purchase would mean an adjusting
-- entry against inventory and the payable, and a permanent 32-paise voucher in
-- the books is worse than the discrepancy it corrects. New receipts compute
-- the standard way.
--
-- The per-unit figure (`net_rate_paise`) stays rounded, because landed cost is
-- built from it and a per-unit cost must be a whole number of paise whatever
-- the line comes to. Only the line extension and its tax change.
--
-- The body below is the live `inv_post_grn_core` with that one block changed;
-- it was taken from the database rather than retyped, so none of the stock,
-- costing, weighted-average or purchase-order logic around it can drift.

CREATE OR REPLACE FUNCTION public.inv_post_grn_core(p_tenant_id uuid, p_actor text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_grn_id uuid;
  v_grn_no text;
  v_bill_id uuid;
  v_bill_no text;
  v_ay text := coalesce(p_payload->>'academic_year_code', '');
  v_po_id uuid := nullif(p_payload->>'po_id', '')::uuid;
  v_vendor_id uuid := nullif(p_payload->>'vendor_id', '')::uuid;
  v_location_id uuid := nullif(p_payload->>'location_id', '')::uuid;
  v_receipt_date date := coalesce(nullif(p_payload->>'receipt_date', '')::date, current_date);
  v_freight bigint := coalesce((p_payload->>'freight_paise')::bigint, 0);
  v_other bigint := coalesce((p_payload->>'other_charges_paise')::bigint, 0);
  v_create_bill boolean := coalesce((p_payload->>'create_bill')::boolean, true);
  v_gst_credit boolean;
  v_prefix text;
  v_line jsonb;
  v_subtotal bigint := 0;
  v_tax_total bigint := 0;
  v_total bigint := 0;
  v_addon bigint := 0;
  v_terms int := 0;
  v_ordered numeric;
  v_already numeric;
  v_net_rate bigint;
  v_net_rate_exact numeric;
  v_line_total bigint;
  v_line_tax bigint;
  v_qty numeric;
  v_lines jsonb := coalesce(p_payload->'lines', '[]'::jsonb);
  v_priced jsonb := '[]'::jsonb;
  v_grn_line_id uuid;
  v_landed bigint;
  v_prev_qty numeric;
  v_prev_avg bigint;
  v_new_avg bigint;
begin
  if v_vendor_id is null then
    raise exception 'A vendor is required to receive goods';
  end if;
  if jsonb_array_length(v_lines) = 0 then
    raise exception 'A goods receipt needs at least one line';
  end if;

  select coalesce(gst_credit_eligible, false),
         coalesce(doc_prefixes->>'grn', 'GRN')
    into v_gst_credit, v_prefix
    from public.inv_settings where tenant_id = p_tenant_id;
  v_gst_credit := coalesce(v_gst_credit, false);
  v_prefix := coalesce(v_prefix, 'GRN');

  -- 1 + 2: validate and price every line before writing anything.
  for v_line in select * from jsonb_array_elements(v_lines)
  loop
    v_qty := coalesce((v_line->>'qty_received')::numeric, 0);
    if v_qty <= 0 then
      raise exception 'Received quantity must be more than zero on every line';
    end if;

    if nullif(v_line->>'po_line_id', '') is not null then
      select l.qty, l.qty_received into v_ordered, v_already
        from public.inv_po_lines l
       where l.id = (v_line->>'po_line_id')::uuid
         and l.tenant_id = p_tenant_id;
      if v_ordered is null then
        raise exception 'Order line not found';
      end if;
      -- Receiving more than was ordered is almost always a keying error, and
      -- it silently inflates both stock and the payable. Amend the order.
      if v_already + v_qty > v_ordered then
        raise exception
          'Cannot receive % — only % of % remain on the order line',
          v_qty, v_ordered - v_already, v_ordered;
      end if;
    end if;

    -- Extend the line from the UNROUNDED net rate, and round once.
    --
    -- Rounding the per-unit rate to whole paise first and then multiplying is
    -- what put a 160-unit line 32 paise under the supplier's invoice: the
    -- error is per unit, so it grows with the order. A GST invoice extends the
    -- line and rounds the result, and now so does this, which is what lets the
    -- school's bill tie to the vendor's to the paisa.
    --
    -- v_net_rate stays the rounded unit figure. It is what the receipt shows
    -- per unit and what landed cost is built from, and a per-unit cost has to
    -- be a whole number of paise whatever the line comes to.
    v_net_rate_exact :=
      coalesce((v_line->>'rate_paise')::numeric, 0)
      * (1 - least(greatest(coalesce((v_line->>'discount_pct')::numeric, 0), 0), 100) / 100);
    v_net_rate := round(v_net_rate_exact);
    v_line_total := round(v_net_rate_exact * v_qty);
    v_line_tax := round(v_line_total * coalesce((v_line->>'gst_rate')::numeric, 0) / 100);

    v_subtotal := v_subtotal + v_line_total;
    v_tax_total := v_tax_total + v_line_tax;

    v_priced := v_priced || jsonb_build_object(
      'po_line_id', v_line->>'po_line_id',
      'item_id', v_line->>'item_id',
      'qty_received', v_qty,
      'qty_rejected', coalesce((v_line->>'qty_rejected')::numeric, 0),
      'rejection_reason', coalesce(v_line->>'rejection_reason', ''),
      'rate_paise', coalesce((v_line->>'rate_paise')::bigint, 0),
      'discount_pct', coalesce((v_line->>'discount_pct')::numeric, 0),
      'gst_rate', coalesce((v_line->>'gst_rate')::numeric, 0),
      'net_rate_paise', v_net_rate,
      'line_total_paise', v_line_total,
      'tax_paise', v_line_tax,
      'batch_no', coalesce(v_line->>'batch_no', ''),
      'expiry_date', v_line->>'expiry_date'
    );
  end loop;

  v_total := v_subtotal + v_tax_total + v_freight + v_other;

  -- Charges that attach to the goods rather than to the supplier: freight,
  -- other charges, and GST when the school cannot reclaim it.
  v_addon := v_freight + v_other + case when v_gst_credit then 0 else v_tax_total end;

  v_grn_no := public.inv_next_doc_no(p_tenant_id, 'grn', v_ay, v_prefix);

  insert into public.inv_goods_receipts (
    tenant_id, grn_no, po_id, vendor_id, location_id, academic_year_code,
    receipt_date, supplier_invoice_no, supplier_invoice_date,
    subtotal_paise, discount_paise, tax_paise, freight_paise,
    other_charges_paise, total_paise, note, created_by
  ) values (
    p_tenant_id, v_grn_no, v_po_id, v_vendor_id, v_location_id, v_ay,
    v_receipt_date,
    coalesce(p_payload->>'supplier_invoice_no', ''),
    nullif(p_payload->>'supplier_invoice_date', '')::date,
    v_subtotal, 0, v_tax_total, v_freight, v_other, v_total,
    coalesce(p_payload->>'note', ''), p_actor
  ) returning id into v_grn_id;

  -- 3 → 7, line by line.
  for v_line in select * from jsonb_array_elements(v_priced)
  loop
    v_qty := (v_line->>'qty_received')::numeric;
    v_line_total := (v_line->>'line_total_paise')::bigint;

    -- Share of the add-on charges, by line value. A zero-value receipt (free
    -- replacement stock) splits them evenly rather than dividing by zero.
    v_landed := (v_line->>'net_rate_paise')::bigint
      + case
          when v_addon = 0 then 0
          when v_subtotal > 0 then round(v_addon * v_line_total / v_subtotal / v_qty)
          else round(v_addon / jsonb_array_length(v_priced) / v_qty)
        end;

    insert into public.inv_grn_lines (
      tenant_id, grn_id, po_line_id, item_id, qty_received, qty_rejected,
      rejection_reason, rate_paise, discount_pct, gst_rate,
      line_total_paise, tax_paise, landed_unit_cost_paise,
      batch_no, expiry_date
    ) values (
      p_tenant_id, v_grn_id,
      nullif(v_line->>'po_line_id', '')::uuid,
      (v_line->>'item_id')::uuid,
      v_qty,
      (v_line->>'qty_rejected')::numeric,
      v_line->>'rejection_reason',
      (v_line->>'rate_paise')::bigint,
      (v_line->>'discount_pct')::numeric,
      (v_line->>'gst_rate')::numeric,
      v_line_total,
      (v_line->>'tax_paise')::bigint,
      v_landed,
      v_line->>'batch_no',
      nullif(v_line->>'expiry_date', '')::date
    ) returning id into v_grn_line_id;

    -- 4: stock in, valued at landed cost.
    insert into public.inv_stock_ledger (
      tenant_id, item_id, location_id, at, qty_delta, unit_cost_paise,
      kind, ref_type, ref_id, ref_no, note, created_by
    ) values (
      p_tenant_id, (v_line->>'item_id')::uuid, v_location_id,
      v_receipt_date::timestamptz, v_qty, v_landed,
      'purchase_in', 'grn', v_grn_id, v_grn_no, '', p_actor
    );

    -- 5: roll the weighted average over the quantity held before this receipt.
    select coalesce(sum(l.qty_delta), 0) - v_qty
      into v_prev_qty
      from public.inv_stock_ledger l
     where l.tenant_id = p_tenant_id
       and l.item_id = (v_line->>'item_id')::uuid;

    select coalesce(avg_cost_paise, 0) into v_prev_avg
      from public.inv_items
     where tenant_id = p_tenant_id and id = (v_line->>'item_id')::uuid;

    if v_prev_qty <= 0 then
      -- Nothing on hand beforehand (or a negative balance we should not
      -- average against): this receipt sets the cost outright.
      v_new_avg := v_landed;
    else
      v_new_avg := round(
        ((v_prev_qty * v_prev_avg) + (v_qty * v_landed)) / (v_prev_qty + v_qty)
      );
    end if;

    update public.inv_items
       set avg_cost_paise = v_new_avg,
           last_purchase_paise = (v_line->>'net_rate_paise')::bigint,
           updated_at = now()
     where tenant_id = p_tenant_id and id = (v_line->>'item_id')::uuid;

    -- 6: what this vendor charged, for the next order's default.
    insert into public.inv_vendor_item_rates (
      tenant_id, vendor_id, item_id, rate_paise, discount_pct, gst_rate,
      last_purchased_on, updated_at
    ) values (
      p_tenant_id, v_vendor_id, (v_line->>'item_id')::uuid,
      (v_line->>'rate_paise')::bigint,
      (v_line->>'discount_pct')::numeric,
      (v_line->>'gst_rate')::numeric,
      v_receipt_date, now()
    )
    on conflict (tenant_id, vendor_id, item_id) do update
      set rate_paise = excluded.rate_paise,
          discount_pct = excluded.discount_pct,
          gst_rate = excluded.gst_rate,
          last_purchased_on = excluded.last_purchased_on,
          updated_at = now();

    -- 7: order progress.
    if nullif(v_line->>'po_line_id', '') is not null then
      update public.inv_po_lines
         set qty_received = qty_received + v_qty
       where tenant_id = p_tenant_id
         and id = (v_line->>'po_line_id')::uuid;
    end if;
  end loop;

  -- Close the order when every line is fully received, else mark it partial.
  if v_po_id is not null then
    update public.inv_purchase_orders po
       set status = case
             when not exists (
               select 1 from public.inv_po_lines l
                where l.po_id = po.id and l.qty_received < l.qty
             ) then 'closed'
             else 'partial_grn'
           end,
           updated_at = now()
     where po.id = v_po_id and po.tenant_id = p_tenant_id
       and po.status not in ('cancelled', 'closed');
  end if;

  -- 8: the payable.
  if v_create_bill then
    select coalesce(payment_terms_days, 0) into v_terms
      from public.inv_vendors
     where tenant_id = p_tenant_id and id = v_vendor_id;

    v_bill_no := public.inv_next_doc_no(
      p_tenant_id, 'bill', v_ay,
      coalesce((select doc_prefixes->>'bill' from public.inv_settings
                 where tenant_id = p_tenant_id), 'BILL')
    );

    insert into public.inv_vendor_bills (
      tenant_id, bill_no, vendor_id, grn_id, academic_year_code,
      supplier_invoice_no, bill_date, due_date,
      subtotal_paise, tax_paise, freight_paise, total_paise,
      status, note, created_by
    ) values (
      p_tenant_id, v_bill_no, v_vendor_id, v_grn_id, v_ay,
      coalesce(p_payload->>'supplier_invoice_no', ''),
      v_receipt_date,
      v_receipt_date + make_interval(days => coalesce(v_terms, 0)),
      v_subtotal, v_tax_total, v_freight + v_other, v_total,
      'open', coalesce(p_payload->>'note', ''), p_actor
    ) returning id into v_bill_id;

    insert into public.inv_vendor_bill_lines (
      tenant_id, bill_id, item_id, description, qty, rate_paise,
      amount_paise, gst_rate, tax_paise, sort_order
    )
    select
      p_tenant_id, v_bill_id, (l->>'item_id')::uuid,
      coalesce(i.name, ''),
      (l->>'qty_received')::numeric,
      (l->>'net_rate_paise')::bigint,
      (l->>'line_total_paise')::bigint,
      (l->>'gst_rate')::numeric,
      (l->>'tax_paise')::bigint,
      row_number() over ()
    from jsonb_array_elements(v_priced) l
    left join public.inv_items i
      on i.id = (l->>'item_id')::uuid and i.tenant_id = p_tenant_id;

    update public.inv_goods_receipts
       set bill_id = v_bill_id
     where id = v_grn_id and tenant_id = p_tenant_id;
  end if;

  return jsonb_build_object(
    'grn_id', v_grn_id,
    'grn_no', v_grn_no,
    'bill_id', v_bill_id,
    'bill_no', v_bill_no,
    'subtotal_paise', v_subtotal,
    'tax_paise', v_tax_total,
    'total_paise', v_total
  );
end;
$function$;

notify pgrst, 'reload schema';
