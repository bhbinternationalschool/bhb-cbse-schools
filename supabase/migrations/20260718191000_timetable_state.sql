-- Timetable weekly grids + bell template blob

create table if not exists public.timetable_state (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  state jsonb not null default '{"version":1}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.timetable_state enable row level security;

drop policy if exists "timetable_state_tenant_all" on public.timetable_state;
create policy "timetable_state_tenant_all"
  on public.timetable_state for all to authenticated
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

grant select, insert, update, delete on public.timetable_state to authenticated;
grant all on public.timetable_state to service_role;

comment on table public.timetable_state is
  'Tenant timetable: bell template, draft grids, published snapshot';
