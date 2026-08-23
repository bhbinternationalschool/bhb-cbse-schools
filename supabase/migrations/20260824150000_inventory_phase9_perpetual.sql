-- Inventory & Procurement — Phase 9: perpetual inventory with cost of goods sold.
--
-- The module posted periodic inventory until now: goods were expensed to Store
-- Purchases when they arrived, and a period-end journal brought the unsold
-- balance back. This replaces that with perpetual inventory, at the school's
-- request — the treatment an auditor expects when stock is material.
--
--   receiving        Dr Inventory (1090)              Cr Accounts Payable
--   selling          Dr Cost of Goods Sold (5065)     Cr Inventory
--                    (on the same voucher as the revenue side)
--   sale return      Dr Inventory                     Cr Cost of Goods Sold
--                    — only when the goods are restocked; goods taken back
--                      damaged stay a cost, because they are one
--   purchase return  Dr Accounts Payable              Cr Inventory
--   write-off        Dr Stock Written Off (5066)      Cr Inventory
--
-- The consequences of the switch, each deliberate:
--
--   * Stock adjustments now DO post. Under the old model their cost was
--     already expensed at purchase and posting again would have double-counted;
--     under this one inventory is a live asset, so losing stock must reduce it.
--
--   * Opening stock now posts too — Dr Inventory, Cr Corpus — because the
--     inventory balance has to equal the stock on the shelf from day one. It
--     must therefore NOT also be entered through the ledger's opening-balance
--     screen, or the same goods land twice.
--
--   * The closing-stock journal is retired. Inventory is continuous now; that
--     entry would double-count the same goods. The function refuses rather
--     than being dropped, so anyone who calls it is told why.
--
--   * Transfers still post nothing. Value moving between rooms is not an
--     accounting event.
--
-- Safe to apply here because no store voucher had been posted yet. Applying it
-- to books that already carry periodic entries would need those reversed
-- first — the guard below refuses in that case rather than silently mixing two
-- models in one set of accounts.

/* ─── Refuse to mix the two models ─────────────────────────── */

do $$
declare
  v_bad int;
begin
  select count(*) into v_bad
    from public.ledger_vouchers
   where source_type = 'inv_closing_stock';
  if v_bad > 0 then
    raise exception
      'This ledger has % closing-stock voucher(s) from the periodic model. '
      'Reverse them before switching to perpetual, or the same goods are '
      'counted under both.', v_bad;
  end if;
end
$$;

-- The account kept its code; only what it means changed.
update public.ledger_accounts
   set name = 'Inventory'
 where code = '1090' and name = 'Closing Stock';

/* ─── Receiving capitalises instead of expensing ───────────── */

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

  -- Everything that is part of what the goods cost goes into inventory:
  -- freight, other charges, and GST the school cannot reclaim. That is the
  -- same landed cost the stock ledger records, so the asset balance and the
  -- valuation report agree.
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

/* ─── A purchase return releases inventory ─────────────────── */

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
      'account_code', '1090',
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

/* ─── Selling relieves inventory through COGS ──────────────── */

create or replace function public.inv_ledger_post_sale(
  p_tenant_id uuid,
  p_sale_id uuid,
  p_actor text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale record;
  v_lines jsonb := '[]'::jsonb;
  v_party jsonb;
  v_net bigint;
  v_result jsonb;
  v_pay record;
begin
  if not public.inv_ledger_active(p_tenant_id) then
    return null;
  end if;

  select * into v_sale from public.inv_sales
   where id = p_sale_id and tenant_id = p_tenant_id;
  if not found or v_sale.status = 'void' then
    return null;
  end if;

  v_net := v_sale.subtotal_paise - v_sale.discount_paise;

  v_party := case
    when v_sale.buyer_kind = 'student' and coalesce(v_sale.student_id, '') <> ''
      then jsonb_build_object('kind', 'student', 'external_id', v_sale.student_id,
                              'name', coalesce(v_sale.buyer_name, ''))
    when v_sale.buyer_kind = 'staff' and coalesce(v_sale.staff_id, '') <> ''
      then jsonb_build_object('kind', 'staff', 'external_id', v_sale.staff_id,
                              'name', coalesce(v_sale.buyer_name, ''))
    else null
  end;

  for v_pay in
    select mode, sum(amount_paise) as amt
      from public.inv_sale_payments
     where tenant_id = p_tenant_id and sale_id = p_sale_id
     group by mode
  loop
    if v_pay.amt > 0 then
      v_lines := v_lines || jsonb_build_object(
        'account_code', public.inv_ledger_tender_account(v_pay.mode),
        'debit_paise', v_pay.amt,
        'credit_paise', 0,
        'narration', upper(v_pay.mode),
        'party', v_party
      );
    end if;
  end loop;

  if v_sale.balance_paise > 0 then
    v_lines := v_lines || jsonb_build_object(
      'account_code', '1040',
      'debit_paise', v_sale.balance_paise,
      'credit_paise', 0,
      'narration', 'Store dues — ' || coalesce(v_sale.buyer_name, ''),
      'party', v_party
    );
  end if;

  if v_net > 0 then
    v_lines := v_lines || jsonb_build_object(
      'account_code', '4200',
      'debit_paise', 0,
      'credit_paise', v_net,
      'narration', 'Store sale ' || v_sale.sale_no
    );
  end if;

  if v_sale.tax_paise > 0 then
    v_lines := v_lines || jsonb_build_object(
      'account_code', '2340',
      'debit_paise', 0,
      'credit_paise', v_sale.tax_paise,
      'narration', 'GST on ' || v_sale.sale_no
    );
  end if;

  -- The cost half. cost_paise was frozen on the sale from each line's
  -- weighted-average cost at the moment it was rung up, so the margin the
  -- books show can never drift from the margin the counter showed.
  if v_sale.cost_paise > 0 then
    v_lines := v_lines || jsonb_build_object(
      'account_code', '5065',
      'debit_paise', v_sale.cost_paise,
      'credit_paise', 0,
      'narration', 'Cost of goods on ' || v_sale.sale_no
    );
    v_lines := v_lines || jsonb_build_object(
      'account_code', '1090',
      'debit_paise', 0,
      'credit_paise', v_sale.cost_paise,
      'narration', 'Stock released on ' || v_sale.sale_no
    );
  end if;

  if jsonb_array_length(v_lines) < 2 then
    return null;
  end if;

  v_result := public.ledger_post(p_tenant_id, jsonb_build_object(
    'voucher_type', 'sales',
    'date', v_sale.sale_date,
    'narration', 'Store sale ' || v_sale.sale_no ||
                 case when coalesce(v_sale.buyer_name, '') = '' then ''
                      else ' — ' || v_sale.buyer_name end,
    'source_type', 'inv_sale',
    'source_id', p_sale_id::text,
    'created_by', p_actor,
    'lines', v_lines
  ));

  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'The books refused this sale: %',
      coalesce(v_result->>'error', 'unknown ledger error');
  end if;

  return v_result->>'voucher_no';
end;
$$;

/* ─── A sale return only restores stock if it is restocked ─── */

create or replace function public.inv_ledger_post_sale_return(
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
  v_sale record;
  v_party jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_credit_left bigint;
  v_cost bigint;
  v_result jsonb;
begin
  if not public.inv_ledger_active(p_tenant_id) then
    return null;
  end if;

  select * into v_ret from public.inv_sale_returns
   where id = p_return_id and tenant_id = p_tenant_id;
  if not found or v_ret.total_paise <= 0 then
    return null;
  end if;

  select * into v_sale from public.inv_sales
   where id = v_ret.sale_id and tenant_id = p_tenant_id;

  v_party := case
    when v_sale.buyer_kind = 'student' and coalesce(v_sale.student_id, '') <> ''
      then jsonb_build_object('kind', 'student', 'external_id', v_sale.student_id,
                              'name', coalesce(v_sale.buyer_name, ''))
    when v_sale.buyer_kind = 'staff' and coalesce(v_sale.staff_id, '') <> ''
      then jsonb_build_object('kind', 'staff', 'external_id', v_sale.staff_id,
                              'name', coalesce(v_sale.buyer_name, ''))
    else null
  end;

  if v_ret.subtotal_paise > 0 then
    v_lines := v_lines || jsonb_build_object(
      'account_code', '4200',
      'debit_paise', v_ret.subtotal_paise,
      'credit_paise', 0,
      'narration', 'Return ' || v_ret.return_no
    );
  end if;

  if v_ret.tax_paise > 0 then
    v_lines := v_lines || jsonb_build_object(
      'account_code', '2340',
      'debit_paise', v_ret.tax_paise,
      'credit_paise', 0,
      'narration', 'GST on return ' || v_ret.return_no
    );
  end if;

  v_credit_left := v_ret.total_paise;
  if v_ret.refunded_paise > 0 then
    v_lines := v_lines || jsonb_build_object(
      'account_code',
        public.inv_ledger_tender_account(coalesce(v_ret.refund_mode, 'cash')),
      'debit_paise', 0,
      'credit_paise', v_ret.refunded_paise,
      'narration', 'Refunded',
      'party', v_party
    );
    v_credit_left := v_credit_left - v_ret.refunded_paise;
  end if;

  if v_credit_left > 0 then
    v_lines := v_lines || jsonb_build_object(
      'account_code', '1040',
      'debit_paise', 0,
      'credit_paise', v_credit_left,
      'narration', 'Credited against store dues',
      'party', v_party
    );
  end if;

  -- Only goods that actually went back on the shelf return to inventory.
  -- Something taken back damaged was still a cost of trading, and leaving it
  -- in cost of goods sold is what says so.
  if v_ret.restock then
    select coalesce(sum(round(rl.unit_cost_paise * rl.qty)), 0) into v_cost
      from public.inv_sale_return_lines rl
     where rl.tenant_id = p_tenant_id and rl.return_id = p_return_id;

    if v_cost > 0 then
      v_lines := v_lines || jsonb_build_object(
        'account_code', '1090',
        'debit_paise', v_cost,
        'credit_paise', 0,
        'narration', 'Stock back on ' || v_ret.return_no
      );
      v_lines := v_lines || jsonb_build_object(
        'account_code', '5065',
        'debit_paise', 0,
        'credit_paise', v_cost,
        'narration', 'Cost reversed on ' || v_ret.return_no
      );
    end if;
  end if;

  if jsonb_array_length(v_lines) < 2 then
    return null;
  end if;

  v_result := public.ledger_post(p_tenant_id, jsonb_build_object(
    'voucher_type', 'sales',
    'date', v_ret.return_date,
    'narration', 'Store return ' || v_ret.return_no || ' against ' || v_sale.sale_no,
    'source_type', 'inv_sale_return',
    'source_id', p_return_id::text,
    'created_by', p_actor,
    'lines', v_lines
  ));

  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'The books refused this return: %',
      coalesce(v_result->>'error', 'unknown ledger error');
  end if;

  return v_result->>'voucher_no';
end;
$$;

/* ─── Adjustments and opening stock now post ───────────────── */

/**
 * Correct stock to a counted quantity, and post the difference.
 *
 * Moved into SQL from the TypeScript path so the ledger row and the journal
 * commit together. Under perpetual inventory a shortage is a real loss of a
 * real asset, so it reduces inventory and lands in Stock Written Off; a
 * surplus does the reverse.
 */
create or replace function public.inv_adjust_stock(
  p_tenant_id uuid,
  p_actor text,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_id uuid := (p_payload->>'item_id')::uuid;
  v_location_id uuid := nullif(p_payload->>'location_id', '')::uuid;
  v_counted numeric := coalesce((p_payload->>'counted_qty')::numeric, -1);
  v_reason text := btrim(coalesce(p_payload->>'reason', ''));
  v_at date := coalesce(nullif(p_payload->>'at', '')::date, current_date);
  v_before numeric;
  v_delta numeric;
  v_cost bigint;
  v_value bigint;
  v_result jsonb;
  v_voucher text := null;
begin
  if v_reason = '' then
    raise exception 'A reason is required for a stock adjustment';
  end if;
  if v_counted < 0 then
    raise exception 'Counted quantity must be zero or more';
  end if;

  select coalesce(sum(l.qty_delta), 0) into v_before
    from public.inv_stock_ledger l
   where l.tenant_id = p_tenant_id
     and l.item_id = v_item_id
     and (v_location_id is null or l.location_id = v_location_id);

  v_delta := round(v_counted - v_before, 3);

  if v_delta <> 0 then
    select coalesce(avg_cost_paise, 0) into v_cost
      from public.inv_items where tenant_id = p_tenant_id and id = v_item_id;

    insert into public.inv_stock_ledger (
      tenant_id, item_id, location_id, at, qty_delta, unit_cost_paise,
      kind, ref_type, note, created_by
    ) values (
      p_tenant_id, v_item_id, v_location_id, v_at::timestamptz, v_delta, v_cost,
      case when v_delta > 0 then 'adjust_in' else 'adjust_out' end,
      'adjustment', v_reason, p_actor
    );

    v_value := abs(round(v_delta * v_cost));

    if v_value > 0 and public.inv_ledger_active(p_tenant_id) then
      v_result := public.ledger_post(p_tenant_id, jsonb_build_object(
        'voucher_type', 'journal',
        'date', v_at,
        'narration', 'Stock adjustment — ' || v_reason,
        'source_type', 'inv_stock_adjustment',
        -- Keyed on item, location and date: re-counting the same shelf on the
        -- same day is a correction of that count, not a second loss.
        'source_id', v_item_id::text || ':' ||
                     coalesce(v_location_id::text, '-') || ':' || v_at::text,
        'created_by', p_actor,
        'lines', case when v_delta < 0 then jsonb_build_array(
          jsonb_build_object('account_code', '5066', 'debit_paise', v_value,
                             'credit_paise', 0, 'narration', v_reason),
          jsonb_build_object('account_code', '1090', 'debit_paise', 0,
                             'credit_paise', v_value, 'narration', 'Stock lost')
        ) else jsonb_build_array(
          jsonb_build_object('account_code', '1090', 'debit_paise', v_value,
                             'credit_paise', 0, 'narration', 'Stock found'),
          jsonb_build_object('account_code', '5066', 'debit_paise', 0,
                             'credit_paise', v_value, 'narration', v_reason)
        ) end
      ));

      if not coalesce((v_result->>'ok')::boolean, false) then
        raise exception 'The books refused this adjustment: %',
          coalesce(v_result->>'error', 'unknown ledger error');
      end if;
      v_voucher := v_result->>'voucher_no';
    end if;
  end if;

  return jsonb_build_object(
    'delta', v_delta, 'before', v_before, 'after', v_counted,
    'ledger_voucher_no', coalesce(v_voucher, '')
  );
end;
$$;

/**
 * Set opening stock, and bring it onto the balance sheet.
 *
 * Under perpetual inventory the asset must equal the shelf from day one, so
 * opening stock posts Dr Inventory, Cr Corpus. It must therefore NOT also be
 * entered through the ledger's opening-balance screen — the same goods would
 * land twice.
 *
 * Re-entering a count replaces the previous opening row and reverses its
 * journal, because an opening position is a statement of what is there, not
 * an event that accumulates.
 */
create or replace function public.inv_set_opening_stock(
  p_tenant_id uuid,
  p_actor text,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_id uuid := (p_payload->>'item_id')::uuid;
  v_location_id uuid := nullif(p_payload->>'location_id', '')::uuid;
  v_qty numeric := coalesce((p_payload->>'qty')::numeric, -1);
  v_cost bigint := greatest(0, coalesce((p_payload->>'unit_cost_paise')::bigint, 0));
  v_at date := coalesce(nullif(p_payload->>'at', '')::date, current_date);
  v_source text;
  v_prior uuid;
  v_value bigint;
  v_result jsonb;
  v_voucher text := null;
begin
  if v_qty < 0 then
    raise exception 'Opening quantity must be zero or more';
  end if;

  v_source := v_item_id::text || ':' || coalesce(v_location_id::text, '-');

  delete from public.inv_stock_ledger
   where tenant_id = p_tenant_id
     and item_id = v_item_id
     and kind = 'opening'
     and (v_location_id is null and location_id is null
          or location_id = v_location_id);

  -- Retire the previous opening journal, if any.
  select v.id into v_prior from public.ledger_vouchers v
   where v.tenant_id = p_tenant_id
     and v.source_type = 'inv_opening_stock'
     and v.source_id = v_source
     and not exists (
       select 1 from public.ledger_vouchers r
        where r.tenant_id = p_tenant_id and r.reverses_voucher_id = v.id
     );
  if v_prior is not null then
    v_result := public.ledger_reverse(
      p_tenant_id, v_prior, 'Opening stock re-entered', null, p_actor);
    if not coalesce((v_result->>'ok')::boolean, false) then
      raise exception 'Could not reverse the previous opening stock: %',
        coalesce(v_result->>'error', 'unknown ledger error');
    end if;
  end if;

  if v_qty > 0 then
    insert into public.inv_stock_ledger (
      tenant_id, item_id, location_id, at, qty_delta, unit_cost_paise,
      kind, ref_type, note, created_by
    ) values (
      p_tenant_id, v_item_id, v_location_id, v_at::timestamptz, v_qty, v_cost,
      'opening', 'opening', coalesce(p_payload->>'note', 'Opening stock'), p_actor
    );

    -- Opening stock is also the first cost known for the item.
    if v_cost > 0 then
      update public.inv_items
         set avg_cost_paise = v_cost, updated_at = now()
       where tenant_id = p_tenant_id and id = v_item_id
         and coalesce(avg_cost_paise, 0) = 0;
    end if;

    v_value := round(v_qty * v_cost);

    if v_value > 0 and public.inv_ledger_active(p_tenant_id) then
      v_result := public.ledger_post(p_tenant_id, jsonb_build_object(
        'voucher_type', 'opening',
        'date', v_at,
        'narration', 'Opening stock',
        'source_type', 'inv_opening_stock',
        'source_id', v_source,
        'created_by', p_actor,
        'lines', jsonb_build_array(
          jsonb_build_object('account_code', '1090', 'debit_paise', v_value,
                             'credit_paise', 0, 'narration', 'Opening stock'),
          jsonb_build_object('account_code', '3000', 'debit_paise', 0,
                             'credit_paise', v_value,
                             'narration', 'Opening stock brought in')
        )
      ));

      if not coalesce((v_result->>'ok')::boolean, false) then
        raise exception 'The books refused this opening stock: %',
          coalesce(v_result->>'error', 'unknown ledger error');
      end if;
      v_voucher := v_result->>'voucher_no';
    end if;
  end if;

  return jsonb_build_object('qty', v_qty, 'ledger_voucher_no', coalesce(v_voucher, ''));
end;
$$;

/* ─── The closing-stock journal is retired ─────────────────── */

create or replace function public.inv_ledger_post_closing_stock(
  p_tenant_id uuid,
  p_as_of date,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Kept as a function rather than dropped so a caller is told why, instead of
  -- failing on a missing routine and being left to guess.
  return jsonb_build_object('ok', false, 'error',
    'The store now uses perpetual inventory: goods are capitalised when '
    'received and released through cost of goods sold, so Inventory (1090) is '
    'already correct at any moment. A closing-stock journal would count the '
    'same goods twice.');
end;
$$;

/**
 * Does the ledger's inventory balance match the stock on the shelf?
 *
 * The one check worth running regularly under perpetual inventory. Any gap
 * means an event moved stock without its journal, or the reverse, and the
 * sooner that is seen the smaller it is.
 */
create or replace function public.inv_inventory_parity(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'stock_value_paise', public.inv_stock_value_as_of(p_tenant_id, current_date),
    'ledger_value_paise', coalesce((
      select sum(l.debit_paise) - sum(l.credit_paise)
        from public.ledger_lines l
        join public.ledger_accounts a on a.id = l.account_id
       where a.tenant_id = p_tenant_id and a.code = '1090'
    ), 0),
    'difference_paise',
      public.inv_stock_value_as_of(p_tenant_id, current_date) - coalesce((
        select sum(l.debit_paise) - sum(l.credit_paise)
          from public.ledger_lines l
          join public.ledger_accounts a on a.id = l.account_id
         where a.tenant_id = p_tenant_id and a.code = '1090'
      ), 0)
  );
$$;

grant execute on function public.inv_adjust_stock(uuid, text, jsonb) to service_role;
grant execute on function public.inv_set_opening_stock(uuid, text, jsonb) to service_role;
grant execute on function public.inv_inventory_parity(uuid) to service_role;

notify pgrst, 'reload schema';
