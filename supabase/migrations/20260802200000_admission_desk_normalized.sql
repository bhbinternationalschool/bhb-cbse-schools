-- Admissions CRM desk — normalized SoR (text ids aligned with desk localStorage)

create table if not exists public.admission_desk_households (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null default '',
  primary_mobile text not null default '',
  whatsapp text not null default '',
  email text not null default '',
  locality text not null default '',
  address text not null default '',
  city text not null default '',
  state text not null default '',
  pincode text not null default '',
  sis_household_id text not null default '',
  note text not null default '',
  guardians_json jsonb not null default '[]'::jsonb,
  household_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create table if not exists public.admission_desk_leads (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  household_id text not null default '',
  enquiry_no text not null default '',
  application_no text not null default '',
  stage text not null default 'enquiry'
    check (stage in ('enquiry', 'applied', 'verified', 'enrolled', 'lost')),
  academic_year_code text not null,
  source text not null default 'walk_in',
  child_name text not null default '',
  mobile text not null default '',
  guardian_name text not null default '',
  class_sought_id text not null default '',
  assigned_to text not null default '',
  next_follow_up_at date,
  lead_date date,
  student_id text not null default '',
  admission_no text not null default '',
  sis_match text not null default '',
  sis_student_id text not null default '',
  lead_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, enquiry_no)
);

create table if not exists public.admission_desk_registration_payments (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null default '',
  lead_id text not null default '',
  fee_head_id text not null default '',
  amount_paise bigint not null default 0 check (amount_paise >= 0),
  status text not null default 'open'
    check (status in ('open', 'paid', 'cancelled', 'waived')),
  mode text not null default 'counter',
  mobile text not null default '',
  child_name text not null default '',
  paid_at timestamptz,
  payment_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create table if not exists public.admission_desk_field_ops (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  ops_json jsonb not null default '{}'::jsonb,
  sequences_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.admission_desk_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  household_count int not null default 0,
  lead_count int not null default 0,
  open_lead_count int not null default 0,
  enrolled_lead_count int not null default 0,
  registration_payment_count int not null default 0,
  last_lead_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists admission_desk_leads_stage_idx
  on public.admission_desk_leads (tenant_id, stage, next_follow_up_at);

create index if not exists admission_desk_leads_mobile_idx
  on public.admission_desk_leads (tenant_id, mobile);

create index if not exists admission_desk_leads_household_idx
  on public.admission_desk_leads (tenant_id, household_id);

create index if not exists admission_desk_households_mobile_idx
  on public.admission_desk_households (tenant_id, primary_mobile);

comment on table public.admission_desk_leads is
  'CRM leads — system of record (full payload in lead_json)';
comment on table public.admission_desk_field_ops is
  'Survey beats, team, sessions, sequences (ancillary desk slice)';
