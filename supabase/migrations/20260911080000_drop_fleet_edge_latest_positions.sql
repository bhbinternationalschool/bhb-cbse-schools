-- Withdraw fleet_edge_latest_positions — it duplicated something already live.
--
-- Added earlier on 11 Sep 2026 to put moving buses on the Transport map,
-- because the map drew only the desk's manual gpsPings slice and showed one
-- stationary browser pin while five buses ran the morning route.
--
-- That was already solved. Branch feat/transport-live-tracking (62b6fb7, the
-- evening before) had built fleet_vehicle_positions with its own
-- fleet_latest_positions RPC, a staff endpoint, a parent endpoint scoped to a
-- family's own children, and a bus map in the parent app — and it was already
-- deployed, which is why fleet_vehicle_positions was filling up while this
-- function was being written. Two normalised position sources over the same
-- telemetry is one too many, and the older one has the parent app behind it.
--
-- Dropped rather than left in place: an unused function and its partial index
-- on a table that grows by thousands of rows a day is a maintenance cost and
-- an invitation for a future reader to build on the wrong one.
--
-- fleet_edge_vehicle_status stays. It counts per-stream events for the Live
-- tab's status strip and is not a position source.

drop function if exists public.fleet_edge_latest_positions(uuid);
drop index if exists public.fleet_edge_events_position_idx;

notify pgrst, 'reload schema';
