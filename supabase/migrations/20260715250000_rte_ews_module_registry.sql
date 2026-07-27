-- RTE / EWS quota + module registry (§21c / §24.0 lite)

create table if not exists public.tenant_module_registry (
  tenant_id text not null default 'default',
  module_id text not null,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, module_id)
);

insert into public.tenant_module_registry (module_id, enabled)
values ('rte_ews', false)
on conflict do nothing;

create table if not exists public.rte_quota_seats (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  class_id text not null,
  academic_year_code text not null,
  quota_type text not null check (quota_type in ('RTE', 'EWS', 'SCHOLARSHIP')),
  total int not null default 0,
  note text,
  created_at timestamptz not null default now()
);

create unique index if not exists rte_quota_seats_uniq
  on public.rte_quota_seats (tenant_id, class_id, academic_year_code, quota_type);

create table if not exists public.rte_quota_applications (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  academic_year_code text not null,
  class_id text not null,
  quota_type text not null check (quota_type in ('RTE', 'EWS', 'SCHOLARSHIP')),
  child_name text not null,
  parent_name text,
  mobile text,
  category text,
  annual_income text,
  student_id text,
  admission_lead_id text,
  docs_income boolean not null default false,
  docs_category boolean not null default false,
  docs_residence boolean not null default false,
  lottery_no text,
  merit_rank int not null default 0,
  status text not null default 'submitted',
  note text,
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.rte_quota_applications
  add column if not exists govt_application_no text;

create index if not exists rte_quota_apps_govt_no
  on public.rte_quota_applications (tenant_id, govt_application_no);

create table if not exists public.rte_settings (
  tenant_id text primary key default 'default',
  mandated_pct int not null default 25,
  auto_apply_fee_waiver boolean not null default true,
  note text,
  updated_at timestamptz not null default now()
);
