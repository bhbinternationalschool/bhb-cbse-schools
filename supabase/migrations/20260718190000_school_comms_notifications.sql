-- Notices / news / gallery + in-app notifications

create table if not exists public.school_comms_state (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  state jsonb not null default '{"version":1,"notices":[],"news":[],"albums":[],"photos":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.notifications_state (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  state jsonb not null default '{"version":1,"items":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

do $$
declare
  t text;
begin
  foreach t in array array['school_comms_state', 'notifications_state']
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
