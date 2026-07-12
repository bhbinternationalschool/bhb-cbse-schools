-- Foundation masters: school profile, AY/terms, subjects, numbering, holidays, staff

-- School / institution profile (1 row per tenant)
create table if not exists public.school_profiles (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  legal_name text not null,
  display_name text not null,
  short_name text,
  tagline text,
  udise_code text,
  board_mode text not null default 'DUAL'
    check (board_mode in ('UP_STATE', 'CBSE', 'DUAL')),
  affiliation_no text,
  school_code text,
  address text,
  city text,
  state text,
  pincode text,
  phone text,
  email text,
  logo_url text,
  updated_at timestamptz not null default now()
);

create table if not exists public.academic_years (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  label text not null,
  starts_on date not null,
  ends_on date not null,
  status text not null default 'upcoming'
    check (status in ('current', 'closed', 'upcoming')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);

alter table public.academic_years
  add column if not exists is_active boolean not null default true;

create unique index if not exists academic_years_one_current_idx
  on public.academic_years (tenant_id)
  where status = 'current' and is_active = true;

create table if not exists public.academic_terms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  academic_year_code text not null,
  code text not null,
  label text not null,
  starts_on date not null,
  ends_on date not null,
  sort_order int not null default 0,
  unique (tenant_id, academic_year_code, code)
);

create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name_en text not null,
  category text not null default 'scholastic'
    check (category in ('scholastic', 'co_scholastic')),
  co_scholastic_area text,
  is_elective boolean not null default false,
  is_active boolean not null default true,
  sort_order int not null default 0,
  unique (tenant_id, code)
);

create table if not exists public.class_subjects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  periods_per_week int not null default 5,
  is_active boolean not null default true,
  unique (class_id, subject_id)
);

create table if not exists public.number_series (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  label text not null,
  prefix text not null default '',
  next_number int not null default 1,
  pad_width int not null default 4,
  reset_on_ay boolean not null default true,
  unique (tenant_id, code)
);

create table if not exists public.holidays (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  academic_year_code text not null,
  title text not null,
  starts_on date not null,
  ends_on date not null,
  kind text not null default 'school'
    check (kind in ('national', 'school', 'exam', 'other')),
  is_published boolean not null default false,
  published_at timestamptz,
  published_by text,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists holidays_tenant_ay_pub_idx
  on public.holidays (tenant_id, academic_year_code)
  where is_published = true;

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  is_active boolean not null default true,
  unique (tenant_id, code)
);

create table if not exists public.designations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  department_id uuid references public.departments(id) on delete set null,
  is_active boolean not null default true,
  unique (tenant_id, code)
);

create table if not exists public.staff_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  emp_code text not null,
  full_name text not null,
  stream text not null default 'teaching'
    check (stream in ('teaching', 'non_teaching')),
  category text not null default 'permanent'
    check (category in ('permanent', 'contract', 'part_time')),
  department_id uuid references public.departments(id) on delete set null,
  designation_id uuid references public.designations(id) on delete set null,
  mobile text,
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  unique (tenant_id, emp_code)
);

-- Seed profile + AY for BHB (idempotent)
insert into public.school_profiles (
  tenant_id, legal_name, display_name, short_name, tagline,
  board_mode, affiliation_no, school_code, address, city, state, pincode
)
select
  t.id,
  'BHB International School',
  'BHB INTERNATIONAL SCHOOL',
  'BHB International',
  'Tradition of excellence',
  'DUAL',
  '213XXXX',
  '70XXX',
  'Varanasi, Uttar Pradesh',
  'Varanasi',
  'Uttar Pradesh',
  '221001'
from public.tenants t
where t.slug = 'bhb-international'
on conflict (tenant_id) do nothing;

insert into public.academic_years (tenant_id, code, label, starts_on, ends_on, status)
select t.id, '2025-26', '2025-26', '2025-04-01', '2026-03-31', 'current'
from public.tenants t
where t.slug = 'bhb-international'
on conflict (tenant_id, code) do update
  set status = excluded.status,
      starts_on = excluded.starts_on,
      ends_on = excluded.ends_on;

insert into public.number_series (tenant_id, code, label, prefix, next_number, pad_width, reset_on_ay)
select t.id, s.code, s.label, s.prefix, s.next_number, s.pad_width, s.reset_on_ay
from public.tenants t
cross join (values
  ('ADMISSION', 'Admission number', 'BHB-', 1001, 4, true),
  ('RECEIPT', 'Fee receipt', 'RCV-', 1, 5, true),
  ('SRN', 'Scholar register (SRN)', 'SRN-', 1, 5, false),
  ('TC', 'Transfer certificate', 'TC-', 1, 4, true)
) as s(code, label, prefix, next_number, pad_width, reset_on_ay)
where t.slug = 'bhb-international'
on conflict (tenant_id, code) do nothing;

comment on table public.school_profiles is
  'Institution identity — UDISE, board, address. Demo UI: Masters → School.';
comment on table public.holidays is
  'School calendar. Published rows block attendance for date range.';
comment on table public.staff_records is
  'Light HR roster — departments/designations/stream. Full HR later.';
