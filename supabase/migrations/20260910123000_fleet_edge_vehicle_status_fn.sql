-- Transport → Live tab: per-vehicle Fleet Edge status, aggregated in Postgres.
--
-- WHY: the status strip was built on
--   select vehicle_ref, registration_number, event_type, received_at
--     from fleet_edge_events ... limit 20000
-- and then grouped in TypeScript. PostgREST caps every request at 1,000 rows
-- and reports the cut as SUCCESS, so with 11,231 events the strip counted the
-- newest 1,000 and showed the office "41 summaries · 0 alerts" for a bus with
-- 1,167 summaries and 233 alerts. Nothing errored.
--
-- Paging the whole table would be correct today and unusable within weeks:
-- Tata switched the Basic Push on this morning and each tracker pushes about
-- once a minute whether or not the ignition is on — roughly 8,600 telemetry
-- rows a day across six vehicles. A screen that reads every row ever received
-- to print six numbers is a screen that gets slower every day it runs.
--
-- Six rows out of Postgres instead, and no row cap can truncate a result that
-- is already smaller than the fleet.

create or replace function public.fleet_edge_vehicle_status(p_tenant_id uuid)
returns table (
  vin text,
  registration_number text,
  last_seen_at timestamptz,
  last_event_type text,
  detail_count bigint,
  alert_count bigint,
  telemetry_count bigint,
  last_telemetry_at timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    e.vehicle_ref as vin,
    -- The registration off the most recent event that carried one. Fleet Edge
    -- sends "NA" for a vehicle with no plate yet and then the real plate once
    -- it is registered; taking the newest non-empty value lets that land
    -- without a backfill. ("NA" is neutralised downstream, in
    -- normalizeVehicleKey, so it never matches another unregistered vehicle.)
    (array_agg(e.registration_number order by e.received_at desc)
       filter (where coalesce(btrim(e.registration_number), '') <> ''))[1]
      as registration_number,
    max(e.received_at) as last_seen_at,
    (array_agg(e.event_type order by e.received_at desc))[1] as last_event_type,
    count(*) filter (where e.event_type = 'details')::bigint as detail_count,
    count(*) filter (where e.event_type = 'alert')::bigint as alert_count,
    count(*) filter (where e.event_type = 'telemetry')::bigint as telemetry_count,
    max(e.received_at) filter (where e.event_type = 'telemetry')
      as last_telemetry_at
  from public.fleet_edge_events e
  where e.tenant_id = p_tenant_id
    and coalesce(btrim(e.vehicle_ref), '') <> ''
  group by e.vehicle_ref
  order by max(e.received_at) desc;
$$;

comment on function public.fleet_edge_vehicle_status(uuid) is
  'One row per vehicle Fleet Edge is reporting on: last heard, per-stream counts, newest telemetry. Replaces a client-side group-by over every event row, which PostgREST truncated at 1,000 and so understated every count on the Live tab.';

revoke all on function public.fleet_edge_vehicle_status(uuid) from public;
grant execute on function public.fleet_edge_vehicle_status(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
