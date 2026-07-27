-- CRM / admissions working copy — canonical Supabase sync (like fees_state).

create table if not exists public.admissions_state (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  state jsonb not null default '{"version":1,"households":[],"leads":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.admissions_state enable row level security;

drop policy if exists "admissions_state_tenant_all" on public.admissions_state;
create policy "admissions_state_tenant_all"
  on public.admissions_state for all
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

grant select, insert, update, delete on public.admissions_state to authenticated;
grant all on public.admissions_state to service_role;

comment on table public.admissions_state is
  'Admissions CRM blob — leads, households, survey teams (canonical cloud sync).';

notify pgrst, 'reload schema';
