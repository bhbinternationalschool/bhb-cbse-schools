-- Inventory & Procurement — Phase 2: indent → PO → GRN → vendor bill → return.
--
-- The goods receipt is the moment stock, cost and money all move at once, so
-- it is posted by a single database function rather than a sequence of client
-- calls. A half-applied receipt — stock in, bill missing — would be a silent
-- accounting hole, and the Supabase JS client cannot wrap separate requests in
-- one transaction. inv_post_grn() and inv_post_purchase_return() therefore own
-- the whole operation and either complete or roll back.
--
-- Vendor bills live here rather than in the Accounts module on purpose: that
-- module keeps its state in localStorage and its accounts_desk_vendors table
-- is empty in production, so posting a payable into it would repeat the very
-- failure this rebuild exists to fix. Bills carry posted_to_accounts /
-- accounts_ref so the server-authoritative ledger can claim them later.

/* ─── Settings addition ────────────────────────────────────── */

-- A school is largely exempt, so input GST is usually NOT reclaimable and
-- belongs in the cost of the goods. Flip this only if the trust actually
-- claims input credit.
alter table public.inv_settings
  add column if not exists gst_credit_eligible boolean not null default false;

/* ─── Indents — someone asks for something ─────────────────── */

create table if not exists public.inv_indents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  indent_no text not null,
  academic_year_code text not null default '',
  requested_by text not null default '',
  department text not null default '',
  urgency text not null default 'normal' check (urgency in ('normal', 'urgent')),
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'approved', 'rejected', 'converted', 'cancelled')),
  needed_by date,
  note text not null default '',
  decided_by text not null default '',
  decided_at timestamptz,
  decision_note text not null default '',
  estimated_paise bigint not null default 0,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists inv_indents_no_uidx
  on public.inv_indents (tenant_id, indent_no);
create index if not exists inv_indents_status_idx
  on public.inv_indents (tenant_id, status);

create table if not exists public.inv_indent_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  indent_id uuid not null references public.inv_indents(id) on delete cascade,
  -- Null item_id is allowed: an indent may ask for something not yet in the
  -- catalogue. The buyer attaches a real item when raising the order.
  item_id uuid references public.inv_items(id) on delete set null,
  description text not null default '',
  qty numeric(14,3) not null default 0,
  uom_id uuid references public.inv_uoms(id) on delete set null,
  est_rate_paise bigint not null default 0,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists inv_indent_lines_indent_idx
  on public.inv_indent_lines (tenant_id, indent_id);

/* ─── Purchase orders ──────────────────────────────────────── */

create table if not exists public.inv_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  po_no text not null,
  indent_id uuid references public.inv_indents(id) on delete set null,
  vendor_id uuid not null references public.inv_vendors(id) on delete restrict,
  academic_year_code text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'pending_approval', 'approved', 'issued',
                      'partial_grn', 'closed', 'cancelled')),
  order_date date not null default current_date,
  expected_date date,
  subtotal_paise bigint not null default 0,
  discount_paise bigint not null default 0,
  tax_paise bigint not null default 0,
  freight_paise bigint not null default 0,
  total_paise bigint not null default 0,
  approved_by text not null default '',
  approved_at timestamptz,
  approval_note text not null default '',
  issued_at timestamptz,
  terms text not null default '',
  note text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists inv_purchase_orders_no_uidx
  on public.inv_purchase_orders (tenant_id, po_no);
create index if not exists inv_purchase_orders_status_idx
  on public.inv_purchase_orders (tenant_id, status);
create index if not exists inv_purchase_orders_vendor_idx
  on public.inv_purchase_orders (tenant_id, vendor_id);

create table if not exists public.inv_po_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  po_id uuid not null references public.inv_purchase_orders(id) on delete cascade,
  item_id uuid not null references public.inv_items(id) on delete restrict,
  description text not null default '',
  qty numeric(14,3) not null default 0,
  uom_id uuid references public.inv_uoms(id) on delete set null,
  rate_paise bigint not null default 0,
  discount_pct numeric(5,2) not null default 0,
  gst_rate numeric(5,2) not null default 0,
  line_total_paise bigint not null default 0,
  tax_paise bigint not null default 0,
  -- Maintained by inv_post_grn; never set from the client.
  qty_received numeric(14,3) not null default 0,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists inv_po_lines_po_idx
  on public.inv_po_lines (tenant_id, po_id);
create index if not exists inv_po_lines_item_idx
  on public.inv_po_lines (tenant_id, item_id);

/* ─── Goods receipts ───────────────────────────────────────── */

create table if not exists public.inv_goods_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  grn_no text not null,
  -- Null po_id is a direct/cash purchase with no order behind it.
  po_id uuid references public.inv_purchase_orders(id) on delete set null,
  vendor_id uuid not null references public.inv_vendors(id) on delete restrict,
  location_id uuid references public.inv_locations(id) on delete set null,
  academic_year_code text not null default '',
  receipt_date date not null default current_date,
  supplier_invoice_no text not null default '',
  supplier_invoice_date date,
  subtotal_paise bigint not null default 0,
  discount_paise bigint not null default 0,
  tax_paise bigint not null default 0,
  freight_paise bigint not null default 0,
  other_charges_paise bigint not null default 0,
  total_paise bigint not null default 0,
  bill_id uuid,
  note text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now()
);

create unique index if not exists inv_goods_receipts_no_uidx
  on public.inv_goods_receipts (tenant_id, grn_no);
create index if not exists inv_goods_receipts_po_idx
  on public.inv_goods_receipts (tenant_id, po_id);
create index if not exists inv_goods_receipts_vendor_idx
  on public.inv_goods_receipts (tenant_id, vendor_id);

create table if not exists public.inv_grn_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  grn_id uuid not null references public.inv_goods_receipts(id) on delete cascade,
  po_line_id uuid references public.inv_po_lines(id) on delete set null,
  item_id uuid not null references public.inv_items(id) on delete restrict,
  qty_received numeric(14,3) not null default 0,
  qty_rejected numeric(14,3) not null default 0,
  rejection_reason text not null default '',
  rate_paise bigint not null default 0,
  discount_pct numeric(5,2) not null default 0,
  gst_rate numeric(5,2) not null default 0,
  line_total_paise bigint not null default 0,
  tax_paise bigint not null default 0,
  -- Rate net of discount, plus this line's share of freight and of any
  -- non-reclaimable tax. This is what the item actually costs the school and
  -- what feeds the weighted average.
  landed_unit_cost_paise bigint not null default 0,
  batch_no text not null default '',
  expiry_date date,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists inv_grn_lines_grn_idx
  on public.inv_grn_lines (tenant_id, grn_id);
create index if not exists inv_grn_lines_item_idx
  on public.inv_grn_lines (tenant_id, item_id);

/* ─── Vendor bills (payables) ──────────────────────────────── */

create table if not exists public.inv_vendor_bills (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  bill_no text not null,
  vendor_id uuid not null references public.inv_vendors(id) on delete restrict,
  grn_id uuid references public.inv_goods_receipts(id) on delete set null,
  academic_year_code text not null default '',
  supplier_invoice_no text not null default '',
  bill_date date not null default current_date,
  due_date date,
  subtotal_paise bigint not null default 0,
  discount_paise bigint not null default 0,
  tax_paise bigint not null default 0,
  freight_paise bigint not null default 0,
  total_paise bigint not null default 0,
  paid_paise bigint not null default 0,
  status text not null default 'open'
    check (status in ('open', 'part_paid', 'paid', 'cancelled')),
  -- Set when the ledger rebuild picks this bill up; until then the payable
  -- lives only here, and says so honestly.
  posted_to_accounts boolean not null default false,
  accounts_ref text not null default '',
  note text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists inv_vendor_bills_no_uidx
  on public.inv_vendor_bills (tenant_id, bill_no);
create index if not exists inv_vendor_bills_vendor_idx
  on public.inv_vendor_bills (tenant_id, vendor_id, status);

create table if not exists public.inv_vendor_bill_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  bill_id uuid not null references public.inv_vendor_bills(id) on delete cascade,
  item_id uuid references public.inv_items(id) on delete set null,
  description text not null default '',
  qty numeric(14,3) not null default 0,
  rate_paise bigint not null default 0,
  amount_paise bigint not null default 0,
  gst_rate numeric(5,2) not null default 0,
  tax_paise bigint not null default 0,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists inv_vendor_bill_lines_bill_idx
  on public.inv_vendor_bill_lines (tenant_id, bill_id);

create table if not exists public.inv_vendor_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  payment_no text not null,
  vendor_id uuid not null references public.inv_vendors(id) on delete restrict,
  bill_id uuid references public.inv_vendor_bills(id) on delete set null,
  paid_on date not null default current_date,
  amount_paise bigint not null default 0,
  mode text not null default 'bank'
    check (mode in ('cash', 'bank', 'upi', 'cheque', 'neft', 'rtgs', 'imps', 'card')),
  reference text not null default '',
  posted_to_accounts boolean not null default false,
  accounts_ref text not null default '',
  note text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now()
);

create unique index if not exists inv_vendor_payments_no_uidx
  on public.inv_vendor_payments (tenant_id, payment_no);
create index if not exists inv_vendor_payments_bill_idx
  on public.inv_vendor_payments (tenant_id, bill_id);

/* ─── Purchase returns (debit notes) ───────────────────────── */

create table if not exists public.inv_purchase_returns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  return_no text not null,
  grn_id uuid references public.inv_goods_receipts(id) on delete set null,
  vendor_id uuid not null references public.inv_vendors(id) on delete restrict,
  academic_year_code text not null default '',
  return_date date not null default current_date,
  location_id uuid references public.inv_locations(id) on delete set null,
  reason text not null default '',
  subtotal_paise bigint not null default 0,
  tax_paise bigint not null default 0,
  total_paise bigint not null default 0,
  bill_id uuid references public.inv_vendor_bills(id) on delete set null,
  note text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now()
);

create unique index if not exists inv_purchase_returns_no_uidx
  on public.inv_purchase_returns (tenant_id, return_no);

create table if not exists public.inv_purchase_return_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  return_id uuid not null references public.inv_purchase_returns(id) on delete cascade,
  grn_line_id uuid references public.inv_grn_lines(id) on delete set null,
  item_id uuid not null references public.inv_items(id) on delete restrict,
  qty numeric(14,3) not null default 0,
  rate_paise bigint not null default 0,
  amount_paise bigint not null default 0,
  gst_rate numeric(5,2) not null default 0,
  tax_paise bigint not null default 0,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists inv_purchase_return_lines_return_idx
  on public.inv_purchase_return_lines (tenant_id, return_id);

/* ─── Goods receipt posting ────────────────────────────────── */

/**
 * Post a goods receipt: stock in, costs updated, vendor bill raised.
 *
 * One function, one transaction. Every step below either all happens or none
 * of it does:
 *   1. validate the lines against the order (no silent over-receipt)
 *   2. price each line net of discount, and apportion freight, other charges
 *      and non-reclaimable tax across lines by value → landed unit cost
 *   3. write the receipt and its lines
 *   4. post purchase_in rows to the stock ledger at landed cost
 *   5. roll the weighted-average cost on each item
 *   6. remember the vendor's rate for this item
 *   7. advance the order's received quantities and status
 *   8. raise the vendor bill
 *
 * Returns {grn_id, grn_no, bill_id, bill_no, total_paise}.
 */
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

    v_net_rate := round(
      coalesce((v_line->>'rate_paise')::numeric, 0)
      * (1 - least(greatest(coalesce((v_line->>'discount_pct')::numeric, 0), 0), 100) / 100)
    );
    v_line_total := round(v_net_rate * v_qty);
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
$$;

/* ─── Purchase return posting ──────────────────────────────── */

/**
 * Return goods to a vendor: stock out, debit note raised.
 *
 * Returns are capped at what was received and not already returned, so a
 * return can never push a receipt negative. Average cost is deliberately left
 * alone: sending goods back at the price paid does not change what the
 * remaining stock cost.
 */
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
  v_id uuid;
  v_no text;
  v_ay text := coalesce(p_payload->>'academic_year_code', '');
  v_grn_id uuid := nullif(p_payload->>'grn_id', '')::uuid;
  v_vendor_id uuid := nullif(p_payload->>'vendor_id', '')::uuid;
  v_location_id uuid := nullif(p_payload->>'location_id', '')::uuid;
  v_date date := coalesce(nullif(p_payload->>'return_date', '')::date, current_date);
  v_reason text := coalesce(p_payload->>'reason', '');
  v_lines jsonb := coalesce(p_payload->'lines', '[]'::jsonb);
  v_line jsonb;
  v_qty numeric;
  v_received numeric;
  v_returned numeric;
  v_rate bigint;
  v_amount bigint;
  v_tax bigint;
  v_subtotal bigint := 0;
  v_tax_total bigint := 0;
  v_item_id uuid;
begin
  if v_vendor_id is null then
    raise exception 'A vendor is required for a purchase return';
  end if;
  if btrim(v_reason) = '' then
    raise exception 'A reason is required for a purchase return';
  end if;
  if jsonb_array_length(v_lines) = 0 then
    raise exception 'A purchase return needs at least one line';
  end if;

  v_no := public.inv_next_doc_no(
    p_tenant_id, 'purchase_return', v_ay,
    coalesce((select doc_prefixes->>'purchase_return' from public.inv_settings
               where tenant_id = p_tenant_id), 'PR')
  );

  insert into public.inv_purchase_returns (
    tenant_id, return_no, grn_id, vendor_id, academic_year_code,
    return_date, location_id, reason, note, created_by
  ) values (
    p_tenant_id, v_no, v_grn_id, v_vendor_id, v_ay,
    v_date, v_location_id, v_reason,
    coalesce(p_payload->>'note', ''), p_actor
  ) returning id into v_id;

  for v_line in select * from jsonb_array_elements(v_lines)
  loop
    v_qty := coalesce((v_line->>'qty')::numeric, 0);
    if v_qty <= 0 then
      raise exception 'Return quantity must be more than zero on every line';
    end if;

    if nullif(v_line->>'grn_line_id', '') is not null then
      select g.qty_received, g.item_id, g.landed_unit_cost_paise
        into v_received, v_item_id, v_rate
        from public.inv_grn_lines g
       where g.id = (v_line->>'grn_line_id')::uuid
         and g.tenant_id = p_tenant_id;
      if v_received is null then
        raise exception 'Receipt line not found';
      end if;

      select coalesce(sum(rl.qty), 0) into v_returned
        from public.inv_purchase_return_lines rl
       where rl.tenant_id = p_tenant_id
         and rl.grn_line_id = (v_line->>'grn_line_id')::uuid
         and rl.return_id <> v_id;

      if v_returned + v_qty > v_received then
        raise exception
          'Cannot return % — only % of the % received remain unreturned',
          v_qty, v_received - v_returned, v_received;
      end if;
    else
      v_item_id := (v_line->>'item_id')::uuid;
      v_rate := coalesce((v_line->>'rate_paise')::bigint, 0);
    end if;

    -- An explicit rate on the line wins; otherwise use what was paid.
    if nullif(v_line->>'rate_paise', '') is not null then
      v_rate := (v_line->>'rate_paise')::bigint;
    end if;

    v_amount := round(v_rate * v_qty);
    v_tax := round(v_amount * coalesce((v_line->>'gst_rate')::numeric, 0) / 100);
    v_subtotal := v_subtotal + v_amount;
    v_tax_total := v_tax_total + v_tax;

    insert into public.inv_purchase_return_lines (
      tenant_id, return_id, grn_line_id, item_id, qty, rate_paise,
      amount_paise, gst_rate, tax_paise
    ) values (
      p_tenant_id, v_id,
      nullif(v_line->>'grn_line_id', '')::uuid,
      v_item_id, v_qty, v_rate, v_amount,
      coalesce((v_line->>'gst_rate')::numeric, 0), v_tax
    );

    insert into public.inv_stock_ledger (
      tenant_id, item_id, location_id, at, qty_delta, unit_cost_paise,
      kind, ref_type, ref_id, ref_no, note, created_by
    ) values (
      p_tenant_id, v_item_id, v_location_id, v_date::timestamptz,
      -v_qty, v_rate, 'purchase_return_out', 'purchase_return', v_id, v_no,
      v_reason, p_actor
    );
  end loop;

  update public.inv_purchase_returns
     set subtotal_paise = v_subtotal,
         tax_paise = v_tax_total,
         total_paise = v_subtotal + v_tax_total
   where id = v_id and tenant_id = p_tenant_id;

  return jsonb_build_object(
    'return_id', v_id,
    'return_no', v_no,
    'subtotal_paise', v_subtotal,
    'tax_paise', v_tax_total,
    'total_paise', v_subtotal + v_tax_total
  );
end;
$$;

/* ─── RLS + grants ─────────────────────────────────────────── */

do $$
declare
  t text;
begin
  foreach t in array array[
    'inv_indents', 'inv_indent_lines',
    'inv_purchase_orders', 'inv_po_lines',
    'inv_goods_receipts', 'inv_grn_lines',
    'inv_vendor_bills', 'inv_vendor_bill_lines', 'inv_vendor_payments',
    'inv_purchase_returns', 'inv_purchase_return_lines'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_tenant_all', t);
    execute format(
      'create policy %I on public.%I for all using (public.is_tenant_member(tenant_id))',
      t || '_tenant_all', t
    );
    execute format(
      'grant select, insert, update, delete on public.%I to service_role', t
    );
  end loop;
end
$$;

grant execute on function public.inv_post_grn(uuid, text, jsonb) to service_role;
grant execute on function public.inv_post_purchase_return(uuid, text, jsonb) to service_role;

notify pgrst, 'reload schema';

/* ─── Receipt → bill link ──────────────────────────────────── */

-- Added after both tables exist: inv_goods_receipts.bill_id is declared as a
-- bare uuid above because inv_vendor_bills is created later in this file and
-- references the receipt in the other direction. Without a real constraint
-- PostgREST cannot resolve the embed, so a receipt reported no bill number
-- even when it had one.
alter table public.inv_goods_receipts
  drop constraint if exists inv_goods_receipts_bill_id_fkey;
alter table public.inv_goods_receipts
  add constraint inv_goods_receipts_bill_id_fkey
  foreign key (bill_id) references public.inv_vendor_bills(id) on delete set null;

create index if not exists inv_goods_receipts_bill_idx
  on public.inv_goods_receipts (tenant_id, bill_id);

notify pgrst, 'reload schema';
