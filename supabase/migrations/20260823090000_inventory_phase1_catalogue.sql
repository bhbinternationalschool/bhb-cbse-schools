-- Inventory & Procurement — Phase 1: vendors, catalogue, pricing, kits, stock ledger.
--
-- Replaces the localStorage-blob Store/Purchase modules. Everything here is
-- server truth: the browser never holds authoritative state, so a re-login
-- cannot lose a vendor or an item. There is no dual-write, no blob mirror and
-- no "prune stale rows from the client payload" path — the class of bug that
-- emptied store_desk_* (0 rows in every table as of 2026-08-23) and the
-- transport desk (2026-08-21) is structurally absent.
--
-- Conventions kept from the rest of the schema: tenant_id FK + RLS via
-- is_tenant_member(), explicit service_role grants (a new table without them
-- fails writes with 42501), and a pgrst schema reload at the end.

/* ─── Vendors ──────────────────────────────────────────────── */

create table if not exists public.inv_vendors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null default '',
  name text not null,
  legal_name text not null default '',
  gstin text not null default '',
  pan text not null default '',
  contact_person text not null default '',
  phone text not null default '',
  email text not null default '',
  address text not null default '',
  city text not null default '',
  state text not null default '',
  pincode text not null default '',
  payment_terms_days int not null default 0,
  default_discount_pct numeric(5,2) not null default 0,
  bank_account_name text not null default '',
  bank_account_no text not null default '',
  bank_ifsc text not null default '',
  notes text not null default '',
  is_active boolean not null default true,
  -- Link to the legacy accounts vendor id so Accounts postings stay attached.
  accounts_vendor_id text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists inv_vendors_tenant_name_uidx
  on public.inv_vendors (tenant_id, lower(name));
create index if not exists inv_vendors_tenant_active_idx
  on public.inv_vendors (tenant_id, is_active);

/* ─── Classification masters ───────────────────────────────── */

create table if not exists public.inv_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  code text not null default '',
  -- Consumables leave stock on sale/issue; assets get a tag in the register.
  kind text not null default 'consumable' check (kind in ('consumable', 'asset')),
  parent_id uuid references public.inv_categories(id) on delete set null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists inv_categories_tenant_name_uidx
  on public.inv_categories (tenant_id, lower(name));

create table if not exists public.inv_uoms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  code text not null default '',
  -- 0 for Nos/Pack (whole units), 3 for Kg/Litre.
  decimals int not null default 0 check (decimals between 0 and 3),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists inv_uoms_tenant_name_uidx
  on public.inv_uoms (tenant_id, lower(name));

create table if not exists public.inv_locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  code text not null default '',
  kind text not null default 'store'
    check (kind in ('store', 'library', 'lab', 'hostel', 'mess', 'office', 'other')),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists inv_locations_tenant_name_uidx
  on public.inv_locations (tenant_id, lower(name));

/* ─── Items ────────────────────────────────────────────────── */

-- Sizes / class-editions are sibling item rows pointing at a parent through
-- variant_of, not a separate variants table: stock, cost and price are all
-- per-SKU, which is how the counter and the stock register already think.
create table if not exists public.inv_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sku text not null,
  name text not null,
  category_id uuid references public.inv_categories(id) on delete set null,
  uom_id uuid references public.inv_uoms(id) on delete set null,
  item_kind text not null default 'consumable'
    check (item_kind in ('consumable', 'asset')),
  variant_of uuid references public.inv_items(id) on delete set null,
  variant_label text not null default '',
  hsn_code text not null default '',
  gst_rate numeric(5,2) not null default 0,
  reorder_level numeric(14,3) not null default 0,
  default_vendor_id uuid references public.inv_vendors(id) on delete set null,
  -- Weighted-average cost, recomputed by every goods receipt (Phase 2).
  avg_cost_paise bigint not null default 0,
  last_purchase_paise bigint not null default 0,
  barcode text not null default '',
  notes text not null default '',
  is_active boolean not null default true,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists inv_items_tenant_sku_uidx
  on public.inv_items (tenant_id, lower(sku));
create index if not exists inv_items_tenant_active_idx
  on public.inv_items (tenant_id, is_active);
create index if not exists inv_items_tenant_category_idx
  on public.inv_items (tenant_id, category_id);
create index if not exists inv_items_variant_of_idx
  on public.inv_items (variant_of);

/* ─── Vendor rates (what we pay) ───────────────────────────── */

create table if not exists public.inv_vendor_item_rates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  vendor_id uuid not null references public.inv_vendors(id) on delete cascade,
  item_id uuid not null references public.inv_items(id) on delete cascade,
  rate_paise bigint not null default 0,
  discount_pct numeric(5,2) not null default 0,
  gst_rate numeric(5,2) not null default 0,
  lead_time_days int not null default 0,
  last_purchased_on date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists inv_vendor_item_rates_uidx
  on public.inv_vendor_item_rates (tenant_id, vendor_id, item_id);
create index if not exists inv_vendor_item_rates_item_idx
  on public.inv_vendor_item_rates (tenant_id, item_id);

/* ─── Price lists (what we charge) ─────────────────────────── */

create table if not exists public.inv_price_lists (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  academic_year_code text not null default '',
  effective_from date,
  is_default boolean not null default false,
  is_active boolean not null default true,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists inv_price_lists_tenant_name_uidx
  on public.inv_price_lists (tenant_id, lower(name), academic_year_code);
-- At most one default list per academic year.
create unique index if not exists inv_price_lists_one_default_uidx
  on public.inv_price_lists (tenant_id, academic_year_code)
  where is_default;

create table if not exists public.inv_price_list_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  price_list_id uuid not null references public.inv_price_lists(id) on delete cascade,
  item_id uuid not null references public.inv_items(id) on delete cascade,
  mrp_paise bigint not null default 0,
  sale_paise bigint not null default 0,
  max_discount_pct numeric(5,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists inv_price_list_items_uidx
  on public.inv_price_list_items (tenant_id, price_list_id, item_id);
create index if not exists inv_price_list_items_item_idx
  on public.inv_price_list_items (tenant_id, item_id);

/* ─── Kits — how an item reaches a class group ─────────────── */

create table if not exists public.inv_kits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  code text not null default '',
  academic_year_code text not null default '',
  -- 'sum' prices the kit from its lines; 'fixed' charges fixed_price_paise.
  price_mode text not null default 'sum' check (price_mode in ('sum', 'fixed')),
  fixed_price_paise bigint not null default 0,
  audience text not null default 'student'
    check (audience in ('student', 'staff', 'both')),
  notes text not null default '',
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists inv_kits_tenant_name_uidx
  on public.inv_kits (tenant_id, lower(name), academic_year_code);

create table if not exists public.inv_kit_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kit_id uuid not null references public.inv_kits(id) on delete cascade,
  item_id uuid not null references public.inv_items(id) on delete cascade,
  qty numeric(14,3) not null default 1,
  is_optional boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists inv_kit_items_uidx
  on public.inv_kit_items (tenant_id, kit_id, item_id);

-- Class ids are masters text ids (cls_*), not FKs into a table here.
create table if not exists public.inv_kit_classes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kit_id uuid not null references public.inv_kits(id) on delete cascade,
  class_id text not null,
  section_id text not null default '',
  created_at timestamptz not null default now()
);

create unique index if not exists inv_kit_classes_uidx
  on public.inv_kit_classes (tenant_id, kit_id, class_id, section_id);
create index if not exists inv_kit_classes_class_idx
  on public.inv_kit_classes (tenant_id, class_id);

/* ─── Stock ledger — the only source of on-hand quantity ───── */

-- Append-only. On-hand is never stored as an editable number anywhere; it is
-- the sum of this table. Every correction is a new row with a reason, so the
-- register always reconciles and nothing can drift silently.
create table if not exists public.inv_stock_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  item_id uuid not null references public.inv_items(id) on delete cascade,
  location_id uuid references public.inv_locations(id) on delete set null,
  at timestamptz not null default now(),
  qty_delta numeric(14,3) not null,
  unit_cost_paise bigint not null default 0,
  kind text not null check (kind in (
    'opening', 'purchase_in', 'purchase_return_out',
    'sale_out', 'sale_return_in',
    'transfer_out', 'transfer_in',
    'adjust_in', 'adjust_out',
    'consumption', 'production'
  )),
  ref_type text not null default '',
  ref_id uuid,
  ref_no text not null default '',
  note text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists inv_stock_ledger_item_idx
  on public.inv_stock_ledger (tenant_id, item_id, at desc);
create index if not exists inv_stock_ledger_location_idx
  on public.inv_stock_ledger (tenant_id, location_id);
create index if not exists inv_stock_ledger_ref_idx
  on public.inv_stock_ledger (tenant_id, ref_type, ref_id);

create or replace view public.inv_stock_balances as
  select
    l.tenant_id,
    l.item_id,
    l.location_id,
    sum(l.qty_delta) as qty_on_hand,
    max(l.at) as last_move_at
  from public.inv_stock_ledger l
  group by l.tenant_id, l.item_id, l.location_id;

/* ─── Settings + document numbering ────────────────────────── */

create table if not exists public.inv_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  -- Purchase orders above this need an approver. ₹10,000 default.
  po_approval_threshold_paise bigint not null default 1000000,
  default_price_list_id uuid references public.inv_price_lists(id) on delete set null,
  default_location_id uuid references public.inv_locations(id) on delete set null,
  costing_method text not null default 'weighted_avg'
    check (costing_method in ('weighted_avg', 'last_purchase')),
  allow_negative_stock boolean not null default false,
  walkin_sales_enabled boolean not null default true,
  track_gst boolean not null default true,
  doc_prefixes jsonb not null default
    '{"indent":"IND","po":"PO","grn":"GRN","sale":"SL","sale_return":"SR","purchase_return":"PR","adjust":"ADJ","transfer":"TRF","vendor":"VEN"}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.inv_doc_counters (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  doc_type text not null,
  period text not null default '',
  last_no int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, doc_type, period)
);

-- Atomic next-number. Concurrent counter sales must never collide on a
-- receipt number, which a read-then-write in application code cannot promise.
create or replace function public.inv_next_doc_no(
  p_tenant_id uuid,
  p_doc_type text,
  p_period text,
  p_prefix text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_no int;
begin
  insert into public.inv_doc_counters (tenant_id, doc_type, period, last_no)
  values (p_tenant_id, p_doc_type, coalesce(p_period, ''), 1)
  on conflict (tenant_id, doc_type, period)
  do update set last_no = public.inv_doc_counters.last_no + 1,
                updated_at = now()
  returning last_no into v_no;

  return p_prefix
    || case when coalesce(p_period, '') = '' then '' else '/' || p_period end
    || '/' || lpad(v_no::text, 4, '0');
end;
$$;

/* ─── RLS + grants ─────────────────────────────────────────── */

do $$
declare
  t text;
begin
  foreach t in array array[
    'inv_vendors', 'inv_categories', 'inv_uoms', 'inv_locations',
    'inv_items', 'inv_vendor_item_rates',
    'inv_price_lists', 'inv_price_list_items',
    'inv_kits', 'inv_kit_items', 'inv_kit_classes',
    'inv_stock_ledger', 'inv_settings', 'inv_doc_counters'
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

grant select on public.inv_stock_balances to service_role;
grant execute on function public.inv_next_doc_no(uuid, text, text, text) to service_role;

notify pgrst, 'reload schema';
