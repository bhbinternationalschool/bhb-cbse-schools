-- Accounts + store/purchase + payroll input blobs (staff attendance / HR / advances)

create table if not exists public.accounts_state (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  state jsonb not null default '{"version":1}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.store_state (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  state jsonb not null default '{"version":1}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_state (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  state jsonb not null default '{"version":1}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.staff_attendance_state (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  state jsonb not null default '{"version":1,"settings":{},"registers":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.staff_hr_state (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  state jsonb not null default '{"version":1}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.staff_advances_state (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  state jsonb not null default '{"version":1,"advances":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

do $$
declare
  t text;
begin
  foreach t in array array[
    'accounts_state',
    'store_state',
    'purchase_state',
    'staff_attendance_state',
    'staff_hr_state',
    'staff_advances_state'
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
