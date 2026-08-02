-- Purchase desk — indent → PO → GRN normalized SoR (purchase_state blob retained for cutover)

create table if not exists public.purchase_desk_indents (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  indent_no text not null default '',
  academic_year_code text not null default '',
  requester_name text not null default '',
  requester_staff_id text not null default '',
  department text not null default '',
  urgency text not null default 'normal',
  status text not null default 'draft',
  note text not null default '',
  estimated_paise bigint not null default 0,
  decided_by text not null default '',
  decided_at timestamptz,
  decision_note text not null default '',
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_desk_indent_lines (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  indent_id text not null references public.purchase_desk_indents(id) on delete cascade,
  line_index int not null default 0,
  description text not null default '',
  sku_item_id text not null default '',
  qty numeric not null default 0,
  uom text not null default 'nos',
  est_rate_paise bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_desk_orders (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  po_no text not null default '',
  indent_id text not null default '',
  vendor_id text not null default '',
  vendor_name text not null default '',
  status text not null default 'draft',
  approved_by text not null default '',
  approved_at timestamptz,
  academic_year_code text not null default '',
  note text not null default '',
  discount_paise bigint not null default 0,
  tax_paise bigint not null default 0,
  amount_paise bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_desk_order_lines (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id text not null references public.purchase_desk_orders(id) on delete cascade,
  line_index int not null default 0,
  description text not null default '',
  sku_item_id text not null default '',
  qty numeric not null default 0,
  uom text not null default 'nos',
  rate_paise bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_desk_grns (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  grn_no text not null default '',
  po_id text not null default '',
  grn_date date not null,
  destination text not null default 'store',
  photo_note text not null default '',
  bill_image_url text not null default '',
  ocr_bill_no text not null default '',
  vendor_bill_id text not null default '',
  stock_applied boolean not null default false,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_desk_grn_lines (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  grn_id text not null references public.purchase_desk_grns(id) on delete cascade,
  line_index int not null default 0,
  po_line_id text not null default '',
  description text not null default '',
  sku_item_id text not null default '',
  qty_ordered numeric not null default 0,
  qty_received numeric not null default 0,
  uom text not null default 'nos',
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_desk_returns (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  return_no text not null default '',
  grn_id text not null default '',
  vendor_bill_id text not null default '',
  vendor_id text not null default '',
  return_date date not null,
  amount_paise bigint not null default 0,
  note text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_desk_return_lines (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  return_id text not null references public.purchase_desk_returns(id) on delete cascade,
  line_index int not null default 0,
  grn_line_id text not null default '',
  description text not null default '',
  sku_item_id text not null default '',
  qty numeric not null default 0,
  rate_paise bigint not null default 0,
  amount_paise bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_desk_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  admin_limit_paise bigint not null default 500000,
  principal_limit_paise bigint not null default 5000000,
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_desk_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  indent_count int not null default 0,
  order_count int not null default 0,
  grn_count int not null default 0,
  return_count int not null default 0,
  open_po_count int not null default 0,
  last_grn_at date,
  updated_at timestamptz not null default now()
);

create index if not exists purchase_desk_indents_status_idx
  on public.purchase_desk_indents (tenant_id, status);

create index if not exists purchase_desk_orders_status_idx
  on public.purchase_desk_orders (tenant_id, status);

comment on table public.purchase_desk_indents is
  'Purchase indents — system of record (text ids match desk localStorage)';
