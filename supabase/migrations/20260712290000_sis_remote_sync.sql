-- Full SIS remote sync mirror (households + students).
-- Text primary keys match demo localStorage ids (hh_…, stu_…) and future UUIDs.
-- Canonical UUID tables (public.students / households) remain for normalized go-live later.

create table if not exists public.sis_households (
  id text primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  code text not null default '',
  guardian_name text not null default '',
  mobile text not null default '',
  whatsapp_mobile text not null default '',
  email text not null default '',
  address text not null default '',
  locality text not null default '',
  landmark text not null default '',
  city text not null default '',
  state text not null default '',
  pincode text not null default '',
  alt_mobile text not null default '',
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create table if not exists public.sis_students (
  id text primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  admission_no text not null default '',
  full_name text not null default '',
  gender text not null default '',
  dob date,
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  campus_id text not null default '',
  class_id text not null default '',
  section_id text not null default '',
  roll_no text not null default '',
  academic_year_code text not null default '',
  student_type text not null default 'NEW'
    check (student_type in ('NEW', 'PROMOTE', 'MID_YEAR', 'RTE')),
  fee_group_id text,
  joined_on date,
  father_name text not null default '',
  mother_name text not null default '',
  father_mobile text not null default '',
  mother_mobile text not null default '',
  father_aadhaar_last4 text not null default '',
  mother_aadhaar_last4 text not null default '',
  father_pan text not null default '',
  mother_pan text not null default '',
  guardian_relation text not null default '',
  emergency_name text not null default '',
  emergency_mobile text not null default '',
  household_id text references public.sis_households (id) on delete set null,
  blood_group text not null default '',
  religion text not null default '',
  category text not null default '',
  nationality text not null default 'Indian',
  mother_tongue text not null default '',
  place_of_birth text not null default '',
  aadhaar_last4 text not null default '',
  pen text not null default '',
  pen_status text not null default '',
  apaar_id text not null default '',
  srn text not null default '',
  previous_school text not null default '',
  previous_tc_no text not null default '',
  previous_udise text not null default '',
  docs jsonb not null default '{}'::jsonb,
  notes text not null default '',
  photo_url text not null default '',
  updated_at timestamptz not null default now()
);

-- Expand stub rows created by earlier fee migration
alter table public.sis_students
  add column if not exists admission_no text not null default '',
  add column if not exists gender text not null default '',
  add column if not exists dob date,
  add column if not exists campus_id text not null default '',
  add column if not exists section_id text not null default '',
  add column if not exists roll_no text not null default '',
  add column if not exists academic_year_code text not null default '',
  add column if not exists father_name text not null default '',
  add column if not exists mother_name text not null default '',
  add column if not exists father_mobile text not null default '',
  add column if not exists mother_mobile text not null default '',
  add column if not exists father_aadhaar_last4 text not null default '',
  add column if not exists mother_aadhaar_last4 text not null default '',
  add column if not exists father_pan text not null default '',
  add column if not exists mother_pan text not null default '',
  add column if not exists guardian_relation text not null default '',
  add column if not exists emergency_name text not null default '',
  add column if not exists emergency_mobile text not null default '',
  add column if not exists household_id text,
  add column if not exists blood_group text not null default '',
  add column if not exists religion text not null default '',
  add column if not exists category text not null default '',
  add column if not exists nationality text not null default 'Indian',
  add column if not exists mother_tongue text not null default '',
  add column if not exists place_of_birth text not null default '',
  add column if not exists aadhaar_last4 text not null default '',
  add column if not exists pen text not null default '',
  add column if not exists pen_status text not null default '',
  add column if not exists apaar_id text not null default '',
  add column if not exists srn text not null default '',
  add column if not exists previous_school text not null default '',
  add column if not exists previous_tc_no text not null default '',
  add column if not exists previous_udise text not null default '',
  add column if not exists docs jsonb not null default '{}'::jsonb,
  add column if not exists notes text not null default '',
  add column if not exists photo_url text not null default '',
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sis_students_household_id_fkey'
  ) then
    alter table public.sis_students
      add constraint sis_students_household_id_fkey
      foreign key (household_id) references public.sis_households (id)
      on delete set null;
  end if;
exception when others then
  null;
end $$;

create unique index if not exists sis_students_tenant_admission_ay_uidx
  on public.sis_students (tenant_id, admission_no, academic_year_code)
  where admission_no <> '';

create index if not exists sis_students_tenant_status_idx
  on public.sis_students (tenant_id, status);

create index if not exists sis_students_household_idx
  on public.sis_students (household_id);

create index if not exists sis_households_tenant_mobile_idx
  on public.sis_households (tenant_id, mobile);

alter table public.sis_households enable row level security;
alter table public.sis_students enable row level security;

drop policy if exists "sis_households_tenant_all" on public.sis_households;
create policy "sis_households_tenant_all"
  on public.sis_households for all
  to authenticated
  using (
    tenant_id in (
      select p.tenant_id from public.profiles p where p.auth_user_id = auth.uid()
    )
  )
  with check (
    tenant_id in (
      select p.tenant_id from public.profiles p where p.auth_user_id = auth.uid()
    )
  );

drop policy if exists "sis_students_tenant_all" on public.sis_students;
create policy "sis_students_tenant_all"
  on public.sis_students for all
  to authenticated
  using (
    tenant_id in (
      select p.tenant_id from public.profiles p where p.auth_user_id = auth.uid()
    )
  )
  with check (
    tenant_id in (
      select p.tenant_id from public.profiles p where p.auth_user_id = auth.uid()
    )
  );

insert into public.tenant_modules (tenant_id, module_code, enabled)
select id, 'sis.remote', true
from public.tenants where slug = 'bhb-international'
on conflict (tenant_id, module_code) do update set enabled = true;

comment on table public.sis_households is
  'Dual-mode household roster for app sync (text ids).';
comment on table public.sis_students is
  'Dual-mode student roster for app sync (text ids). Curriculum lives in student_curriculum.';
