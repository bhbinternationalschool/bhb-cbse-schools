-- SIS roster sync metadata

create table if not exists public.sis_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  household_count int not null default 0,
  student_count int not null default 0,
  active_student_count int not null default 0,
  updated_at timestamptz not null default now()
);

comment on table public.sis_sync_meta is
  'SIS roster snapshot metadata — households + students in sis_* tables';

grant all on public.sis_sync_meta to service_role;

notify pgrst, 'reload schema';
