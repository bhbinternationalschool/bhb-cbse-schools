-- Transport audit with action buttons (director, 14 Oct 2026).
--
-- The nightly/weekly audit writes suggestions into transport_desk_gaps with
-- an `action` the office can carry out in one tap: move a child to a bus
-- that really passes their home (fee unchanged), or drive a run in a shorter
-- order. Road alerts are runs that suddenly stopped reaching a stop or take
-- much longer — a closure or diversion seen in the buses' own GPS. The
-- `action_*` columns record who pressed the button and what happened.
--
-- transport_run_orders.chosen gains 'custom': a stop order the office took
-- from an audit suggestion, kept in custom_order.

alter table public.transport_desk_gaps
  add column if not exists action jsonb,
  add column if not exists action_done_at timestamptz,
  add column if not exists action_by text not null default '',
  add column if not exists action_result text not null default '';

alter table public.transport_desk_gaps drop constraint if exists transport_desk_gaps_kind_check;
alter table public.transport_desk_gaps add constraint transport_desk_gaps_kind_check
  check (kind in ('fee_distance','stop_not_reached','rider_stop','rider_bus','fleet_record','driving','decision','new_gps_stop','suggestion','road_alert'));

alter table public.transport_run_orders
  add column if not exists custom_order jsonb,
  add column if not exists starts_share numeric not null default 0;
alter table public.transport_run_orders drop constraint if exists transport_run_orders_chosen_check;
alter table public.transport_run_orders add constraint transport_run_orders_chosen_check
  check (chosen in ('gps','fair','custom'));

notify pgrst, 'reload schema';
