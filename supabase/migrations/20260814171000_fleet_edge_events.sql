-- Tata Motors Fleet Edge TimeBound Push (webhook) ingestion — raw event log.
-- Deliberately append-only and loosely typed (payload jsonb) rather than
-- normalized into per-field columns: Fleet Edge's own doc only shows an
-- "Example Payload", not a guaranteed exhaustive schema, so this stores the
-- real truth first. Normalized views (GPS pings, driver safety scorecards,
-- auto-raised repair requests) are a deliberate fast-follow once real
-- traffic has been observed, not guessed from the example payload alone.

create table if not exists public.fleet_edge_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_type text not null check (event_type in ('alert', 'details')),
  alert_name text,
  vehicle_ref text,
  registration_number text,
  event_at timestamptz,
  window_from timestamptz,
  window_to timestamptz,
  source_ip text,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

alter table public.fleet_edge_events enable row level security;

create policy fleet_edge_events_tenant_all
  on public.fleet_edge_events
  for all
  using (is_tenant_member(tenant_id));

create index if not exists fleet_edge_events_tenant_reg_idx
  on public.fleet_edge_events (tenant_id, registration_number, received_at desc);

create index if not exists fleet_edge_events_tenant_type_idx
  on public.fleet_edge_events (tenant_id, event_type, received_at desc);

grant select, insert, update, delete on public.fleet_edge_events to service_role;

notify pgrst, 'reload schema';
