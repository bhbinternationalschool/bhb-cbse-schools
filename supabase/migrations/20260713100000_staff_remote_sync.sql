-- Staff remote sync mirror (departments + designations + staff).
-- Text primary keys match Masters localStorage ids (dep_…, des_…, stf_…).
-- Canonical UUID tables (public.staff_records / departments / designations) remain for later go-live.

create table if not exists public.sis_departments (
  id text primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  code text not null default '',
  name text not null default '',
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create table if not exists public.sis_designations (
  id text primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  code text not null default '',
  name text not null default '',
  department_id text,
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create table if not exists public.sis_staff (
  id text primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  emp_code text not null default '',
  full_name text not null default '',
  stream text not null default 'teaching'
    check (stream in ('teaching', 'non_teaching')),
  category text not null default 'permanent'
    check (category in ('permanent', 'contract', 'part_time')),
  department_id text,
  designation_id text,
  campus_id text not null default '',
  mobile text not null default '',
  email text not null default '',
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  -- Full StaffRecord (camelCase) minus heavy data: URLs stripped client-side
  profile jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create unique index if not exists sis_staff_tenant_emp_uidx
  on public.sis_staff (tenant_id, emp_code)
  where emp_code <> '';

create index if not exists sis_staff_tenant_status_idx
  on public.sis_staff (tenant_id, status);

create index if not exists sis_departments_tenant_idx
  on public.sis_departments (tenant_id);

create index if not exists sis_designations_tenant_idx
  on public.sis_designations (tenant_id);

alter table public.sis_departments enable row level security;
alter table public.sis_designations enable row level security;
alter table public.sis_staff enable row level security;

drop policy if exists "sis_departments_tenant_all" on public.sis_departments;
create policy "sis_departments_tenant_all"
  on public.sis_departments for all
  to authenticated
  using (
    tenant_id in (
      select p.tenant_id from public.profiles p
      where p.auth_user_id = auth.uid()
    )
  )
  with check (
    tenant_id in (
      select p.tenant_id from public.profiles p
      where p.auth_user_id = auth.uid()
    )
  );

drop policy if exists "sis_designations_tenant_all" on public.sis_designations;
create policy "sis_designations_tenant_all"
  on public.sis_designations for all
  to authenticated
  using (
    tenant_id in (
      select p.tenant_id from public.profiles p
      where p.auth_user_id = auth.uid()
    )
  )
  with check (
    tenant_id in (
      select p.tenant_id from public.profiles p
      where p.auth_user_id = auth.uid()
    )
  );

drop policy if exists "sis_staff_tenant_all" on public.sis_staff;
create policy "sis_staff_tenant_all"
  on public.sis_staff for all
  to authenticated
  using (
    tenant_id in (
      select p.tenant_id from public.profiles p
      where p.auth_user_id = auth.uid()
    )
  )
  with check (
    tenant_id in (
      select p.tenant_id from public.profiles p
      where p.auth_user_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.sis_departments to authenticated;
grant select, insert, update, delete on public.sis_designations to authenticated;
grant select, insert, update, delete on public.sis_staff to authenticated;

grant all on public.sis_departments to service_role;
grant all on public.sis_designations to service_role;
grant all on public.sis_staff to service_role;

insert into public.tenant_modules (tenant_id, module_code, enabled)
select id, 'staff.remote', true
from public.tenants where slug = 'bhb-international'
on conflict (tenant_id, module_code) do update set enabled = true;

comment on table public.sis_departments is
  'Dual-mode departments for Masters/Staff sync (text ids).';
comment on table public.sis_designations is
  'Dual-mode designations for Masters/Staff sync (text ids).';
comment on table public.sis_staff is
  'Dual-mode staff roster for app sync (text ids). Full profile in jsonb.';

notify pgrst, 'reload schema';
