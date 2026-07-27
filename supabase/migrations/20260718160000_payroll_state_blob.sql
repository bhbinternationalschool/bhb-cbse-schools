-- Week 11–13: payroll runs blob (side-modules stay local; core runs sync)

create table if not exists public.payroll_state (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  state jsonb not null default '{"version":2,"runs":[],"audit":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.payroll_state enable row level security;

drop policy if exists "payroll_state_tenant_all" on public.payroll_state;
create policy "payroll_state_tenant_all"
  on public.payroll_state for all
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

grant select, insert, update, delete on public.payroll_state to authenticated;
grant all on public.payroll_state to service_role;
