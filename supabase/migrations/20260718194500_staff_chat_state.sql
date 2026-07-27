-- Internal staff WhatsApp-style chat blob

create table if not exists public.staff_chat_state (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  state jsonb not null default '{"version":1}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.staff_chat_state enable row level security;

drop policy if exists "staff_chat_state_tenant_all" on public.staff_chat_state;
create policy "staff_chat_state_tenant_all"
  on public.staff_chat_state for all to authenticated
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

grant select, insert, update, delete on public.staff_chat_state to authenticated;
grant all on public.staff_chat_state to service_role;

comment on table public.staff_chat_state is
  'Tenant internal staff DM chat threads and messages';
