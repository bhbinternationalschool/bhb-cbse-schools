-- WhatsApp template registry + ERP automation catalog (domain blobs)

create table if not exists public.wa_templates_state (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  state jsonb not null default '{"version":1,"templates":[],"lastMetaSyncAt":"","audit":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.automation_state (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  state jsonb not null default '{"version":1,"rules":[],"approvals":[],"runs":[],"lastTickAt":""}'::jsonb,
  updated_at timestamptz not null default now()
);

do $$
declare
  t text;
begin
  foreach t in array array['wa_templates_state', 'automation_state']
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

comment on table public.wa_templates_state is
  'School-wide Meta WhatsApp template registry (EN/HI, media/carousel, approval statuses)';
comment on table public.automation_state is
  'ERP automation rules + approval-first queue (Masters Automation tab)';
