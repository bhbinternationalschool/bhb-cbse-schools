-- Inventory: amend a goods receipt's QUANTITIES, RATES, DISCOUNTS and GST —
-- with everything they touch restated in the same transaction.
--
-- Supersedes 20260825210000's inv_amend_grn (dates only). A line change
-- moves five things at once, and this function refuses to move fewer:
--   1. the GRN lines (recomputed with the same extend-before-rounding rule
--      as inv_post_grn — the bill must tie to the vendor's invoice),
--   2. the stock ledger (this receipt's inbound rows are restated; goods
--      already issued beyond the new quantity refuse cleanly),
--   3. weighted-average costs (inv_recompute_avg_cost per touched item),
--   4. the purchase order's received quantities,
--   5. the bill and its ledger voucher (reverse + repost, sequenced source).
--
-- NOT amendable here: adding or removing line items, freight/other charges —
-- those change what the document IS; cancel and re-enter so the correction
-- leaves a document-level trail.

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
  v_grn record;
  v_bill record;
  v_grn_id uuid := nullif(p_payload->>'grn_id', '')::uuid;
  v_new_receipt date := nullif(p_payload->>'receipt_date', '')::date;
  v_new_bill_date date := nullif(p_payload->>'bill_date', '')::date;
  v_line_patches jsonb := coalesce(p_payload->'lines', '[]'::jsonb);
  v_patch jsonb;
  v_line record;
  v_gst_credit boolean;
  v_qty numeric;
  v_rate bigint;
  v_disc numeric;
  v_gst numeric;
  v_net_rate_exact numeric;
  v_net_rate bigint;
  v_line_total bigint;
  v_line_tax bigint;
  v_subtotal bigint := 0;
  v_tax_total bigint := 0;
  v_total bigint;
  v_addon bigint;
  v_landed bigint;
  v_on_hand numeric;
  v_ordered numeric;
  v_already numeric;
  v_lines_changed boolean := false;
  v_bill_changed boolean := false;
  v_old_bill_date date;
  v_voucher record;
  v_rev jsonb;
  v_seq integer;
  v_new_voucher text;
  v_items uuid[] := '{}';
  v_recalced jsonb := '[]'::jsonb;
begin
  select * into v_grn from public.inv_goods_receipts
   where id = v_grn_id and tenant_id = p_tenant_id
   for update;
  if not found then
    raise exception 'Goods receipt not found';
  end if;
  if v_grn.status = 'void' then
    raise exception 'That goods receipt is cancelled and cannot be amended';
  end if;

  /* ── invoice fields and dates, as before ─────────────────── */

  update public.inv_goods_receipts
     set supplier_invoice_no =
           coalesce(p_payload->>'supplier_invoice_no', supplier_invoice_no),
         supplier_invoice_date =
           coalesce(nullif(p_payload->>'supplier_invoice_date', '')::date,
                    supplier_invoice_date),
         receipt_date = coalesce(v_new_receipt, receipt_date),
         note = coalesce(p_payload->>'note', note)
   where id = v_grn_id and tenant_id = p_tenant_id;

  if v_grn.bill_id is not null and (p_payload ? 'supplier_invoice_no') then
    update public.inv_vendor_bills
       set supplier_invoice_no = p_payload->>'supplier_invoice_no',
           updated_at = now()
     where id = v_grn.bill_id and tenant_id = p_tenant_id;
  end if;

  /* ── line amendments ─────────────────────────────────────── */

  if jsonb_array_length(v_line_patches) > 0 then
    if exists (
      select 1 from public.inv_purchase_returns
       where grn_id = v_grn_id and tenant_id = p_tenant_id
    ) then
      raise exception
        'This receipt has a purchase return against it — reverse that first, then amend';
    end if;

    -- Apply the patches onto the stored lines, in memory first.
    for v_line in
      select l.*, i.name as item_name
        from public.inv_grn_lines l
        join public.inv_items i on i.id = l.item_id
       where l.grn_id = v_grn_id and l.tenant_id = p_tenant_id
       order by l.sort_order, l.created_at
    loop
      v_patch := null;
      select p into v_patch
        from jsonb_array_elements(v_line_patches) p
       where p->>'line_id' = v_line.id::text;

      v_qty  := coalesce((v_patch->>'qty_received')::numeric, v_line.qty_received);
      v_rate := coalesce((v_patch->>'rate_paise')::bigint, v_line.rate_paise);
      v_disc := coalesce((v_patch->>'discount_pct')::numeric, v_line.discount_pct);
      v_gst  := coalesce((v_patch->>'gst_rate')::numeric, v_line.gst_rate);

      if v_qty < 0 or v_rate < 0 then
        raise exception 'Quantity and rate cannot be negative (%).', v_line.item_name;
      end if;
      if v_qty = 0 then
        raise exception
          'Quantity for % cannot be zero — remove the item by cancelling and re-entering the receipt',
          v_line.item_name;
      end if;
      v_disc := least(greatest(coalesce(v_disc, 0), 0), 100);

      if v_qty is distinct from v_line.qty_received
         or v_rate is distinct from v_line.rate_paise
         or v_disc is distinct from v_line.discount_pct
         or v_gst is distinct from v_line.gst_rate then
        v_lines_changed := true;
      end if;

      -- Goods already issued cap how far the quantity can come down.
      if v_qty < v_line.qty_received then
        select coalesce(sum(qty_delta), 0) into v_on_hand
          from public.inv_stock_ledger
         where tenant_id = p_tenant_id and item_id = v_line.item_id;
        if v_on_hand - v_line.qty_received + v_qty < 0 then
          raise exception
            'Cannot cut % to % — only % on hand, the rest already issued or sold',
            v_line.item_name, v_qty, v_on_hand;
        end if;
      end if;

      -- The order must still be able to hold the received quantity.
      if v_line.po_line_id is not null and v_qty > v_line.qty_received then
        select qty_ordered,
               coalesce((select sum(g.qty_received) from public.inv_grn_lines g
                          where g.po_line_id = v_line.po_line_id
                            and g.tenant_id = p_tenant_id
                            and g.id <> v_line.id), 0)
          into v_ordered, v_already
          from public.inv_po_lines
         where id = v_line.po_line_id and tenant_id = p_tenant_id;
        if v_ordered is not null and v_already + v_qty > v_ordered then
          raise exception
            'Cannot receive % of % — only % of % remain on the order line',
            v_qty, v_line.item_name, v_ordered - v_already, v_ordered;
        end if;
      end if;

      -- Same arithmetic as inv_post_grn: extend the unrounded net rate,
      -- round once. Anything else and the bill stops tying to the invoice.
      v_net_rate_exact := v_rate * (1 - v_disc / 100);
      v_net_rate := round(v_net_rate_exact);
      v_line_total := round(v_net_rate_exact * v_qty);
      v_line_tax := round(v_line_total * coalesce(v_gst, 0) / 100);

      v_subtotal := v_subtotal + v_line_total;
      v_tax_total := v_tax_total + v_line_tax;

      v_recalced := v_recalced || jsonb_build_object(
        'id', v_line.id,
        'item_id', v_line.item_id,
        'po_line_id', v_line.po_line_id,
        'old_qty', v_line.qty_received,
        'qty', v_qty,
        'rate', v_rate,
        'disc', v_disc,
        'gst', v_gst,
        'net_rate', v_net_rate,
        'line_total', v_line_total,
        'line_tax', v_line_tax
      );
    end loop;

    if v_lines_changed then
      select coalesce(gst_credit_eligible, false) into v_gst_credit
        from public.inv_settings where tenant_id = p_tenant_id;
      v_gst_credit := coalesce(v_gst_credit, false);

      v_total := v_subtotal + v_tax_total + v_grn.freight_paise + v_grn.other_charges_paise;
      v_addon := v_grn.freight_paise + v_grn.other_charges_paise
               + case when v_gst_credit then 0 else v_tax_total end;

      -- The bill must still be coverable by what has been paid.
      if v_grn.bill_id is not null then
        select * into v_bill from public.inv_vendor_bills
         where id = v_grn.bill_id and tenant_id = p_tenant_id
         for update;
        if found and v_bill.paid_paise > v_total then
          raise exception
            'The bill has % paid against it — the amended total % is less. Record a purchase return or a refund first',
            to_char(v_bill.paid_paise / 100.0, 'FM99999990.00'),
            to_char(v_total / 100.0, 'FM99999990.00');
        end if;
      end if;

      -- Restate lines, this receipt's stock rows, order progress.
      for v_patch in select * from jsonb_array_elements(v_recalced)
      loop
        v_landed := (v_patch->>'net_rate')::bigint
          + case
              when v_addon = 0 then 0
              when v_subtotal > 0 then
                round(v_addon * (v_patch->>'line_total')::bigint / v_subtotal
                      / (v_patch->>'qty')::numeric)
              else round(v_addon / jsonb_array_length(v_recalced)
                         / (v_patch->>'qty')::numeric)
            end;

        update public.inv_grn_lines
           set qty_received = (v_patch->>'qty')::numeric,
               rate_paise = (v_patch->>'rate')::bigint,
               discount_pct = (v_patch->>'disc')::numeric,
               gst_rate = (v_patch->>'gst')::numeric,
               line_total_paise = (v_patch->>'line_total')::bigint,
               tax_paise = (v_patch->>'line_tax')::bigint,
               landed_unit_cost_paise = v_landed
         where id = (v_patch->>'id')::uuid and tenant_id = p_tenant_id;

        if nullif(v_patch->>'po_line_id', '') is not null then
          update public.inv_po_lines
             set qty_received = greatest(
                   0,
                   qty_received - (v_patch->>'old_qty')::numeric
                                + (v_patch->>'qty')::numeric)
           where id = (v_patch->>'po_line_id')::uuid and tenant_id = p_tenant_id;
        end if;

        v_items := array_append(v_items, (v_patch->>'item_id')::uuid);
      end loop;

      -- This receipt's own inbound rows are restated with it — unlike a
      -- void, the document is not history, it is being corrected.
      delete from public.inv_stock_ledger
       where tenant_id = p_tenant_id
         and ref_type = 'grn' and ref_id = v_grn_id
         and kind = 'purchase_in';

      for v_patch in select * from jsonb_array_elements(v_recalced)
      loop
        v_landed := (select landed_unit_cost_paise from public.inv_grn_lines
                      where id = (v_patch->>'id')::uuid);
        insert into public.inv_stock_ledger (
          tenant_id, item_id, location_id, at, qty_delta, unit_cost_paise,
          kind, ref_type, ref_id, ref_no, note, created_by
        ) values (
          p_tenant_id, (v_patch->>'item_id')::uuid, v_grn.location_id,
          coalesce(v_new_receipt, v_grn.receipt_date)::timestamptz,
          (v_patch->>'qty')::numeric, v_landed,
          'purchase_in', 'grn', v_grn_id, v_grn.grn_no,
          'Amended by ' || p_actor, p_actor
        );
      end loop;

      -- Averages rebuilt from the whole ledger, per touched item.
      for v_line in select distinct u as item_id from unnest(v_items) u
      loop
        perform public.inv_recompute_avg_cost(p_tenant_id, v_line.item_id);
      end loop;

      update public.inv_goods_receipts
         set subtotal_paise = v_subtotal,
             tax_paise = v_tax_total,
             total_paise = v_total
       where id = v_grn_id and tenant_id = p_tenant_id;

      if v_grn.bill_id is not null then
        update public.inv_vendor_bills
           set subtotal_paise = v_subtotal,
               tax_paise = v_tax_total,
               total_paise = v_total,
               status = case
                 when status = 'cancelled' then status
                 when paid_paise >= v_total then 'paid'
                 when paid_paise > 0 then 'part_paid'
                 else 'open'
               end,
               updated_at = now()
         where id = v_grn.bill_id and tenant_id = p_tenant_id;
        v_bill_changed := true;
      end if;
    end if;
  end if;

  /* ── bill date, as before ────────────────────────────────── */

  if v_grn.bill_id is not null and v_new_bill_date is not null then
    select bill_date into v_old_bill_date
      from public.inv_vendor_bills
     where id = v_grn.bill_id and tenant_id = p_tenant_id;
    if v_old_bill_date is distinct from v_new_bill_date then
      update public.inv_vendor_bills
         set bill_date = v_new_bill_date, updated_at = now()
       where id = v_grn.bill_id and tenant_id = p_tenant_id;
      v_bill_changed := true;
    end if;
  end if;

  /* ── the books follow: reverse the live voucher, repost ──── */

  if v_bill_changed and v_grn.bill_id is not null then
    select v.id, v.voucher_no into v_voucher
      from public.ledger_vouchers v
     where v.tenant_id = p_tenant_id
       and v.source_type = 'inv_vendor_bill'
       and (v.source_id = v_grn.bill_id::text
            or v.source_id like v_grn.bill_id::text || '#%')
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
        'Receipt ' || v_grn.grn_no || ' amended by ' || p_actor,
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
         and (source_id = v_grn.bill_id::text
              or source_id like v_grn.bill_id::text || '#%');

      v_new_voucher := public.inv_ledger_post_vendor_bill(
        p_tenant_id, v_grn.bill_id, p_actor, v_seq
      );
    end if;
  end if;

  return jsonb_build_object(
    'grn_id', v_grn_id,
    'amended', true,
    'lines_changed', v_lines_changed,
    'total_paise', coalesce(v_total, v_grn.total_paise),
    'ledger_voucher_no', coalesce(v_new_voucher, '')
  );
end;
$$;

grant execute on function public.inv_amend_grn(uuid, text, jsonb) to service_role;

notify pgrst, 'reload schema';
