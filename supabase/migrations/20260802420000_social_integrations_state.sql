-- Social integrations — ERP-stored credentials (Meta, Telegram) per tenant

create table if not exists public.social_integrations_state (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  state jsonb not null default '{"version":1}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.social_integrations_state enable row level security;

drop policy if exists social_integrations_state_tenant_all on public.social_integrations_state;
create policy social_integrations_state_tenant_all
  on public.social_integrations_state for all to authenticated
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

grant select, insert, update, delete on public.social_integrations_state to authenticated;
grant all on public.social_integrations_state to service_role;

comment on table public.social_integrations_state is
  'Facebook / Instagram / Telegram credentials entered in ERP Comms → Social';
