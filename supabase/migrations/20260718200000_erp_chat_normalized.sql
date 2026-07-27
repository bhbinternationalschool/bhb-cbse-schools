-- Role-scoped ERP chat: normalized threads/messages + blob fallback with merge-friendly shape.
-- Thread kinds: staff_dm | staff_group | staff_parent_dm | class_announcement

create table if not exists public.erp_chat_threads (
  id text primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  academic_year_code text not null default '',
  kind text not null check (
    kind in ('staff_dm', 'staff_group', 'staff_parent_dm', 'class_announcement')
  ),
  title text not null default '',
  class_id text not null default '',
  section_id text not null default '',
  household_id text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists erp_chat_threads_tenant_ay_idx
  on public.erp_chat_threads (tenant_id, academic_year_code);
create index if not exists erp_chat_threads_section_idx
  on public.erp_chat_threads (tenant_id, section_id)
  where section_id <> '';
create index if not exists erp_chat_threads_household_idx
  on public.erp_chat_threads (tenant_id, household_id)
  where household_id <> '';

create table if not exists public.erp_chat_participants (
  thread_id text not null references public.erp_chat_threads (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  actor_key text not null,
  actor_kind text not null check (actor_kind in ('staff', 'parent')),
  can_post boolean not null default true,
  joined_at timestamptz not null default now(),
  primary key (thread_id, actor_key)
);

create index if not exists erp_chat_participants_actor_idx
  on public.erp_chat_participants (tenant_id, actor_key);

create table if not exists public.erp_chat_messages (
  id text primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  thread_id text not null references public.erp_chat_threads (id) on delete cascade,
  from_actor_key text not null,
  from_actor_kind text not null check (from_actor_kind in ('staff', 'parent')),
  text text not null,
  created_at timestamptz not null default now()
);

create index if not exists erp_chat_messages_thread_idx
  on public.erp_chat_messages (thread_id, created_at);

create table if not exists public.erp_chat_reads (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  thread_id text not null references public.erp_chat_threads (id) on delete cascade,
  actor_key text not null,
  last_read_at timestamptz not null default now(),
  primary key (thread_id, actor_key)
);

-- Blob fallback for demo / merge-on-write clients (replaces sole reliance on staff_chat_state)
create table if not exists public.erp_chat_state (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  state jsonb not null default '{"version":2,"threads":[],"messages":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.erp_chat_threads enable row level security;
alter table public.erp_chat_participants enable row level security;
alter table public.erp_chat_messages enable row level security;
alter table public.erp_chat_reads enable row level security;
alter table public.erp_chat_state enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'erp_chat_threads',
    'erp_chat_participants',
    'erp_chat_messages',
    'erp_chat_reads',
    'erp_chat_state'
  ]
  loop
    execute format(
      'drop policy if exists %I on public.%I',
      t || '_tenant_all',
      t
    );
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

comment on table public.erp_chat_threads is
  'ERP chat threads: staff DM/group, staff-parent DM, class announcements';
comment on table public.erp_chat_state is
  'Tenant ERP chat blob (v2) for demo merge-on-write sync';
