-- Fleet Edge "Basic Push" spec adds a third stream (continuous
-- VehicleTelemetry) alongside the TimeBound Push spec's 'alert'/'details' —
-- widen the check constraint to allow it.

alter table public.fleet_edge_events
  drop constraint if exists fleet_edge_events_event_type_check;

alter table public.fleet_edge_events
  add constraint fleet_edge_events_event_type_check
  check (event_type in ('alert', 'details', 'telemetry'));

notify pgrst, 'reload schema';
