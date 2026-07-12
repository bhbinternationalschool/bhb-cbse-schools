-- Phase 0 foundation — BHB International
-- Timezone business rule: Asia/Kolkata (IST) at application layer
-- Enable extensions
create extension if not exists "pgcrypto";

-- Tenants
create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  timezone text not null default 'Asia/Kolkata',
  board_mode text not null default 'DUAL' check (board_mode in ('UP_STATE', 'CBSE', 'DUAL')),
  logo_url text,
  favicon_url text,
  primary_color text default '#203050',
  accent_color text default '#C5A028',
  domain text,
  created_at timestamptz not null default now()
);

-- Academic years / sessions
create table if not exists public.academic_years (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  label text not null,
  starts_on date not null,
  ends_on date not null,
  status text not null default 'upcoming'
    check (status in ('upcoming', 'current', 'closed')),
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);

-- Profiles (linked to auth.users when Supabase Auth is used)
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  full_name text not null,
  email text,
  mobile text,
  persona text not null check (persona in ('staff', 'parent', 'field', 'student')),
  photo_url text,
  language text not null default 'en' check (language in ('en', 'hi')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_en text not null,
  name_hi text
);

create table if not exists public.user_role_assignments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  campus_id uuid,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (profile_id, role_id)
);

-- Campuses
create table if not exists public.campuses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  code text not null,
  is_primary boolean not null default false,
  unique (tenant_id, code)
);

-- Classes & sections
create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  unique (tenant_id, name)
);

create table if not exists public.sections (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  name text not null,
  unique (class_id, name)
);

-- Students (master)
create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  admission_no text,
  full_name text not null,
  photo_url text,
  gender text,
  dob date,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  unique (tenant_id, admission_no)
);

create table if not exists public.student_enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  class_id uuid not null references public.classes(id),
  section_id uuid references public.sections(id),
  tag text not null default 'NEW' check (tag in ('NEW', 'PROMOTE', 'TRANSFER_IN', 'RE_ADMISSION')),
  unique (student_id, academic_year_id)
);

-- Feature flags (module registry stub)
create table if not exists public.tenant_modules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  module_code text not null,
  enabled boolean not null default false,
  unique (tenant_id, module_code)
);

-- Seed BHB International
insert into public.tenants (slug, name, timezone, board_mode, domain, primary_color, accent_color)
values (
  'bhb-international',
  'BHB International School',
  'Asia/Kolkata',
  'DUAL',
  'erp.bhbinternational.school',
  '#203050',
  '#C5A028'
)
on conflict (slug) do nothing;

insert into public.roles (code, name_en, name_hi) values
  ('owner', 'Owner', 'संचालक'),
  ('principal', 'Principal', 'प्रधानाचार्य'),
  ('admin', 'Admin', 'प्रशासक'),
  ('accounts', 'Accounts', 'लेखा'),
  ('teacher', 'Teacher', 'शिक्षक'),
  ('parent', 'Parent', 'अभिभावक'),
  ('driver', 'Driver', 'चालक'),
  ('gate', 'Gate', 'गेट')
on conflict (code) do nothing;

-- Current AY for BHB (adjust dates as needed)
insert into public.academic_years (tenant_id, code, label, starts_on, ends_on, status)
select id, '2025-26', '2025-26', '2025-04-01', '2026-03-31', 'current'
from public.tenants where slug = 'bhb-international'
on conflict (tenant_id, code) do nothing;

insert into public.academic_years (tenant_id, code, label, starts_on, ends_on, status)
select id, '2024-25', '2024-25', '2024-04-01', '2025-03-31', 'closed'
from public.tenants where slug = 'bhb-international'
on conflict (tenant_id, code) do nothing;

insert into public.campuses (tenant_id, name, code, is_primary)
select id, 'Main Campus', 'MAIN', true
from public.tenants where slug = 'bhb-international'
on conflict (tenant_id, code) do nothing;

-- Pilot modules ON
insert into public.tenant_modules (tenant_id, module_code, enabled)
select t.id, m.code, true
from public.tenants t
cross join (values
  ('sis'), ('fees'), ('attendance'), ('cash'), ('banks'), ('certificates'), ('shell')
) as m(code)
where t.slug = 'bhb-international'
on conflict (tenant_id, module_code) do update set enabled = excluded.enabled;

-- Basic RLS stubs (enable when Auth wired)
alter table public.tenants enable row level security;
alter table public.profiles enable row level security;
alter table public.students enable row level security;

create policy "tenant read authenticated"
  on public.tenants for select
  to authenticated
  using (true);

create policy "profiles own tenant"
  on public.profiles for all
  to authenticated
  using (
    tenant_id in (
      select p.tenant_id from public.profiles p where p.auth_user_id = auth.uid()
    )
  );
