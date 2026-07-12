-- SIS go-live: households + richer student / enrollment fields

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  guardian_name text not null,
  mobile text not null,
  email text,
  address text,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);

alter table public.students
  add column if not exists household_id uuid references public.households(id),
  add column if not exists father_name text,
  add column if not exists mother_name text,
  add column if not exists pen text,
  add column if not exists campus_id uuid references public.campuses(id),
  add column if not exists notes text;

alter table public.student_enrollments
  add column if not exists roll_no text,
  add column if not exists fee_group_id uuid references public.fee_groups(id),
  add column if not exists student_type text
    check (student_type is null or student_type in ('NEW', 'PROMOTE', 'MID_YEAR', 'RTE'));

-- Align tag with FeeStudentType where helpful
alter table public.student_enrollments
  drop constraint if exists student_enrollments_tag_check;

alter table public.student_enrollments
  add constraint student_enrollments_tag_check
  check (tag in ('NEW', 'PROMOTE', 'TRANSFER_IN', 'RE_ADMISSION', 'MID_YEAR', 'RTE'));

create index if not exists students_tenant_status_idx
  on public.students (tenant_id, status);

create index if not exists students_household_idx
  on public.students (household_id);

create index if not exists households_tenant_mobile_idx
  on public.households (tenant_id, mobile);

insert into public.tenant_modules (tenant_id, module_code, enabled)
select id, 'sis.students', true
from public.tenants where slug = 'bhb-international'
on conflict (tenant_id, module_code) do update set enabled = true;
