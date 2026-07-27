-- Accounts module §6d–§6f + §6k.1 (parallel to localStorage bhb_accounts_v1)

create table if not exists public.accounts_cash_pools (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  balance_paise bigint not null default 0,
  unique (tenant_id, code)
);

create table if not exists public.accounts_cash_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  pool_id uuid not null references public.accounts_cash_pools(id) on delete cascade,
  entry_date date not null,
  direction text not null check (direction in ('in', 'out')),
  amount_paise bigint not null,
  source_type text not null default '',
  source_id text not null default '',
  narration text not null default '',
  running_balance_paise bigint not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.accounts_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  bank_name text not null default '',
  account_no text not null default '',
  ifsc text not null default '',
  opening_balance_paise bigint not null default 0,
  is_active boolean not null default true
);

create table if not exists public.accounts_bank_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  bank_id uuid not null references public.accounts_bank_accounts(id) on delete cascade,
  entry_date date not null,
  direction text not null check (direction in ('dr', 'cr')),
  amount_paise bigint not null,
  mode text not null default 'neft',
  source_type text not null default '',
  source_id text not null default '',
  narration text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.accounts_mode_bank_map (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  mode text not null,
  bank_id uuid not null references public.accounts_bank_accounts(id) on delete cascade,
  unique (tenant_id, mode)
);

create table if not exists public.accounts_expense_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  parent_id uuid,
  name text not null,
  coa_code text not null default '5900',
  is_active boolean not null default true
);

create table if not exists public.accounts_expense_vouchers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  voucher_date date not null,
  category_id uuid not null references public.accounts_expense_categories(id),
  vendor_id uuid,
  amount_paise bigint not null,
  mode text not null default 'cash',
  payment_status text not null default 'draft',
  paid_on date,
  bank_id uuid,
  pool_id uuid,
  narration text not null default '',
  approved_by text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.accounts_recurring_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  category_id uuid not null references public.accounts_expense_categories(id),
  vendor_id uuid,
  amount_paise bigint not null,
  mode text not null default 'cash',
  day_of_month integer not null default 5,
  is_active boolean not null default true,
  last_generated_on text not null default '',
  narration text not null default ''
);

create table if not exists public.accounts_vendors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  vendor_type text not null default 'supplier',
  phone text not null default '',
  gstin text not null default '',
  is_active boolean not null default true
);

create table if not exists public.accounts_vendor_bills (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  vendor_id uuid not null references public.accounts_vendors(id),
  bill_no text not null default '',
  bill_date date not null,
  due_on date not null,
  amount_paise bigint not null,
  category_id uuid,
  status text not null default 'open',
  paid_paise bigint not null default 0,
  narration text not null default '',
  attachment_note text not null default ''
);

create table if not exists public.accounts_payables (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  vendor_id uuid,
  source_type text not null,
  source_id text not null,
  amount_paise bigint not null,
  due_on date not null,
  status text not null default 'open',
  paid_paise bigint not null default 0,
  paid_on date,
  note text not null default '',
  unique (tenant_id, source_type, source_id)
);

create table if not exists public.accounts_trustees (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  phone text not null default '',
  is_active boolean not null default true
);

create table if not exists public.accounts_owner_loans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  trustee_id uuid not null references public.accounts_trustees(id),
  loan_type text not null default 'working_capital',
  principal_paise bigint not null,
  rate_pct numeric not null default 0,
  tenure_months integer not null default 12,
  start_date date not null,
  status text not null default 'open',
  note text not null default ''
);

create table if not exists public.accounts_owner_loan_schedule (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  loan_id uuid not null references public.accounts_owner_loans(id) on delete cascade,
  installment_no integer not null,
  due_on date not null,
  amount_paise bigint not null,
  paid_amount_paise bigint not null default 0,
  paid_on date,
  status text not null default 'due'
);

create table if not exists public.accounts_owner_cash_handovers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  entry_date date not null,
  amount_paise bigint not null,
  from_pool_id uuid,
  handed_by text not null default '',
  received_by text not null default '',
  purpose text not null default '',
  note text not null default ''
);

create table if not exists public.accounts_coa (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  account_group text not null,
  is_active boolean not null default true,
  unique (tenant_id, code)
);

create table if not exists public.accounts_journal_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  entry_date date not null,
  voucher_no text not null default '',
  narration text not null default '',
  source_type text not null default '',
  source_id text not null default '',
  fiscal_year_code text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.accounts_journal_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  journal_id uuid not null references public.accounts_journal_entries(id) on delete cascade,
  coa_id uuid not null references public.accounts_coa(id),
  debit_paise bigint not null default 0,
  credit_paise bigint not null default 0,
  narration text not null default ''
);

create table if not exists public.accounts_fiscal_years (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  label text not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'open',
  unique (tenant_id, code)
);

create index if not exists idx_accounts_cash_ledger_tenant_date
  on public.accounts_cash_ledger (tenant_id, entry_date);
create index if not exists idx_accounts_bank_ledger_tenant_date
  on public.accounts_bank_ledger (tenant_id, entry_date);
create index if not exists idx_accounts_expense_vouchers_tenant_date
  on public.accounts_expense_vouchers (tenant_id, voucher_date);
create index if not exists idx_accounts_payables_tenant_due
  on public.accounts_payables (tenant_id, due_on);
create index if not exists idx_accounts_journal_tenant_date
  on public.accounts_journal_entries (tenant_id, entry_date);
