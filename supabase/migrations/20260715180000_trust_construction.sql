-- Trust Infrastructure & Construction §6j (parallel to bhb_trust_v1)

create table if not exists public.trust_projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_code text not null,
  name text not null,
  campus text not null default 'Main campus',
  project_type text not null default 'renovation',
  budget_paise bigint not null default 0,
  start_date date not null,
  target_end_date date not null,
  status text not null default 'planned',
  manager_name text not null default '',
  linked_owner_loan_id text not null default '',
  physical_pct integer not null default 0,
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (tenant_id, project_code)
);

create table if not exists public.trust_work_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.trust_projects(id) on delete cascade,
  work_code text not null default '',
  name text not null,
  category text not null default 'civil',
  unit text not null default 'lump sum',
  qty_planned numeric not null default 0,
  rate_paise bigint not null default 0,
  amount_paise bigint not null default 0,
  spec_note text not null default '',
  status text not null default 'not_started'
);

create table if not exists public.trust_material_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.trust_projects(id) on delete cascade,
  work_item_id uuid,
  name text not null,
  unit text not null default 'bag',
  required_qty numeric not null default 0,
  ordered_qty numeric not null default 0,
  received_qty numeric not null default 0,
  issued_qty numeric not null default 0,
  rate_paise bigint not null default 0
);

create table if not exists public.trust_labour_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.trust_projects(id) on delete cascade,
  work_item_id uuid,
  labour_type text not null,
  headcount integer not null default 1,
  days numeric not null default 0,
  rate_paise bigint not null default 0,
  amount_paise bigint not null default 0,
  entry_date date not null,
  paid_status text not null default 'unpaid',
  note text not null default ''
);

create table if not exists public.trust_allotments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.trust_projects(id) on delete cascade,
  allotment_code text not null,
  work_item_ids jsonb not null default '[]',
  party_type text not null,
  party_name text not null,
  party_phone text not null default '',
  target_start date not null,
  target_end date not null,
  agreed_paise bigint not null default 0,
  priority text not null default 'normal',
  status text not null default 'allotted',
  progress_pct integer not null default 0,
  verified_by text not null default '',
  note text not null default ''
);

create table if not exists public.trust_contractors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  gstin text not null default '',
  phone text not null default '',
  is_active boolean not null default true
);

create table if not exists public.trust_work_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.trust_projects(id) on delete cascade,
  contractor_id uuid references public.trust_contractors(id),
  wo_no text not null,
  scope text not null default '',
  value_paise bigint not null default 0,
  retention_pct numeric not null default 5,
  status text not null default 'open',
  issued_on date not null
);

create table if not exists public.trust_ra_bills (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.trust_projects(id) on delete cascade,
  work_order_id uuid references public.trust_work_orders(id),
  bill_no text not null,
  bill_date date not null,
  amount_paise bigint not null,
  retention_paise bigint not null default 0,
  paid_paise bigint not null default 0,
  status text not null default 'draft',
  note text not null default ''
);

create table if not exists public.trust_cost_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.trust_projects(id) on delete cascade,
  work_item_id uuid,
  cost_type text not null,
  source_type text not null default 'manual',
  source_id text not null default '',
  entry_date date not null,
  vendor_name text not null default '',
  amount_paise bigint not null,
  gst_paise bigint not null default 0,
  narration text not null default '',
  payment_status text not null default 'open',
  paid_on date,
  retention_paise bigint not null default 0
);

create table if not exists public.trust_rate_card (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  category text not null,
  unit text not null,
  work_name text not null,
  rate_paise bigint not null,
  locality text not null default ''
);

create index if not exists idx_trust_projects_tenant_status
  on public.trust_projects (tenant_id, status);
create index if not exists idx_trust_cost_lines_tenant_project
  on public.trust_cost_lines (tenant_id, project_id);
create index if not exists idx_trust_allotments_tenant_due
  on public.trust_allotments (tenant_id, target_end);
