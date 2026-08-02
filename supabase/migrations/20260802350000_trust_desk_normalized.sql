-- Trust infrastructure desk — slice rows (trust_state blob retained)

create table if not exists public.trust_desk_slices (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  slice_key text not null,
  payload jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, slice_key)
);

create table if not exists public.trust_desk_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  slice_count int not null default 0,
  project_count int not null default 0,
  work_item_count int not null default 0,
  last_updated_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.trust_desk_slices is
  'Trust / construction projects — system of record';
