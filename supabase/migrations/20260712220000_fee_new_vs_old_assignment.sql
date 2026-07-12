-- New vs old student fee assignment
-- SIS joined_on drives mid-year billing; fee groups keyed by student_type.
-- Dual-mode roster table (text ids) — created here so later indexes are safe.

create table if not exists public.sis_students (
  id text primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  full_name text not null default '',
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  class_id text not null default '',
  joined_on date,
  student_type text not null default 'NEW'
    check (student_type in ('NEW', 'PROMOTE', 'MID_YEAR', 'RTE')),
  fee_group_id text,
  updated_at timestamptz not null default now()
);

alter table if exists public.sis_students
  add column if not exists joined_on date,
  add column if not exists student_type text not null default 'NEW',
  add column if not exists fee_group_id text;

-- Relax legacy uuid fee_group_id if a prior stub used uuid (no-op when text)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sis_students'
      and column_name = 'fee_group_id'
      and data_type = 'uuid'
  ) then
    alter table public.sis_students
      alter column fee_group_id type text using fee_group_id::text;
  end if;
exception when others then
  null;
end $$;

create index if not exists sis_students_fee_group_idx
  on public.sis_students (fee_group_id)
  where fee_group_id is not null;

create index if not exists sis_students_type_class_idx
  on public.sis_students (student_type, class_id)
  where status = 'active';

comment on column public.sis_students.joined_on is
  'Session join date. Mid-year billing follows school mid_year_fee_policy (April academic, skip before join, transport from join).';

comment on column public.sis_students.student_type is
  'NEW = admission bundle; PROMOTE = continuing; MID_YEAR = mid-session join; RTE = EWS.';

create table if not exists public.school_mid_year_fee_policy (
  id uuid primary key default gen_random_uuid(),
  academic_year_code text not null,
  skip_months_before_join boolean not null default true,
  always_bill_april_academic boolean not null default true,
  transport_from_join_month_only boolean not null default true,
  include_one_time_before_join boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (academic_year_code)
);

comment on table public.school_mid_year_fee_policy is
  'School-configurable mid-year join fee rules.';
