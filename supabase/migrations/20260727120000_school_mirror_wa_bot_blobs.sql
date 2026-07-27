-- Server mirror + WhatsApp bot threads (Cloud Run — survives ephemeral disk).

create table if not exists public.school_mirror_state (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  state jsonb not null default '{"version":1,"updatedAt":"","sis":null,"fees":null,"payments":null,"masters":null,"admissions":null}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.wa_bot_threads_state (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  state jsonb not null default '{"version":1,"updatedAt":"","crm":null,"sis":null,"survey":null,"classChannel":null}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.school_mirror_state enable row level security;
alter table public.wa_bot_threads_state enable row level security;

drop policy if exists "school_mirror_state_tenant_all" on public.school_mirror_state;
create policy "school_mirror_state_tenant_all"
  on public.school_mirror_state for all
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

drop policy if exists "wa_bot_threads_state_tenant_all" on public.wa_bot_threads_state;
create policy "wa_bot_threads_state_tenant_all"
  on public.wa_bot_threads_state for all
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

grant select, insert, update, delete on public.school_mirror_state to authenticated;
grant select, insert, update, delete on public.wa_bot_threads_state to authenticated;
grant all on public.school_mirror_state to service_role;
grant all on public.wa_bot_threads_state to service_role;

comment on table public.school_mirror_state is
  'ERP working-copy mirror for WhatsApp bots / server APIs (SIS, fees, masters, admissions).';
comment on table public.wa_bot_threads_state is
  'WhatsApp CRM / SIS parent / survey / class-channel bot thread stores.';
