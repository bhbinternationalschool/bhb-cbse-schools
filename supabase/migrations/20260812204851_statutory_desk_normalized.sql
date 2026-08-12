-- Statutory (EPF/ESIC) compliance desk — normalized SoR.
-- Not yet dual-written to: statutoryDbConfig.ts defaults both the write and
-- read flags OFF until this migration is confirmed applied in production.

create table if not exists public.statutory_desk_batches (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  month text not null default '',
  academic_year_code text not null default '',
  payroll_run_id text not null default '',
  status text not null default 'pending_deposit',
  pf_total bigint not null default 0,
  esic_total bigint not null default 0,
  grand_total bigint not null default 0,
  created_at timestamptz not null default now(),
  deposited_at timestamptz,
  deposited_by text not null default '',
  challan_note text not null default '',
  total_members int not null default 0,
  return_file_id text not null default '',
  contribution_rate_pct numeric not null default 12,
  total_epf_contribution bigint not null default 0,
  total_eps_contribution bigint not null default 0,
  total_epf_eps_contribution bigint not null default 0,
  total_edli_contribution bigint not null default 0,
  total_ip_contribution bigint not null default 0,
  epf jsonb not null default '{"filedAt":"","filedBy":"","challanRefNo":"","paidAt":"","paidBy":"","receiptFileUrl":""}'::jsonb,
  esic jsonb not null default '{"filedAt":"","filedBy":"","challanRefNo":"","paidAt":"","paidBy":"","receiptFileUrl":""}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.statutory_desk_lines (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  batch_id text not null references public.statutory_desk_batches(id) on delete cascade,
  line_index int not null default 0,
  staff_id text not null default '',
  emp_code text not null default '',
  full_name text not null default '',
  statutory_cover text not null default '',
  pf_employee bigint not null default 0,
  pf_employer bigint not null default 0,
  esic_employee bigint not null default 0,
  esic_employer bigint not null default 0,
  epf_wages bigint not null default 0,
  eps_wages bigint not null default 0,
  edli_wages bigint not null default 0,
  eps_amount bigint not null default 0,
  edli_amount bigint not null default 0,
  uan_number text not null default '',
  esic_ip_number text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.statutory_establishment_config (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  epf_establishment_id text not null default '',
  epf_lin text not null default '',
  epf_contribution_rate_pct numeric not null default 12,
  apply_epf_wage_ceiling boolean not null default true,
  epf_wage_ceiling numeric not null default 15000,
  esic_employer_code text not null default '',
  esic_wage_ceiling numeric not null default 21000,
  esic_employee_rate_pct numeric not null default 0.75,
  esic_employer_rate_pct numeric not null default 3.25,
  penalty jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.statutory_desk_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  batch_count int not null default 0,
  line_count int not null default 0,
  pending_count int not null default 0,
  last_batch_month text,
  updated_at timestamptz not null default now()
);

create index if not exists statutory_desk_batches_month_idx
  on public.statutory_desk_batches (tenant_id, month desc);

create index if not exists statutory_desk_lines_staff_idx
  on public.statutory_desk_lines (tenant_id, staff_id);

comment on table public.statutory_desk_batches is
  'EPF/ESIC statutory remittance batches — one per payroll run posted (text ids match desk localStorage)';
