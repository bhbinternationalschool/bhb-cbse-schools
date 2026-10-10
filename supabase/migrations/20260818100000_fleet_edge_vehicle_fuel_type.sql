-- Fuel type per vehicle. Fleet Edge never sends it (its 30-minute summaries
-- carry one untyped fuelUsed number; only the not-yet-enabled Basic Push
-- telemetry has a secondary tank), so staff record it here. Used by the
-- Fleet Edge report to label CNG buses and read tank 2 as CNG.
alter table public.fleet_edge_vehicle_identity
  add column if not exists fuel_type text
  check (fuel_type is null or fuel_type in ('diesel','petrol','cng','petrol_cng','diesel_cng','electric'));

notify pgrst, 'reload schema';
