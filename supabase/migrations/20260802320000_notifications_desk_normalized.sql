-- Notifications desk — in-app bell items (notifications_state blob retained)

create table if not exists public.notifications_desk_items (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null default '',
  body text not null default '',
  kind text not null default 'system',
  href text not null default '/home',
  audience text not null default 'all',
  source_id text not null default '',
  created_at timestamptz not null default now(),
  read_by_json jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.notifications_desk_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  item_count int not null default 0,
  last_created_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists notifications_desk_items_tenant_created_idx
  on public.notifications_desk_items (tenant_id, created_at desc);

create index if not exists notifications_desk_items_source_idx
  on public.notifications_desk_items (tenant_id, source_id, kind);

comment on table public.notifications_desk_items is
  'In-app notification feed — system of record';
