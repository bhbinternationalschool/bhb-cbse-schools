-- Fleet Edge on one endpoint: an 'unknown' stream, and pings stop counting
-- as summaries.
--
-- Fleet Edge's portal accepts ONE endpoint URL per fleet. Pointing it at the
-- telemetry route on 8 Sep 2026 switched the other two streams off — summaries
-- stopped 04:30, alerts 04:08 — and because the SOS escalation runs only on
-- the alert path, a driver's panic press had nowhere to land for two days.
-- The endpoints now dispatch on payload shape instead (lib/fleetEdgePush.ts),
-- which needs two things from the database.
--
-- 1. A payload matching none of the three documented shapes is stored as
--    'unknown'. Dropping it would lose data the vendor started sending
--    without telling anyone; filing it under the nearest-looking stream is
--    how an unrecognised value becomes a fact nobody checked.
--
-- 2. The counts stop including a shape the vendor docs never mention: a
--    payload of {vehicleId, registrationNumber} and nothing else, once a
--    minute since 14 August, 4,837 of them. It is a reachability ping. The
--    old parser accepted any JSON object, so every one was filed as a
--    periodic summary and one vehicle's "5,996 summaries" on the Live tab
--    were 1,169 summaries and 4,834 pings.
--
-- The rows are not deleted. fleet_edge_events is the raw append-only log of
-- what actually arrived, and that is worth keeping intact; it is the counting
-- that was wrong, so the counting is what changes.
--
-- 'unknown' rows are excluded from last_seen_at as well as from the counts.
-- A vehicle heard from only in a shape nothing can read is not a vehicle
-- successfully reporting, and a green "last heard a minute ago" built on rows
-- no one can interpret would be worse than the feed reading as silent.

alter table public.fleet_edge_events
  drop constraint if exists fleet_edge_events_event_type_check;

alter table public.fleet_edge_events
  add constraint fleet_edge_events_event_type_check
  check (event_type in ('alert', 'details', 'telemetry', 'unknown'));

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
  with real_events as (
    select e.*
    from public.fleet_edge_events e
    where e.tenant_id = p_tenant_id
      and coalesce(btrim(e.vehicle_ref), '') <> ''
      and e.event_type in ('alert', 'details', 'telemetry')
      -- A summary is a summary if it carries one of the four data blocks, or
      -- says which window it covers. Anything else filed as 'details' is a
      -- reachability ping that predates the endpoint knowing the difference.
      and (
        e.event_type <> 'details'
        or e.payload ?| array[
             'vehicleSafety', 'vehiclePerformance',
             'vehicleEfficiency', 'vehicleHealth'
           ]
        or (e.payload ? 'from' and e.payload ? 'to')
      )
  )
  select
    e.vehicle_ref as vin,
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
  from real_events e
  group by e.vehicle_ref
  order by max(e.received_at) desc;
$$;

comment on function public.fleet_edge_vehicle_status(uuid) is
  'One row per vehicle Fleet Edge is reporting on: last heard, per-stream counts, newest telemetry. Counts only the three documented streams, and only summaries that carry data — Fleet Edge also pushes an undocumented identity-only ping every minute, 4,837 of which had been counted as summaries.';

notify pgrst, 'reload schema';
