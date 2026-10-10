-- Fleet Edge per-vehicle status: classify by payload SHAPE, not by the label
-- the endpoint stored.
--
-- Within minutes of the previous migration this stopped being hypothetical.
-- Tata re-pointed the TimeBound Push at the single configured URL — /live —
-- and five real periodic summaries arrived there at 12:30 on 10 Sep 2026
-- carrying from/to/vehicleSafety/vehiclePerformance/vehicleEfficiency. The
-- telemetry parser accepted every one (it accepted any JSON object) and filed
-- them as telemetry. So two buses read as "reporting live position" on the
-- strip while sending no position at all, and their summaries were lost.
--
-- fleet_edge_events.event_type therefore records what the endpoint BELIEVED,
-- and belief has been wrong in both directions: 4,853 reachability pings
-- stored as summaries, 5 summaries stored as telemetry. The payload is the
-- only thing that was never wrong.
--
-- So the counting classifies the payload itself, using the same rules and the
-- same order as lib/fleetEdgePush.ts — alert, then details, then telemetry —
-- and anything matching none of them counts as nothing. That makes the Live
-- tab correct for traffic already in the table, without rewriting a single
-- stored row: fleet_edge_events stays the raw log of what arrived, which is
-- what makes an audit like this one possible at all.
--
-- Keep these rules in step with classifyFleetEdgePush. If they drift, the
-- screen and the ingest disagree about what arrived, which is the exact
-- failure this migration exists to end.

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
  with shaped as (
    select
      e.vehicle_ref,
      e.registration_number,
      e.received_at,
      case
        when coalesce(btrim(e.payload ->> 'alertName'), '') <> '' then 'alert'
        when e.payload ?| array[
               'vehicleSafety', 'vehiclePerformance',
               'vehicleEfficiency', 'vehicleHealth'
             ]
          or (e.payload ? 'from' and e.payload ? 'to') then 'details'
        when e.payload ?| array[
               'gpsLatitude', 'gpsLongitude', 'gpsFix',
               'ignitionOn', 'vehicleStatus'
             ] then 'telemetry'
        -- Reachability pings and anything the vendor adds without telling
        -- anyone. Counted as nothing; still in the table to be looked at.
        else null
      end as kind
    from public.fleet_edge_events e
    where e.tenant_id = p_tenant_id
      and coalesce(btrim(e.vehicle_ref), '') <> ''
  )
  select
    s.vehicle_ref as vin,
    (array_agg(s.registration_number order by s.received_at desc)
       filter (where coalesce(btrim(s.registration_number), '') <> ''))[1]
      as registration_number,
    max(s.received_at) as last_seen_at,
    (array_agg(s.kind order by s.received_at desc))[1] as last_event_type,
    count(*) filter (where s.kind = 'details')::bigint as detail_count,
    count(*) filter (where s.kind = 'alert')::bigint as alert_count,
    count(*) filter (where s.kind = 'telemetry')::bigint as telemetry_count,
    max(s.received_at) filter (where s.kind = 'telemetry') as last_telemetry_at
  from shaped s
  where s.kind is not null
  group by s.vehicle_ref
  order by max(s.received_at) desc;
$$;

comment on function public.fleet_edge_vehicle_status(uuid) is
  'One row per vehicle Fleet Edge is reporting on, classified by payload shape rather than by the stored event_type — the endpoint mislabelled traffic in both directions before it learned to dispatch. Mirrors classifyFleetEdgePush in lib/fleetEdgePush.ts; keep the two in step.';

notify pgrst, 'reload schema';
