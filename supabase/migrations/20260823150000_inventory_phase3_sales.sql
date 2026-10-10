-- Inventory & Procurement — Phase 3: the sales counter.
--
-- A sale moves stock out, records what it cost us (so margin is a fact, not a
-- later reconstruction), takes payment, and may leave a balance owing. Like a
-- goods receipt, that is several things at once, so it is posted by one
-- database function inside one transaction.
--
-- On credit sales and Fee Take: a balance owed for store goods is held here,
-- on inv_sales.balance_paise. It is deliberately NOT written into
-- fee_desk_open_dues. That table is a projection the fees client rebuilds
-- wholesale through fee_desk_replace_open_dues(), which deletes every row for
-- the academic year that is absent from the browser's payload — and the fees
-- client derives its store dues from the OLD localStorage store. A due written
-- here would survive only until the next fee push. Linking store dues to the
-- fee counter belongs with the fees/ledger rebuild, when dues are derived
-- server-side; until then the store owns its own receivable and says so.

/* ─── Settings additions ───────────────────────────────────── */

alter table public.inv_settings
  add column if not exists allow_credit_sales boolean not null default true;
alter table public.inv_settings
  add column if not exists staff_discount_pct numeric(5,2) not null default 0;

/* ─── Sales ────────────────────────────────────────────────── */

create table if not exists public.inv_sales (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sale_no text not null,
  academic_year_code text not null default '',
  sale_date date not null default current_date,
  buyer_kind text not null default 'student'
    check (buyer_kind in ('student', 'staff', 'walkin')),
  -- sis_students.id is text, and is referenced rather than joined by FK: the
  -- roster is a separate module with its own identity history.
  student_id text not null default '',
  staff_id text not null default '',
  -- Name and class are snapshotted so an old receipt still reads correctly
  -- after a student is promoted, renamed or leaves.
  buyer_name text not null default '',
  buyer_phone text not null default '',
  class_id text not null default '',
  location_id uuid references public.inv_locations(id) on delete set null,
  price_list_id uuid references public.inv_price_lists(id) on delete set null,
  kit_id uuid references public.inv_kits(id) on delete set null,
  subtotal_paise bigint not null default 0,
  discount_paise bigint not null default 0,
  tax_paise bigint not null default 0,
  total_paise bigint not null default 0,
  paid_paise bigint not null default 0,
  balance_paise bigint not null default 0,
  -- Total of avg cost × qty at the moment of sale, for margin reporting.
  cost_paise bigint not null default 0,
  status text not null default 'open'
    check (status in ('open', 'part_paid', 'paid', 'void')),
  note text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by text not null default '',
  void_reason text not null default ''
);

create unique index if not exists inv_sales_no_uidx
  on public.inv_sales (tenant_id, sale_no);
create index if not exists inv_sales_student_idx
  on public.inv_sales (tenant_id, student_id);
create index if not exists inv_sales_date_idx
  on public.inv_sales (tenant_id, sale_date desc);
create index if not exists inv_sales_status_idx
  on public.inv_sales (tenant_id, status);

create table if not exists public.inv_sale_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sale_id uuid not null references public.inv_sales(id) on delete cascade,
  item_id uuid not null references public.inv_items(id) on delete restrict,
  -- Name snapshot, same reasoning as the buyer's.
  item_name text not null default '',
  sku text not null default '',
  qty numeric(14,3) not null default 0,
  unit_price_paise bigint not null default 0,
  discount_pct numeric(5,2) not null default 0,
  discount_paise bigint not null default 0,
  line_total_paise bigint not null default 0,
  gst_rate numeric(5,2) not null default 0,
  tax_paise bigint not null default 0,
  -- Weighted-average cost at the instant of sale. Frozen here so a later
  -- purchase at a different price cannot rewrite this sale's margin.
  unit_cost_paise bigint not null default 0,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists inv_sale_lines_sale_idx
  on public.inv_sale_lines (tenant_id, sale_id);
create index if not exists inv_sale_lines_item_idx
  on public.inv_sale_lines (tenant_id, item_id);

create table if not exists public.inv_sale_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sale_id uuid not null references public.inv_sales(id) on delete cascade,
  receipt_no text not null default '',
  paid_on date not null default current_date,
  amount_paise bigint not null default 0,
  mode text not null default 'cash'
    check (mode in ('cash', 'upi', 'card', 'cheque', 'bank', 'neft', 'rtgs', 'imps')),
  reference text not null default '',
  note text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists inv_sale_payments_sale_idx
  on public.inv_sale_payments (tenant_id, sale_id);
create index if not exists inv_sale_payments_date_idx
  on public.inv_sale_payments (tenant_id, paid_on desc);

/* ─── Sale returns ─────────────────────────────────────────── */

create table if not exists public.inv_sale_returns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  return_no text not null,
  sale_id uuid not null references public.inv_sales(id) on delete restrict,
  academic_year_code text not null default '',
  return_date date not null default current_date,
  location_id uuid references public.inv_locations(id) on delete set null,
  reason text not null default '',
  subtotal_paise bigint not null default 0,
  tax_paise bigint not null default 0,
  total_paise bigint not null default 0,
  -- How the money went back: reduce what they still owe, or hand cash back.
  settlement text not null default 'reduce_balance'
    check (settlement in ('reduce_balance', 'refund')),
  refunded_paise bigint not null default 0,
  refund_mode text not null default '',
  -- Goods that came back damaged do not go back on the shelf.
  restock boolean not null default true,
  note text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now()
);

create unique index if not exists inv_sale_returns_no_uidx
  on public.inv_sale_returns (tenant_id, return_no);
create index if not exists inv_sale_returns_sale_idx
  on public.inv_sale_returns (tenant_id, sale_id);

create table if not exists public.inv_sale_return_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  return_id uuid not null references public.inv_sale_returns(id) on delete cascade,
  sale_line_id uuid references public.inv_sale_lines(id) on delete set null,
  item_id uuid not null references public.inv_items(id) on delete restrict,
  qty numeric(14,3) not null default 0,
  unit_price_paise bigint not null default 0,
  amount_paise bigint not null default 0,
  gst_rate numeric(5,2) not null default 0,
  tax_paise bigint not null default 0,
  unit_cost_paise bigint not null default 0,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists inv_sale_return_lines_return_idx
  on public.inv_sale_return_lines (tenant_id, return_id);

/* ─── Sale posting ─────────────────────────────────────────── */

/**
 * Post a counter sale.
 *
 * In one transaction: check stock, enforce the per-item discount cap, price
 * every line, freeze the cost, write the sale, take stock out of the ledger,
 * and record any money handed over. Anything left unpaid becomes a balance on
 * the sale itself.
 *
 * The discount cap matters: max_discount_pct on the price list is the reason
 * the counter cannot quietly give the head's nephew 60% off. It is enforced
 * here, in the database, not only in the form.
 *
 * Returns {sale_id, sale_no, total_paise, paid_paise, balance_paise}.
 */
create or replace function public.inv_post_sale(
  p_tenant_id uuid,
  p_actor text,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale_id uuid;
  v_sale_no text;
  v_ay text := coalesce(p_payload->>'academic_year_code', '');
  v_buyer_kind text := coalesce(p_payload->>'buyer_kind', 'student');
  v_location_id uuid := nullif(p_payload->>'location_id', '')::uuid;
  v_price_list_id uuid := nullif(p_payload->>'price_list_id', '')::uuid;
  v_sale_date date := coalesce(nullif(p_payload->>'sale_date', '')::date, current_date);
  v_lines jsonb := coalesce(p_payload->'lines', '[]'::jsonb);
  v_payments jsonb := coalesce(p_payload->'payments', '[]'::jsonb);
  v_line jsonb;
  v_pay jsonb;
  v_qty numeric;
  v_price bigint;
  v_disc_pct numeric;
  v_disc_paise bigint;
  v_line_total bigint;
  v_tax bigint;
  v_cost bigint;
  v_cap numeric;
  v_on_hand numeric;
  v_allow_negative boolean;
  v_allow_credit boolean;
  v_subtotal bigint := 0;
  v_discount bigint := 0;
  v_tax_total bigint := 0;
  v_cost_total bigint := 0;
  v_total bigint := 0;
  v_paid bigint := 0;
  v_balance bigint;
  v_status text;
  v_item_name text;
  v_sku text;
  v_idx int := 0;
begin
  if jsonb_array_length(v_lines) = 0 then
    raise exception 'A sale needs at least one item';
  end if;

  select coalesce(allow_negative_stock, false), coalesce(allow_credit_sales, true)
    into v_allow_negative, v_allow_credit
    from public.inv_settings where tenant_id = p_tenant_id;
  v_allow_negative := coalesce(v_allow_negative, false);
  v_allow_credit := coalesce(v_allow_credit, true);

  if v_price_list_id is null then
    select id into v_price_list_id from public.inv_price_lists
     where tenant_id = p_tenant_id and is_default limit 1;
  end if;

  v_sale_no := public.inv_next_doc_no(
    p_tenant_id, 'sale', v_ay,
    coalesce((select doc_prefixes->>'sale' from public.inv_settings
               where tenant_id = p_tenant_id), 'SL')
  );

  insert into public.inv_sales (
    tenant_id, sale_no, academic_year_code, sale_date, buyer_kind,
    student_id, staff_id, buyer_name, buyer_phone, class_id,
    location_id, price_list_id, kit_id, note, created_by
  ) values (
    p_tenant_id, v_sale_no, v_ay, v_sale_date, v_buyer_kind,
    coalesce(p_payload->>'student_id', ''),
    coalesce(p_payload->>'staff_id', ''),
    coalesce(p_payload->>'buyer_name', ''),
    coalesce(p_payload->>'buyer_phone', ''),
    coalesce(p_payload->>'class_id', ''),
    v_location_id, v_price_list_id,
    nullif(p_payload->>'kit_id', '')::uuid,
    coalesce(p_payload->>'note', ''), p_actor
  ) returning id into v_sale_id;

  for v_line in select * from jsonb_array_elements(v_lines)
  loop
    v_idx := v_idx + 1;
    v_qty := coalesce((v_line->>'qty')::numeric, 0);
    if v_qty <= 0 then
      raise exception 'Quantity must be more than zero on every line';
    end if;

    select i.name, i.sku, coalesce(i.avg_cost_paise, 0)
      into v_item_name, v_sku, v_cost
      from public.inv_items i
     where i.tenant_id = p_tenant_id and i.id = (v_line->>'item_id')::uuid;
    if v_item_name is null then
      raise exception 'Item not found on line %', v_idx;
    end if;

    -- Selling what is not there leaves a negative balance nothing explains.
    if not v_allow_negative then
      select coalesce(sum(l.qty_delta), 0) into v_on_hand
        from public.inv_stock_ledger l
       where l.tenant_id = p_tenant_id
         and l.item_id = (v_line->>'item_id')::uuid
         and (v_location_id is null or l.location_id = v_location_id);
      if v_on_hand < v_qty then
        raise exception 'Only % of % in stock — cannot sell %',
          v_on_hand, v_item_name, v_qty;
      end if;
    end if;

    v_price := coalesce((v_line->>'unit_price_paise')::bigint, 0);
    v_disc_pct := greatest(coalesce((v_line->>'discount_pct')::numeric, 0), 0);

    -- The cap the price list sets for this item.
    select coalesce(max_discount_pct, 0) into v_cap
      from public.inv_price_list_items
     where tenant_id = p_tenant_id
       and price_list_id = v_price_list_id
       and item_id = (v_line->>'item_id')::uuid;
    v_cap := coalesce(v_cap, 0);

    if v_disc_pct > v_cap then
      -- The word "percent" rather than a literal % sign: in a format string
      -- %% is an escaped percent and % is a placeholder, so "%%%" renders as
      -- "%15" instead of "15%". Spelling it out avoids the trap entirely.
      raise exception
        'A % percent discount on % is more than the % percent allowed on this item',
        v_disc_pct, v_item_name, v_cap;
    end if;

    v_disc_paise := round(v_price * v_qty * v_disc_pct / 100);
    v_line_total := round(v_price * v_qty) - v_disc_paise;
    v_tax := round(v_line_total * coalesce((v_line->>'gst_rate')::numeric, 0) / 100);

    v_subtotal := v_subtotal + round(v_price * v_qty);
    v_discount := v_discount + v_disc_paise;
    v_tax_total := v_tax_total + v_tax;
    v_cost_total := v_cost_total + round(v_cost * v_qty);

    insert into public.inv_sale_lines (
      tenant_id, sale_id, item_id, item_name, sku, qty, unit_price_paise,
      discount_pct, discount_paise, line_total_paise, gst_rate, tax_paise,
      unit_cost_paise, sort_order
    ) values (
      p_tenant_id, v_sale_id, (v_line->>'item_id')::uuid, v_item_name, v_sku,
      v_qty, v_price, v_disc_pct, v_disc_paise, v_line_total,
      coalesce((v_line->>'gst_rate')::numeric, 0), v_tax, v_cost, v_idx
    );

    insert into public.inv_stock_ledger (
      tenant_id, item_id, location_id, at, qty_delta, unit_cost_paise,
      kind, ref_type, ref_id, ref_no, note, created_by
    ) values (
      p_tenant_id, (v_line->>'item_id')::uuid, v_location_id,
      v_sale_date::timestamptz, -v_qty, v_cost,
      'sale_out', 'sale', v_sale_id, v_sale_no, '', p_actor
    );
  end loop;

  v_total := v_subtotal - v_discount + v_tax_total;

  for v_pay in select * from jsonb_array_elements(v_payments)
  loop
    if coalesce((v_pay->>'amount_paise')::bigint, 0) <= 0 then
      continue;
    end if;
    v_paid := v_paid + (v_pay->>'amount_paise')::bigint;
    insert into public.inv_sale_payments (
      tenant_id, sale_id, paid_on, amount_paise, mode, reference, created_by
    ) values (
      p_tenant_id, v_sale_id, v_sale_date,
      (v_pay->>'amount_paise')::bigint,
      coalesce(v_pay->>'mode', 'cash'),
      coalesce(v_pay->>'reference', ''), p_actor
    );
  end loop;

  if v_paid > v_total then
    raise exception 'Tendered % is more than the sale total of % — check the amounts',
      v_paid, v_total;
  end if;

  v_balance := v_total - v_paid;

  if v_balance > 0 and not v_allow_credit then
    raise exception 'Credit sales are switched off — the full amount must be collected';
  end if;

  v_status := case
    when v_balance <= 0 then 'paid'
    when v_paid > 0 then 'part_paid'
    else 'open'
  end;

  update public.inv_sales
     set subtotal_paise = v_subtotal,
         discount_paise = v_discount,
         tax_paise = v_tax_total,
         total_paise = v_total,
         cost_paise = v_cost_total,
         paid_paise = v_paid,
         balance_paise = v_balance,
         status = v_status,
         updated_at = now()
   where id = v_sale_id and tenant_id = p_tenant_id;

  return jsonb_build_object(
    'sale_id', v_sale_id,
    'sale_no', v_sale_no,
    'subtotal_paise', v_subtotal,
    'discount_paise', v_discount,
    'tax_paise', v_tax_total,
    'total_paise', v_total,
    'paid_paise', v_paid,
    'balance_paise', v_balance,
    'status', v_status
  );
end;
$$;

/* ─── Sale return posting ──────────────────────────────────── */

/**
 * Take goods back from a buyer.
 *
 * Capped at what was sold and not already returned. Stock comes back at the
 * cost frozen on the sale line — not today's average — so returning an item
 * cannot shift the valuation of stock bought at another price. Damaged goods
 * can be taken back without restocking, in which case the money moves but the
 * shelf does not.
 */
create or replace function public.inv_post_sale_return(
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
  v_sale_id uuid := nullif(p_payload->>'sale_id', '')::uuid;
  v_ay text := coalesce(p_payload->>'academic_year_code', '');
  v_date date := coalesce(nullif(p_payload->>'return_date', '')::date, current_date);
  v_reason text := coalesce(p_payload->>'reason', '');
  v_settlement text := coalesce(p_payload->>'settlement', 'reduce_balance');
  v_restock boolean := coalesce((p_payload->>'restock')::boolean, true);
  v_location_id uuid := nullif(p_payload->>'location_id', '')::uuid;
  v_lines jsonb := coalesce(p_payload->'lines', '[]'::jsonb);
  v_line jsonb;
  v_qty numeric;
  v_sold numeric;
  v_returned numeric;
  v_price bigint;
  v_cost bigint;
  v_gst numeric;
  v_item_id uuid;
  v_amount bigint;
  v_tax bigint;
  v_subtotal bigint := 0;
  v_tax_total bigint := 0;
  v_total bigint;
  v_sale_balance bigint;
  v_sale_paid bigint;
  v_sale_total bigint;
  v_reduce bigint := 0;
  v_refund bigint := 0;
  v_idx int := 0;
begin
  if v_sale_id is null then
    raise exception 'A sale return must reference the original sale';
  end if;
  if btrim(v_reason) = '' then
    raise exception 'A reason is required for a sale return';
  end if;
  if jsonb_array_length(v_lines) = 0 then
    raise exception 'A sale return needs at least one line';
  end if;

  if exists (select 1 from public.inv_sales
              where id = v_sale_id and tenant_id = p_tenant_id and status = 'void') then
    raise exception 'That sale was cancelled — there is nothing to return against it';
  end if;

  v_no := public.inv_next_doc_no(
    p_tenant_id, 'sale_return', v_ay,
    coalesce((select doc_prefixes->>'sale_return' from public.inv_settings
               where tenant_id = p_tenant_id), 'SR')
  );

  if v_location_id is null then
    select location_id into v_location_id from public.inv_sales
     where id = v_sale_id and tenant_id = p_tenant_id;
  end if;

  insert into public.inv_sale_returns (
    tenant_id, return_no, sale_id, academic_year_code, return_date,
    location_id, reason, settlement, restock, note, created_by
  ) values (
    p_tenant_id, v_no, v_sale_id, v_ay, v_date,
    v_location_id, v_reason, v_settlement, v_restock,
    coalesce(p_payload->>'note', ''), p_actor
  ) returning id into v_id;

  for v_line in select * from jsonb_array_elements(v_lines)
  loop
    v_idx := v_idx + 1;
    v_qty := coalesce((v_line->>'qty')::numeric, 0);
    if v_qty <= 0 then
      raise exception 'Return quantity must be more than zero on every line';
    end if;

    select l.qty, l.item_id,
           -- Price actually charged after the line's discount.
           case when l.qty > 0 then round(l.line_total_paise / l.qty) else 0 end,
           l.unit_cost_paise, l.gst_rate
      into v_sold, v_item_id, v_price, v_cost, v_gst
      from public.inv_sale_lines l
     where l.id = (v_line->>'sale_line_id')::uuid
       and l.tenant_id = p_tenant_id
       and l.sale_id = v_sale_id;
    if v_sold is null then
      raise exception 'Sale line not found on line %', v_idx;
    end if;

    select coalesce(sum(rl.qty), 0) into v_returned
      from public.inv_sale_return_lines rl
     where rl.tenant_id = p_tenant_id
       and rl.sale_line_id = (v_line->>'sale_line_id')::uuid
       and rl.return_id <> v_id;

    if v_returned + v_qty > v_sold then
      raise exception 'Cannot return % — only % of the % sold remain unreturned',
        v_qty, v_sold - v_returned, v_sold;
    end if;

    v_amount := round(v_price * v_qty);
    v_tax := round(v_amount * coalesce(v_gst, 0) / 100);
    v_subtotal := v_subtotal + v_amount;
    v_tax_total := v_tax_total + v_tax;

    insert into public.inv_sale_return_lines (
      tenant_id, return_id, sale_line_id, item_id, qty, unit_price_paise,
      amount_paise, gst_rate, tax_paise, unit_cost_paise, sort_order
    ) values (
      p_tenant_id, v_id, (v_line->>'sale_line_id')::uuid, v_item_id,
      v_qty, v_price, v_amount, coalesce(v_gst, 0), v_tax, v_cost, v_idx
    );

    if v_restock then
      insert into public.inv_stock_ledger (
        tenant_id, item_id, location_id, at, qty_delta, unit_cost_paise,
        kind, ref_type, ref_id, ref_no, note, created_by
      ) values (
        p_tenant_id, v_item_id, v_location_id, v_date::timestamptz,
        v_qty, v_cost, 'sale_return_in', 'sale_return', v_id, v_no,
        v_reason, p_actor
      );
    end if;
  end loop;

  v_total := v_subtotal + v_tax_total;

  select balance_paise, paid_paise, total_paise
    into v_sale_balance, v_sale_paid, v_sale_total
    from public.inv_sales where id = v_sale_id and tenant_id = p_tenant_id;

  -- Credit what they still owe first; only what is left over is cash back.
  -- Refunding money to someone who has not paid is how a counter leaks.
  if v_settlement = 'refund' then
    v_refund := least(v_total, v_sale_paid);
    v_reduce := v_total - v_refund;
  else
    v_reduce := least(v_total, v_sale_balance);
    v_refund := 0;
  end if;

  update public.inv_sales
     set total_paise = greatest(0, total_paise - v_total),
         paid_paise = greatest(0, paid_paise - v_refund),
         balance_paise = greatest(0, balance_paise - v_reduce),
         status = case
           when greatest(0, total_paise - v_total) <= 0 then 'paid'
           when greatest(0, balance_paise - v_reduce) <= 0 then 'paid'
           when greatest(0, paid_paise - v_refund) > 0 then 'part_paid'
           else 'open'
         end,
         updated_at = now()
   where id = v_sale_id and tenant_id = p_tenant_id;

  update public.inv_sale_returns
     set subtotal_paise = v_subtotal,
         tax_paise = v_tax_total,
         total_paise = v_total,
         refunded_paise = v_refund,
         refund_mode = case when v_refund > 0
                            then coalesce(p_payload->>'refund_mode', 'cash')
                            else '' end
   where id = v_id and tenant_id = p_tenant_id;

  return jsonb_build_object(
    'return_id', v_id,
    'return_no', v_no,
    'subtotal_paise', v_subtotal,
    'tax_paise', v_tax_total,
    'total_paise', v_total,
    'refunded_paise', v_refund,
    'balance_reduced_paise', v_reduce
  );
end;
$$;

/* ─── Void a sale ──────────────────────────────────────────── */

/**
 * Cancel a sale posted in error.
 *
 * The sale is kept and marked void — a receipt number that vanishes is worse
 * than one marked cancelled — and the stock it took out is put back with a
 * reversing ledger entry that names the reason. A sale with returns against
 * it cannot be voided; unwind those first, so the two mechanisms cannot both
 * credit the same goods.
 */
create or replace function public.inv_void_sale(
  p_tenant_id uuid,
  p_actor text,
  p_sale_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_no text;
  v_status text;
  v_location uuid;
  v_line record;
begin
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'A reason is required to cancel a sale';
  end if;

  select sale_no, status, location_id into v_no, v_status, v_location
    from public.inv_sales where id = p_sale_id and tenant_id = p_tenant_id;
  if v_no is null then
    raise exception 'Sale not found';
  end if;
  if v_status = 'void' then
    raise exception 'That sale is already cancelled';
  end if;
  if exists (select 1 from public.inv_sale_returns
              where sale_id = p_sale_id and tenant_id = p_tenant_id) then
    raise exception
      'This sale has returns against it — reverse those before cancelling it';
  end if;

  for v_line in
    select item_id, qty, unit_cost_paise
      from public.inv_sale_lines
     where sale_id = p_sale_id and tenant_id = p_tenant_id
  loop
    insert into public.inv_stock_ledger (
      tenant_id, item_id, location_id, at, qty_delta, unit_cost_paise,
      kind, ref_type, ref_id, ref_no, note, created_by
    ) values (
      p_tenant_id, v_line.item_id, v_location, now(),
      v_line.qty, v_line.unit_cost_paise, 'sale_return_in',
      'sale_void', p_sale_id, v_no, 'Sale cancelled: ' || p_reason, p_actor
    );
  end loop;

  update public.inv_sales
     set status = 'void',
         balance_paise = 0,
         voided_at = now(),
         voided_by = p_actor,
         void_reason = p_reason,
         updated_at = now()
   where id = p_sale_id and tenant_id = p_tenant_id;

  return jsonb_build_object('sale_id', p_sale_id, 'sale_no', v_no, 'status', 'void');
end;
$$;

/* ─── RLS + grants ─────────────────────────────────────────── */

do $$
declare
  t text;
begin
  foreach t in array array[
    'inv_sales', 'inv_sale_lines', 'inv_sale_payments',
    'inv_sale_returns', 'inv_sale_return_lines'
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

grant execute on function public.inv_post_sale(uuid, text, jsonb) to service_role;
grant execute on function public.inv_post_sale_return(uuid, text, jsonb) to service_role;
grant execute on function public.inv_void_sale(uuid, text, uuid, text) to service_role;

notify pgrst, 'reload schema';
