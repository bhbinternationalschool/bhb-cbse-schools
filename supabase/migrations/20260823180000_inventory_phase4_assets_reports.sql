-- Inventory & Procurement — Phase 4: asset register and reporting.
--
-- Two additions. First, an asset register: furniture, lab gear and IT
-- equipment are not consumed on issue, they are tagged and live somewhere with
-- someone responsible for them, and their history matters more than their
-- quantity. Second, the aggregate reports, written as SQL functions because
-- summing a year of sale lines in application code means fetching a year of
-- sale lines.

/* ─── Asset register ───────────────────────────────────────── */

create table if not exists public.inv_assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- What kind of thing it is; the individual unit is this row.
  item_id uuid not null references public.inv_items(id) on delete restrict,
  asset_tag text not null,
  serial_no text not null default '',
  location_id uuid references public.inv_locations(id) on delete set null,
  -- Free text: the custodian may be a staff member, a class teacher or a
  -- department, and tying this to one roster would exclude the others.
  custodian text not null default '',
  department text not null default '',
  room text not null default '',
  condition text not null default 'good'
    check (condition in ('new', 'good', 'fair', 'poor', 'scrapped')),
  status text not null default 'in_use'
    check (status in ('in_use', 'in_store', 'under_repair', 'scrapped', 'lost')),
  purchase_date date,
  purchase_cost_paise bigint not null default 0,
  grn_id uuid references public.inv_goods_receipts(id) on delete set null,
  warranty_until date,
  notes text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One tag, one asset. A duplicate tag makes the register useless for finding
-- the thing it names.
create unique index if not exists inv_assets_tag_uidx
  on public.inv_assets (tenant_id, lower(asset_tag));
create index if not exists inv_assets_item_idx
  on public.inv_assets (tenant_id, item_id);
create index if not exists inv_assets_location_idx
  on public.inv_assets (tenant_id, location_id);
create index if not exists inv_assets_status_idx
  on public.inv_assets (tenant_id, status);

-- Append-only history: where an asset went, who had it, what state it was in.
create table if not exists public.inv_asset_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  asset_id uuid not null references public.inv_assets(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null check (kind in (
    'registered', 'assigned', 'moved', 'repair_in', 'repair_out',
    'condition', 'scrapped', 'lost', 'found', 'note'
  )),
  from_value text not null default '',
  to_value text not null default '',
  note text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists inv_asset_events_asset_idx
  on public.inv_asset_events (tenant_id, asset_id, at desc);

/* ─── Reports ──────────────────────────────────────────────── */

/**
 * Item-wise sales, cost and margin over a date range.
 *
 * Cancelled sales are excluded and returns are netted off, so "sold" means
 * goods that actually stayed with the buyer. Cost comes from the frozen
 * unit_cost_paise on each line, not from today's average, so a report of last
 * term does not change when this term's prices do.
 */
create or replace function public.inv_report_margin(
  p_tenant_id uuid,
  p_from date,
  p_to date
) returns table (
  item_id uuid,
  sku text,
  item_name text,
  category_name text,
  qty_sold numeric,
  revenue_paise bigint,
  cost_paise bigint,
  margin_paise bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with sold as (
    select l.item_id,
           sum(l.qty) as qty,
           sum(l.line_total_paise) as revenue,
           sum(round(l.unit_cost_paise * l.qty)) as cost
      from public.inv_sale_lines l
      join public.inv_sales s on s.id = l.sale_id
     where l.tenant_id = p_tenant_id
       and s.status <> 'void'
       and s.sale_date between p_from and p_to
     group by l.item_id
  ),
  returned as (
    select rl.item_id,
           sum(rl.qty) as qty,
           sum(rl.amount_paise) as revenue,
           sum(round(rl.unit_cost_paise * rl.qty)) as cost
      from public.inv_sale_return_lines rl
      join public.inv_sale_returns r on r.id = rl.return_id
     where rl.tenant_id = p_tenant_id
       and r.return_date between p_from and p_to
     group by rl.item_id
  )
  select
    i.id,
    i.sku,
    i.name,
    coalesce(c.name, ''),
    coalesce(s.qty, 0) - coalesce(rt.qty, 0),
    (coalesce(s.revenue, 0) - coalesce(rt.revenue, 0))::bigint,
    (coalesce(s.cost, 0) - coalesce(rt.cost, 0))::bigint,
    ((coalesce(s.revenue, 0) - coalesce(rt.revenue, 0))
      - (coalesce(s.cost, 0) - coalesce(rt.cost, 0)))::bigint
  from sold s
  full outer join returned rt on rt.item_id = s.item_id
  join public.inv_items i on i.id = coalesce(s.item_id, rt.item_id)
  left join public.inv_categories c on c.id = i.category_id
  where i.tenant_id = p_tenant_id
  order by 8 desc;
$$;

/**
 * The counter's day book: one row per sale, plus how it was paid.
 *
 * Payments are aggregated per sale rather than joined row-by-row, so a sale
 * settled in two tenders appears once with both named, not twice.
 */
create or replace function public.inv_report_daybook(
  p_tenant_id uuid,
  p_from date,
  p_to date
) returns table (
  sale_id uuid,
  sale_no text,
  sale_date date,
  buyer_name text,
  buyer_kind text,
  item_count numeric,
  total_paise bigint,
  paid_paise bigint,
  balance_paise bigint,
  cost_paise bigint,
  margin_paise bigint,
  status text,
  tenders text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    s.sale_no,
    s.sale_date,
    s.buyer_name,
    s.buyer_kind,
    coalesce((select sum(l.qty) from public.inv_sale_lines l
               where l.sale_id = s.id), 0),
    s.total_paise,
    s.paid_paise,
    s.balance_paise,
    s.cost_paise,
    case when s.status = 'void' then 0
         else s.total_paise - s.cost_paise end,
    s.status,
    coalesce((
      select string_agg(distinct p.mode, ', ' order by p.mode)
        from public.inv_sale_payments p
       where p.sale_id = s.id
    ), '')
  from public.inv_sales s
 where s.tenant_id = p_tenant_id
   and s.sale_date between p_from and p_to
 order by s.created_at desc;
$$;

/**
 * Vendor-wise purchasing over a period: what we bought and what we still owe.
 */
create or replace function public.inv_report_purchases(
  p_tenant_id uuid,
  p_from date,
  p_to date
) returns table (
  vendor_id uuid,
  vendor_name text,
  receipt_count bigint,
  goods_paise bigint,
  tax_paise bigint,
  charges_paise bigint,
  total_paise bigint,
  returned_paise bigint,
  billed_paise bigint,
  paid_paise bigint,
  outstanding_paise bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    v.id,
    v.name,
    count(distinct g.id),
    coalesce(sum(g.subtotal_paise), 0)::bigint,
    coalesce(sum(g.tax_paise), 0)::bigint,
    coalesce(sum(g.freight_paise + g.other_charges_paise), 0)::bigint,
    coalesce(sum(g.total_paise), 0)::bigint,
    coalesce((
      select sum(r.total_paise) from public.inv_purchase_returns r
       where r.vendor_id = v.id and r.tenant_id = p_tenant_id
         and r.return_date between p_from and p_to
    ), 0)::bigint,
    coalesce((
      select sum(b.total_paise) from public.inv_vendor_bills b
       where b.vendor_id = v.id and b.tenant_id = p_tenant_id
         and b.bill_date between p_from and p_to and b.status <> 'cancelled'
    ), 0)::bigint,
    coalesce((
      select sum(b.paid_paise) from public.inv_vendor_bills b
       where b.vendor_id = v.id and b.tenant_id = p_tenant_id
         and b.bill_date between p_from and p_to and b.status <> 'cancelled'
    ), 0)::bigint,
    coalesce((
      select sum(b.total_paise - b.paid_paise) from public.inv_vendor_bills b
       where b.vendor_id = v.id and b.tenant_id = p_tenant_id
         and b.status in ('open', 'part_paid')
    ), 0)::bigint
  from public.inv_vendors v
  left join public.inv_goods_receipts g
    on g.vendor_id = v.id and g.tenant_id = p_tenant_id
   and g.receipt_date between p_from and p_to
 where v.tenant_id = p_tenant_id
 group by v.id, v.name
having count(distinct g.id) > 0
    or coalesce((select sum(b.total_paise - b.paid_paise)
                   from public.inv_vendor_bills b
                  where b.vendor_id = v.id and b.tenant_id = p_tenant_id
                    and b.status in ('open', 'part_paid')), 0) > 0
 order by 7 desc;
$$;

/**
 * Stock register: on-hand and value per item, with the reorder flag.
 *
 * Items with no movements at all still appear, at zero — a catalogue entry
 * nobody has ever stocked is exactly what a reorder report should surface.
 */
create or replace function public.inv_report_stock(
  p_tenant_id uuid,
  p_location_id uuid default null
) returns table (
  item_id uuid,
  sku text,
  item_name text,
  category_name text,
  uom_name text,
  qty_on_hand numeric,
  avg_cost_paise bigint,
  value_paise bigint,
  reorder_level numeric,
  below_reorder boolean,
  last_move_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    i.id,
    i.sku,
    i.name,
    coalesce(c.name, ''),
    coalesce(u.name, ''),
    coalesce(b.qty, 0),
    i.avg_cost_paise,
    round(coalesce(b.qty, 0) * i.avg_cost_paise)::bigint,
    i.reorder_level,
    i.reorder_level > 0 and coalesce(b.qty, 0) <= i.reorder_level,
    b.last_at
  from public.inv_items i
  left join public.inv_categories c on c.id = i.category_id
  left join public.inv_uoms u on u.id = i.uom_id
  left join (
    select l.item_id, sum(l.qty_delta) as qty, max(l.at) as last_at
      from public.inv_stock_ledger l
     where l.tenant_id = p_tenant_id
       and (p_location_id is null or l.location_id = p_location_id)
     group by l.item_id
  ) b on b.item_id = i.id
 where i.tenant_id = p_tenant_id
   and i.is_active
 order by i.name;
$$;

/* ─── RLS + grants ─────────────────────────────────────────── */

do $$
declare
  t text;
begin
  foreach t in array array['inv_assets', 'inv_asset_events']
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

grant execute on function public.inv_report_margin(uuid, date, date) to service_role;
grant execute on function public.inv_report_daybook(uuid, date, date) to service_role;
grant execute on function public.inv_report_purchases(uuid, date, date) to service_role;
grant execute on function public.inv_report_stock(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
