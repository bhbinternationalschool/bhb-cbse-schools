-- Transport desk — slice rows (transport_state blob retained)

create table if not exists public.transport_desk_slices (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  slice_key text not null,
  payload jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, slice_key)
);

create table if not exists public.transport_desk_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  slice_count int not null default 0,
  route_count int not null default 0,
  vehicle_count int not null default 0,
  assignment_count int not null default 0,
  last_updated_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.transport_desk_slices is
  'Transport routes, fleet, riders — system of record';
