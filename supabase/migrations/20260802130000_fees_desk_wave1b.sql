-- Wave 1b — cheques, day close, charge vouchers, recovery plans, open dues cache

alter table public.fee_desk_sync_meta
  add column if not exists ancillary_updated_at timestamptz,
  add column if not exists cheque_count int not null default 0,
  add column if not exists charge_voucher_count int not null default 0,
  add column if not exists open_dues_count int not null default 0;

-- Cheques
create table if not exists public.fee_desk_cheques (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  voucher_id text not null,
  receipt_no text not null default '',
  household_id text,
  tender_index int not null default 0,
  cheque_no text not null default '',
  bank_name text not null default '',
  cheque_date date,
  amount_paise bigint not null check (amount_paise > 0),
  favouring text not null default '',
  status text not null default 'received'
    check (status in ('received', 'deposited', 'cleared', 'bounced')),
  received_at timestamptz not null default now(),
  deposited_at timestamptz,
  deposit_slip_no text not null default '',
  cleared_at timestamptz,
  bounced_at timestamptz,
  bounce_reason text not null default '',
  cheque_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists fee_desk_cheques_tenant_status_idx
  on public.fee_desk_cheques (tenant_id, status);

-- Manual receipt book series
create table if not exists public.fee_desk_manual_books (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  series_code text not null,
  label text not null default '',
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (tenant_id, series_code)
);

-- Day close sessions
create table if not exists public.fee_desk_day_closes (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  close_date date not null,
  counter_id text not null default 'front_office',
  cashier_name text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'approved', 'rejected')),
  receipt_count int not null default 0,
  total_paise bigint not null default 0,
  system_cash_paise bigint not null default 0,
  physical_cash_paise bigint not null default 0,
  variance_paise bigint not null default 0,
  cashier_remarks text not null default '',
  receiver_name text not null default '',
  receiver_remarks text not null default '',
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  resolved_at timestamptz,
  session_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (tenant_id, close_date, counter_id)
);

-- Supplementary charge vouchers (billing, not receipts)
create table if not exists public.fee_desk_charge_vouchers (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  student_id text not null,
  household_id text,
  student_name text not null default '',
  academic_year_code text not null,
  installment_id text,
  installment_label text not null default '',
  due_on date not null,
  total_paise bigint not null check (total_paise >= 0),
  reason text not null default '',
  created_at timestamptz not null default now(),
  created_by text not null default '',
  voided_at timestamptz,
  voided_by text not null default '',
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create table if not exists public.fee_desk_charge_voucher_lines (
  id text primary key,
  charge_voucher_id text not null references public.fee_desk_charge_vouchers(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  fee_head_id text not null default '',
  fee_head_name text not null default '',
  amount_paise bigint not null check (amount_paise > 0),
  note text not null default ''
);

-- Recovery EMI plans + allocations
create table if not exists public.fee_desk_installment_plans (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id text not null,
  household_id text,
  academic_year_code text not null,
  status text not null default 'active',
  plan_json jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.fee_desk_plan_allocations (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  plan_id text not null,
  voucher_id text not null default '',
  due_key text not null,
  amount_paise bigint not null check (amount_paise > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.fee_desk_carried_forward (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id text not null,
  from_academic_year_code text not null,
  to_academic_year_code text not null,
  amount_paise bigint not null check (amount_paise >= 0),
  due_on date not null,
  label text not null default '',
  transferred_at timestamptz not null default now(),
  transferred_by text not null default '',
  voided_at timestamptz,
  forward_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Materialized open-dues cache (rebuilt on desk sync from fee engine)
create table if not exists public.fee_desk_open_dues (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id text not null,
  academic_year_code text not null,
  due_key text not null,
  household_id text,
  kind text not null default 'academic',
  label text not null default '',
  due_on date,
  billed_paise bigint not null default 0,
  concession_paise bigint not null default 0,
  balance_paise bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, student_id, academic_year_code, due_key)
);

create index if not exists fee_desk_open_dues_household_idx
  on public.fee_desk_open_dues (tenant_id, household_id)
  where balance_paise > 0;

create index if not exists fee_desk_open_dues_ay_idx
  on public.fee_desk_open_dues (tenant_id, academic_year_code)
  where balance_paise > 0;

create or replace view public.fee_open_dues_v as
select
  d.tenant_id,
  d.student_id,
  d.academic_year_code,
  d.due_key,
  d.household_id,
  d.kind,
  d.label,
  d.due_on,
  d.billed_paise,
  d.concession_paise,
  d.balance_paise,
  d.updated_at,
  s.full_name as student_name,
  s.admission_no,
  s.class_id,
  s.section_id,
  h.guardian_name,
  h.mobile as guardian_mobile
from public.fee_desk_open_dues d
left join public.sis_students s
  on s.id = d.student_id and s.tenant_id = d.tenant_id
left join public.sis_households h
  on h.id = d.household_id and h.tenant_id = d.tenant_id
where d.balance_paise > 0;

comment on view public.fee_open_dues_v is
  'Open fee dues cache joined to SIS — rebuilt on fee desk sync';
comment on table public.fee_desk_open_dues is
  'Server-computed open dues snapshot; source of truth for reporting when FEES_READ_FROM_DB=true';
