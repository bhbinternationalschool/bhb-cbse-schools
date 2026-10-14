-- Stop order per run, from the buses' GPS (director, 14 Oct 2026: make the
-- serial of stops for pick-up and drop by shift automatically; suggest early
-- drop for children picked up early).
--
-- One row per route × direction × run. The nightly job rewrites the observed
-- order and times; `chosen` is the office's decision for a drop run —
-- 'gps' (the order the bus drives today) or 'fair' (first picked, first
-- dropped) — and the job never touches it. The driver's manifest reads it.

create table if not exists public.transport_run_orders (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  route_id text not null,
  shift_id text not null default '',
  direction text not null check (direction in ('pickup','drop')),
  /** [{stopId, minute, rideMinutes, days}] in the order the bus reaches them. */
  stops jsonb not null default '[]'::jsonb,
  unseen_stop_ids jsonb not null default '[]'::jsonb,
  legs integer not null default 0,
  return_minutes integer,
  returns_share numeric not null default 0,
  chosen text not null default 'gps' check (chosen in ('gps','fair')),
  chosen_by text not null default '',
  chosen_at timestamptz,
  computed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.transport_run_orders is
  'Per-run stop order observed from Fleet Edge GPS; chosen = office decision for drop order (gps | fair). Server-written only.';

create index if not exists transport_run_orders_route_idx on public.transport_run_orders (tenant_id, route_id);

alter table public.transport_run_orders enable row level security;
drop policy if exists transport_run_orders_tenant_read on public.transport_run_orders;
create policy transport_run_orders_tenant_read on public.transport_run_orders
  for select to authenticated using (public.is_tenant_member(tenant_id));
grant select on public.transport_run_orders to authenticated;
grant select, insert, update, delete on public.transport_run_orders to service_role;

notify pgrst, 'reload schema';
