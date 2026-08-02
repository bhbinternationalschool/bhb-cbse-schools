-- RTE / EWS desk — quota seats, applications, settings (rte_state blob retained)

create table if not exists public.rte_desk_seats (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  class_id text not null default '',
  academic_year_code text not null default '',
  type text not null default 'RTE',
  total int not null default 0,
  note text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.rte_desk_applications (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  academic_year_code text not null default '',
  class_id text not null default '',
  type text not null default 'RTE',
  child_name text not null default '',
  parent_name text not null default '',
  mobile text not null default '',
  category text not null default '',
  annual_income text not null default '',
  govt_application_no text not null default '',
  student_id text,
  admission_lead_id text,
  docs_income boolean not null default false,
  docs_category boolean not null default false,
  docs_residence boolean not null default false,
  lottery_no text not null default '',
  merit_rank int not null default 0,
  gender text not null default '',
  date_of_birth text not null default '',
  portal_serial_no text not null default '',
  block_town text not null default '',
  gram_panchayat_ward text not null default '',
  portal_admission_status text not null default '',
  status text not null default 'govt_assigned',
  registration_fee_choice text not null default 'pending',
  registration_fee_amount_paise int not null default 0,
  registration_fee_note text not null default '',
  registration_fee_paid boolean not null default false,
  note text not null default '',
  created_at timestamptz not null default now(),
  decided_by text,
  decided_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.rte_desk_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  mandated_pct numeric not null default 25,
  auto_apply_fee_waiver boolean not null default true,
  note text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.rte_desk_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  seat_count int not null default 0,
  application_count int not null default 0,
  last_application_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists rte_desk_seats_class_idx
  on public.rte_desk_seats (tenant_id, academic_year_code, class_id);

create index if not exists rte_desk_applications_status_idx
  on public.rte_desk_applications (tenant_id, academic_year_code, status);

comment on table public.rte_desk_seats is 'RTE/EWS quota seats — system of record';
