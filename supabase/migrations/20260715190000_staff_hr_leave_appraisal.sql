-- Staff HR · leave & appraisal (parallel to bhb_staff_hr_v1)

create table if not exists public.staff_leave_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  paid boolean not null default true,
  default_days_per_year numeric not null default 0,
  max_days_per_month numeric not null default 0,
  max_days_per_request numeric not null default 0,
  max_carry_forward numeric not null default 0,
  unique (tenant_id, code)
);

create table if not exists public.staff_leave_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  academic_year_code text not null,
  staff_id text not null,
  type_code text not null,
  from_date date not null,
  to_date date not null,
  days numeric not null,
  half_day boolean not null default false,
  reason text not null default '',
  status text not null default 'pending',
  origin text not null default 'request',
  applied_by text not null default '',
  applied_at timestamptz,
  decided_by text not null default '',
  decided_at timestamptz,
  decision_note text not null default '',
  level1_by text not null default '',
  level1_at timestamptz
);

create table if not exists public.staff_leave_balances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  academic_year_code text not null,
  staff_id text not null,
  type_code text not null,
  allotted numeric not null default 0,
  carried_forward numeric not null default 0,
  encashed numeric not null default 0,
  used numeric not null default 0,
  unique (tenant_id, academic_year_code, staff_id, type_code)
);

create table if not exists public.staff_leave_encashments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  academic_year_code text not null,
  staff_id text not null,
  type_code text not null,
  days numeric not null,
  note text not null default '',
  recorded_by text not null default '',
  recorded_at timestamptz not null default now()
);

create table if not exists public.staff_appraisal_cycles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  academic_year_code text not null,
  label text not null,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create table if not exists public.staff_appraisals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  cycle_id uuid not null references public.staff_appraisal_cycles(id) on delete cascade,
  staff_id text not null,
  score_teaching integer not null default 3,
  score_duty integer not null default 3,
  score_punctuality integer not null default 3,
  score_conduct integer not null default 3,
  score_overall integer not null default 3,
  comment text not null default '',
  rated_by text not null default '',
  rated_at timestamptz not null default now(),
  unique (tenant_id, cycle_id, staff_id)
);

create index if not exists idx_staff_leave_requests_tenant_ay
  on public.staff_leave_requests (tenant_id, academic_year_code);
create index if not exists idx_staff_leave_balances_tenant_ay
  on public.staff_leave_balances (tenant_id, academic_year_code);
