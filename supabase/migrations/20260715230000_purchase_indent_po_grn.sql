-- Purchase indent → PO → GRN (§20c)

create table if not exists public.purchase_indents (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  indent_no text not null,
  academic_year_code text not null,
  requester_name text,
  requester_staff_id text,
  department text,
  urgency text not null default 'normal',
  status text not null default 'draft',
  note text,
  estimated_paise bigint not null default 0,
  decided_by text,
  decided_at timestamptz,
  decision_note text,
  submitted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.purchase_indent_lines (
  id uuid primary key default gen_random_uuid(),
  indent_id uuid not null references public.purchase_indents(id) on delete cascade,
  description text not null,
  sku_item_id text,
  qty numeric not null default 1,
  uom text,
  est_rate_paise bigint not null default 0
);

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  po_no text not null,
  indent_id uuid references public.purchase_indents(id),
  vendor_id text,
  vendor_name text,
  status text not null default 'draft',
  academic_year_code text not null,
  discount_paise bigint not null default 0,
  tax_paise bigint not null default 0,
  amount_paise bigint not null default 0,
  approved_by text,
  approved_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  description text not null,
  sku_item_id text,
  qty numeric not null default 1,
  uom text,
  rate_paise bigint not null default 0
);

create table if not exists public.purchase_grns (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  grn_no text not null,
  po_id uuid not null references public.purchase_orders(id),
  grn_date date not null,
  destination text not null default 'store',
  photo_note text,
  vendor_bill_id text,
  stock_applied boolean not null default false,
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists public.purchase_grn_lines (
  id uuid primary key default gen_random_uuid(),
  grn_id uuid not null references public.purchase_grns(id) on delete cascade,
  po_line_id text,
  description text,
  sku_item_id text,
  qty_ordered numeric,
  qty_received numeric not null default 0,
  uom text
);

create index if not exists purchase_indents_status_idx on public.purchase_indents (status);
create index if not exists purchase_orders_status_idx on public.purchase_orders (status);

comment on table public.purchase_indents is
  'Purchase indents (§20c). Client localStorage until wired.';
