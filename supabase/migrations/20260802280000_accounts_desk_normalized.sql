-- Accounts desk — normalized SoR (accounts_state blob retained for cutover)

create table if not exists public.accounts_desk_cash_pools (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null default 'main',
  name text not null default '',
  balance_paise bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts_desk_cash_ledger (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  pool_id text not null default '',
  entry_date date not null,
  direction text not null default 'in' check (direction in ('in', 'out')),
  amount_paise bigint not null default 0,
  source_type text not null default '',
  source_id text not null default '',
  narration text not null default '',
  running_balance_paise bigint not null default 0,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  cancel_reason text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts_desk_bank_accounts (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null default '',
  bank_name text not null default '',
  account_no text not null default '',
  ifsc text not null default '',
  opening_balance_paise bigint not null default 0,
  is_active boolean not null default true,
  payment_modes jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts_desk_bank_ledger (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  bank_id text not null default '',
  entry_date date not null,
  direction text not null default 'dr' check (direction in ('dr', 'cr')),
  amount_paise bigint not null default 0,
  mode text not null default 'neft',
  source_type text not null default '',
  source_id text not null default '',
  narration text not null default '',
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  cancel_reason text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts_desk_mode_bank_map (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  mode text not null,
  bank_id text not null default '',
  updated_at timestamptz not null default now(),
  primary key (tenant_id, mode)
);

create table if not exists public.accounts_desk_recon_sessions (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  bank_id text not null default '',
  as_of date not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts_desk_recon_lines (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id text not null references public.accounts_desk_recon_sessions(id) on delete cascade,
  line_index int not null default 0,
  entry_date date not null,
  amount_paise bigint not null default 0,
  narration text not null default '',
  status text not null default 'unmatched',
  matched_ledger_id text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts_desk_expense_categories (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  parent_id text not null default '',
  name text not null default '',
  coa_code text not null default '',
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts_desk_expense_vouchers (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  voucher_no text not null default '',
  voucher_date date not null,
  category_id text not null default '',
  vendor_id text not null default '',
  amount_paise bigint not null default 0,
  tax_paise bigint not null default 0,
  grand_total_paise bigint not null default 0,
  paid_paise bigint not null default 0,
  due_paise bigint not null default 0,
  mode text not null default 'cash',
  payment_status text not null default 'draft',
  paid_on date,
  bank_id text not null default '',
  pool_id text not null default '',
  narration text not null default '',
  approved_by text not null default '',
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by text not null default '',
  cancel_reason text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts_desk_expense_voucher_lines (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  voucher_id text not null references public.accounts_desk_expense_vouchers(id) on delete cascade,
  line_index int not null default 0,
  category_id text not null default '',
  subcategory_id text not null default '',
  description text not null default '',
  amount_paise bigint not null default 0,
  tax_paise bigint not null default 0,
  total_paise bigint not null default 0,
  paid_paise bigint not null default 0,
  due_paise bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts_desk_recurring_rules (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  category_id text not null default '',
  vendor_id text not null default '',
  amount_paise bigint not null default 0,
  mode text not null default 'cash',
  day_of_month int not null default 1,
  is_active boolean not null default true,
  last_generated_on date,
  narration text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts_desk_vendors (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null default '',
  vendor_type text not null default '',
  phone text not null default '',
  gstin text not null default '',
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts_desk_vendor_bills (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  vendor_id text not null default '',
  receipt_no text not null default '',
  bill_no text not null default '',
  supplier_invoice_no text not null default '',
  bill_date date not null,
  due_on date not null,
  amount_paise bigint not null default 0,
  category_id text not null default '',
  discount_type text not null default 'none',
  discount_paise bigint not null default 0,
  tax_paise bigint not null default 0,
  grand_total_paise bigint not null default 0,
  status text not null default 'open',
  paid_paise bigint not null default 0,
  narration text not null default '',
  attachment_note text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts_desk_vendor_bill_lines (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  bill_id text not null references public.accounts_desk_vendor_bills(id) on delete cascade,
  line_index int not null default 0,
  description text not null default '',
  qty numeric not null default 0,
  rate_paise bigint not null default 0,
  amount_paise bigint not null default 0,
  category_id text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts_desk_payables (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  vendor_id text not null default '',
  source_type text not null default 'other',
  source_id text not null default '',
  amount_paise bigint not null default 0,
  due_on date not null,
  status text not null default 'open',
  paid_paise bigint not null default 0,
  paid_on date,
  note text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts_desk_trustees (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null default '',
  phone text not null default '',
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts_desk_owner_loans (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  trustee_id text not null default '',
  loan_type text not null default 'working_capital',
  principal_paise bigint not null default 0,
  rate_pct numeric not null default 0,
  tenure_months int not null default 0,
  start_date date not null,
  status text not null default 'open',
  note text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts_desk_owner_loan_schedule (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  loan_id text not null references public.accounts_desk_owner_loans(id) on delete cascade,
  installment_no int not null default 1,
  due_on date not null,
  amount_paise bigint not null default 0,
  status text not null default 'due',
  paid_on date,
  paid_amount_paise bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts_desk_owner_cash_handovers (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  handover_date date not null,
  amount_paise bigint not null default 0,
  from_pool_id text not null default '',
  handed_by text not null default '',
  received_by text not null default '',
  purpose text not null default '',
  note text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts_desk_coa_accounts (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null default '',
  name text not null default '',
  coa_group text not null default 'expense',
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts_desk_journal_entries (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  entry_date date not null,
  voucher_no text not null default '',
  narration text not null default '',
  source_type text not null default '',
  source_id text not null default '',
  fiscal_year_code text not null default '',
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  cancel_reason text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts_desk_journal_lines (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  journal_id text not null references public.accounts_desk_journal_entries(id) on delete cascade,
  line_index int not null default 0,
  coa_id text not null default '',
  debit_paise bigint not null default 0,
  credit_paise bigint not null default 0,
  narration text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts_desk_fiscal_years (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  label text not null default '',
  start_date date not null,
  end_date date not null,
  status text not null default 'open',
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts_desk_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  expense_approval_paise bigint not null default 1000000,
  petty_threshold_paise bigint not null default 200000,
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts_desk_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  coa_count int not null default 0,
  voucher_count int not null default 0,
  journal_count int not null default 0,
  vendor_bill_count int not null default 0,
  last_voucher_at date,
  updated_at timestamptz not null default now()
);

create index if not exists accounts_desk_cash_ledger_pool_idx
  on public.accounts_desk_cash_ledger (tenant_id, pool_id, entry_date desc);

create index if not exists accounts_desk_bank_ledger_bank_idx
  on public.accounts_desk_bank_ledger (tenant_id, bank_id, entry_date desc);

comment on table public.accounts_desk_coa_accounts is
  'Chart of accounts — system of record (text ids match desk localStorage)';
