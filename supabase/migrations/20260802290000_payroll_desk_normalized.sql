-- Payroll desk — normalized SoR (payroll_state blob retained for cutover)

create table if not exists public.payroll_desk_runs (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  academic_year_code text not null default '',
  month text not null default '',
  day_count int not null default 30,
  kind text not null default 'bulk' check (kind in ('bulk', 'individual')),
  status text not null default 'draft',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  submitted_by text not null default '',
  submitted_at timestamptz,
  approved_by text not null default '',
  approved_at timestamptz,
  posted_by text not null default '',
  posted_at timestamptz,
  paid_by text not null default '',
  paid_at timestamptz,
  remark text not null default '',
  submission_note text not null default '',
  rejection_note text not null default '',
  rejected_by text not null default '',
  rejected_at timestamptz,
  lock_version int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.payroll_desk_run_lines (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id text not null references public.payroll_desk_runs(id) on delete cascade,
  line_index int not null default 0,
  staff_id text not null default '',
  emp_code text not null default '',
  full_name text not null default '',
  stream text not null default '',
  structure_id text not null default '',
  structure_name text not null default '',
  days_present numeric not null default 0,
  days_absent numeric not null default 0,
  days_half numeric not null default 0,
  days_leave_paid numeric not null default 0,
  days_lwp numeric not null default 0,
  days_holiday numeric not null default 0,
  late_penalty bigint not null default 0,
  lwp_deduction bigint not null default 0,
  components jsonb not null default '[]'::jsonb,
  gross bigint not null default 0,
  total_deductions bigint not null default 0,
  employer_cost bigint not null default 0,
  net_pay bigint not null default 0,
  june_hold boolean not null default false,
  eligible_for_june_draw boolean not null default true,
  amount_payable bigint not null default 0,
  hold_note text not null default '',
  statutory_cover text not null default '',
  pf_govt_deposit bigint not null default 0,
  esic_govt_deposit bigint not null default 0,
  bonus bigint not null default 0,
  special_deduction bigint not null default 0,
  special_deduction_label text not null default '',
  advance_taken bigint not null default 0,
  advance_deduct bigint not null default 0,
  advance_new_with_salary bigint not null default 0,
  payment_date date,
  payment_mode text not null default 'bank_transfer',
  note text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.payroll_desk_audit (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  at timestamptz not null default now(),
  by_user text not null default '',
  action text not null default '',
  run_id text not null default '',
  month text not null default '',
  academic_year_code text not null default '',
  detail text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.payroll_desk_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  run_count int not null default 0,
  line_count int not null default 0,
  draft_count int not null default 0,
  last_run_month text,
  updated_at timestamptz not null default now()
);

create index if not exists payroll_desk_runs_month_idx
  on public.payroll_desk_runs (tenant_id, month desc);

create index if not exists payroll_desk_run_lines_staff_idx
  on public.payroll_desk_run_lines (tenant_id, staff_id);

comment on table public.payroll_desk_runs is
  'Payroll runs — system of record (text ids match desk localStorage)';
