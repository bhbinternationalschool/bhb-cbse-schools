-- Live positions from Tata Fleet Edge Basic Push telemetry.
--
-- Telemetry has been arriving since 10 Sep 2026 17:33 IST as raw jsonb rows
-- in fleet_edge_events. Nothing read the coordinates out of them: the Live
-- map plotted the desk's manual gpsPings slice, so the strip said "live" over
-- an empty map. This table is the normalised position log the map, the
-- parent app and the owner alerts read; one row per telemetry event, joined
-- back to the raw event so nothing is lost and nothing is duplicated.
--
-- The vehicle key is Fleet Edge's vehicleId (the VIN), with the plate kept
-- alongside; the desk links by plate first, VIN second (fleetEdgeLink.ts).

create table if not exists public.fleet_vehicle_positions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  vehicle_ref text not null,
  registration_number text,
  recorded_at timestamptz not null,
  lat double precision not null,
  lng double precision not null,
  speed_kmh double precision,
  course_deg double precision,
  ignition_on boolean,
  fuel_percent double precision,
  odometer_km double precision,
  gps_fix boolean,
  event_id uuid references public.fleet_edge_events(id) on delete set null,
  received_at timestamptz not null default now()
);

alter table public.fleet_vehicle_positions enable row level security;

create policy fleet_vehicle_positions_tenant_all
  on public.fleet_vehicle_positions
  for all
  using (is_tenant_member(tenant_id));

create index if not exists fleet_vehicle_positions_vehicle_time_idx
  on public.fleet_vehicle_positions (tenant_id, vehicle_ref, recorded_at desc);

create index if not exists fleet_vehicle_positions_time_idx
  on public.fleet_vehicle_positions (tenant_id, recorded_at desc);

-- One position per raw event, so a replayed webhook never doubles a track.
create unique index if not exists fleet_vehicle_positions_event_uq
  on public.fleet_vehicle_positions (event_id) where event_id is not null;

grant select, insert, update, delete on public.fleet_vehicle_positions to service_role;

-- Latest position per vehicle for a tenant — what the map and the parent
-- app ask for on every poll.
create or replace function public.fleet_latest_positions(p_tenant_id uuid)
returns setof public.fleet_vehicle_positions
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (vehicle_ref) *
  from public.fleet_vehicle_positions
  where tenant_id = p_tenant_id
  order by vehicle_ref, recorded_at desc;
$$;

grant execute on function public.fleet_latest_positions(uuid) to service_role;

-- Backfill: every telemetry event already stored that carries a real fix.
insert into public.fleet_vehicle_positions
  (tenant_id, vehicle_ref, registration_number, recorded_at, lat, lng, speed_kmh, course_deg,
   ignition_on, fuel_percent, odometer_km, gps_fix, event_id, received_at)
select
  e.tenant_id,
  coalesce(e.vehicle_ref, e.registration_number),
  e.registration_number,
  coalesce(e.event_at, e.received_at),
  (e.payload->>'gpsLatitude')::double precision,
  (e.payload->>'gpsLongitude')::double precision,
  nullif(e.payload->>'speed', '')::double precision,
  nullif(e.payload->>'gpsCourseInDegrees', '')::double precision,
  case when lower(e.payload->>'ignitionOn') in ('true','1') then true
       when lower(e.payload->>'ignitionOn') in ('false','0') then false end,
  coalesce(nullif(e.payload->>'fuelLevelPercent', '')::double precision,
           nullif(e.payload->>'primaryFuelLevel', '')::double precision),
  nullif(e.payload->>'odometer', '')::double precision,
  case when lower(e.payload->>'gpsFix') in ('true','1') then true
       when lower(e.payload->>'gpsFix') in ('false','0') then false end,
  e.id,
  e.received_at
from public.fleet_edge_events e
where e.event_type = 'telemetry'
  and coalesce(e.vehicle_ref, e.registration_number) is not null
  and (e.payload->>'gpsLatitude') ~ '^-?[0-9]+(\.[0-9]+)?$'
  and (e.payload->>'gpsLongitude') ~ '^-?[0-9]+(\.[0-9]+)?$'
  and abs((e.payload->>'gpsLatitude')::double precision) > 0.0001
  and abs((e.payload->>'gpsLongitude')::double precision) > 0.0001
  -- Tata's demo vehicle (MATXXXXXXXX / HRXXXXXX) ships with every account.
  and coalesce(e.vehicle_ref, '') !~ 'X{4,}'
  and coalesce(e.registration_number, '') !~ 'X{4,}'
on conflict (event_id) where event_id is not null do nothing;

notify pgrst, 'reload schema';
