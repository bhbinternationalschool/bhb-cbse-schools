-- Nightly GPS stop discovery (director, 14 Oct 2026: "AI always track the API,
-- find any new stop on any vehicle and add it in the ERP automatically").
--
-- Each stop the job adds is logged in transport_desk_gaps as kind
-- 'new_gps_stop' with its coordinates. The row is the office's to-do and the
-- job's memory: a point within 150 m of any logged one is never added again,
-- so a stop the office deletes as "not a boarding point" stays deleted.

alter table public.transport_desk_gaps
  add column if not exists lat numeric,
  add column if not exists lng numeric;

alter table public.transport_desk_gaps drop constraint if exists transport_desk_gaps_kind_check;
alter table public.transport_desk_gaps add constraint transport_desk_gaps_kind_check
  check (kind in ('fee_distance','stop_not_reached','rider_stop','rider_bus','fleet_record','driving','decision','new_gps_stop'));

notify pgrst, 'reload schema';
