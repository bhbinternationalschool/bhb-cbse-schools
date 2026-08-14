-- Vehicle identity (model + year) keyed by VIN, so the Fleet Dashboard can
-- tell apart same-model vehicles that only differ by year. Fleet Edge's own
-- push APIs never send model/year (checked against the full TimeBound Push
-- spec and every distinct field name seen in real production traffic — see
-- fleetEdgeAnalytics.ts's file header) — this table is where staff record
-- that context themselves, joined against fleet_edge_events by VIN.
--
-- Deliberately a small standalone table, not a migration of the existing
-- FleetVehicle desk slice (routes, compliance docs, service schedules,
-- driver assignment, Fee Take bus photos) — that slice is localStorage-only
-- today and works; this solves the one specific gap (model/year lookup by
-- VIN) without touching it.

create table if not exists public.fleet_edge_vehicle_identity (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  vin text not null,
  registration_number text,
  model text,
  year integer,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, vin)
);

alter table public.fleet_edge_vehicle_identity enable row level security;

create policy fleet_edge_vehicle_identity_tenant_all
  on public.fleet_edge_vehicle_identity
  for all
  using (is_tenant_member(tenant_id));

create index if not exists fleet_edge_vehicle_identity_tenant_idx
  on public.fleet_edge_vehicle_identity (tenant_id);

grant select, insert, update, delete on public.fleet_edge_vehicle_identity to service_role;

notify pgrst, 'reload schema';
