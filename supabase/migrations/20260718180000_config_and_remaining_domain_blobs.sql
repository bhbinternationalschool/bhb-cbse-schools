-- Config + remaining domain blobs (RBAC, modules, trust, transport, campus ops)

create table if not exists public.rbac_state (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  state jsonb not null default '{"version":1}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.module_registry_state (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  state jsonb not null default '{"version":1,"enabled":{}}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.trust_state (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  state jsonb not null default '{"version":1}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.transport_state (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  state jsonb not null default '{"version":2}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.homework_state (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  state jsonb not null default '{"version":1}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.ptm_state (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  state jsonb not null default '{"version":1,"events":[],"slots":[],"bookings":[],"feedback":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.certificates_state (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  state jsonb not null default '{"version":1}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.vault_state (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  state jsonb not null default '{"version":1}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.rte_state (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  state jsonb not null default '{"version":1}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.fee_recovery_tasks_state (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  state jsonb not null default '{"version":1,"meetings":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

do $$
declare
  t text;
begin
  foreach t in array array[
    'rbac_state',
    'module_registry_state',
    'trust_state',
    'transport_state',
    'homework_state',
    'ptm_state',
    'certificates_state',
    'vault_state',
    'rte_state',
    'fee_recovery_tasks_state'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_tenant_all', t);
    execute format(
      $p$
      create policy %I on public.%I for all to authenticated
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
      )
      $p$,
      t || '_tenant_all',
      t
    );
    execute format(
      'grant select, insert, update, delete on public.%I to authenticated',
      t
    );
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
