-- Store / inventory desk — normalized SoR (store_state blob retained for cutover)

create table if not exists public.store_desk_categories (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null default '',
  code text not null default '',
  is_active boolean not null default true,
  sort_order int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.store_desk_sale_groups (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null default '',
  code text not null default '',
  is_active boolean not null default true,
  sort_order int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.store_desk_uoms (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null default '',
  code text not null default '',
  is_active boolean not null default true,
  sort_order int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.store_desk_infra_levels (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null default '',
  code text not null default '',
  is_active boolean not null default true,
  sort_order int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.store_desk_sources (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null default '',
  code text not null default '',
  phone text not null default '',
  is_active boolean not null default true,
  sort_order int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.store_desk_items (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sku text not null default '',
  name text not null default '',
  category_id text not null default '',
  sale_group_id text not null default '',
  uom_id text not null default '',
  source_id text not null default '',
  infra_level_id text not null default '',
  size_label text not null default '',
  purchase_price_paise bigint not null default 0,
  sale_price_paise bigint not null default 0,
  unit_price_paise bigint not null default 0,
  max_discount_pct numeric not null default 0,
  audience text not null default 'student'
    check (audience in ('student', 'staff', 'both')),
  applicable_class_ids jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  stock_on_hand numeric not null default 0,
  reorder_level numeric not null default 0,
  opening_qty numeric not null default 0,
  issue_policy text not null default 'unlimited',
  max_qty_per_ay numeric not null default 0,
  barcode text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.store_desk_issues (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  issue_no text not null default '',
  recipient_kind text not null default 'student'
    check (recipient_kind in ('student', 'staff')),
  student_id text not null default '',
  staff_id text not null default '',
  household_id text not null default '',
  academic_year_code text not null default '',
  issued_on date not null,
  total_paise bigint not null default 0,
  sale_discount_paise bigint not null default 0,
  note text not null default '',
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  payment_mode text not null default 'credit'
    check (payment_mode in ('cash', 'credit')),
  payment_status text not null default 'due'
    check (payment_status in ('paid', 'due', 'void')),
  issue_kind text not null default 'first',
  replaces_issue_id text not null default '',
  replacement_reason text not null default '',
  issued_by text not null default '',
  store_location text not null default '',
  return_to_stock boolean not null default false,
  returned_paise bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.store_desk_issue_lines (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  issue_id text not null references public.store_desk_issues(id) on delete cascade,
  line_index int not null default 0,
  item_id text not null default '',
  sku text not null default '',
  name text not null default '',
  size_label text not null default '',
  qty numeric not null default 0,
  unit_price_paise bigint not null default 0,
  line_paise bigint not null default 0,
  max_discount_pct numeric not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.store_desk_movements (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  item_id text not null default '',
  at timestamptz not null default now(),
  kind text not null default 'adjust',
  qty_delta numeric not null default 0,
  note text not null default '',
  ref_issue_id text not null default '',
  by_user text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.store_desk_inventory_allocations (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  item_id text not null default '',
  infra_level_id text not null default '',
  qty numeric not null default 0,
  note text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.store_desk_asset_allocations (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  item_id text not null default '',
  asset_tag text not null default '',
  assigned_to text not null default '',
  location text not null default '',
  qty numeric not null default 0,
  note text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.store_desk_sell_returns (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  return_no text not null default '',
  issue_id text not null default '',
  student_id text not null default '',
  staff_id text not null default '',
  returned_on date not null,
  total_paise bigint not null default 0,
  note text not null default '',
  created_at timestamptz not null default now(),
  created_by text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.store_desk_sell_return_lines (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  return_id text not null references public.store_desk_sell_returns(id) on delete cascade,
  line_index int not null default 0,
  item_id text not null default '',
  sku text not null default '',
  name text not null default '',
  size_label text not null default '',
  qty numeric not null default 0,
  unit_price_paise bigint not null default 0,
  line_paise bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.store_desk_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  category_count int not null default 0,
  item_count int not null default 0,
  issue_count int not null default 0,
  movement_count int not null default 0,
  open_due_count int not null default 0,
  last_issue_at date,
  updated_at timestamptz not null default now()
);

create index if not exists store_desk_items_tenant_idx
  on public.store_desk_items (tenant_id, is_active);

create index if not exists store_desk_issues_student_idx
  on public.store_desk_issues (tenant_id, student_id, issued_on desc);

create index if not exists store_desk_issues_due_idx
  on public.store_desk_issues (tenant_id)
  where payment_status = 'due' and voided_at is null;

comment on table public.store_desk_items is
  'Store catalog + stock — system of record (text ids match desk localStorage)';
