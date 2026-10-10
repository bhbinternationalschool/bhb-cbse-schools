-- Fleet Edge escalation log — one row per outbound notification attempt
-- (SOS → WhatsApp today; other alert classes later). Two jobs:
--   1. The transport desk's "Notifications" tab reads it, so staff can see
--      who was told what, when, and whether it was delivered.
--   2. De-duplication: notifyFleetEdgeSos consults the latest row per
--      vehicle before sending. Production received 159 PanicSosEvent
--      alerts from two vehicles in two days (a held / repeatedly pressed
--      panic button); without a cooldown, enabling escalation would send
--      159 WhatsApp messages.

create table if not exists public.fleet_edge_notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_id uuid references public.fleet_edge_events(id) on delete set null,
  alert_name text not null,
  vehicle_ref text,
  registration_number text,
  channel text not null default 'whatsapp',
  recipient text not null,
  status text not null check (status in ('sent', 'failed', 'suppressed', 'skipped')),
  detail text,
  body text,
  created_at timestamptz not null default now()
);

alter table public.fleet_edge_notifications enable row level security;

create policy fleet_edge_notifications_tenant_all
  on public.fleet_edge_notifications
  for all
  using (is_tenant_member(tenant_id));

create index if not exists fleet_edge_notifications_tenant_created_idx
  on public.fleet_edge_notifications (tenant_id, created_at desc);

create index if not exists fleet_edge_notifications_tenant_vehicle_idx
  on public.fleet_edge_notifications (tenant_id, vehicle_ref, alert_name, created_at desc);

-- No default privilege for service_role in this project (see
-- 20260810030000_masters_desk_row_tables.sql) — grant explicitly.
grant select, insert, update, delete on public.fleet_edge_notifications to service_role;

-- Report queries scan by tenant + received_at; the existing indexes lead
-- with registration_number / event_type.
create index if not exists fleet_edge_events_tenant_received_idx
  on public.fleet_edge_events (tenant_id, received_at desc);

notify pgrst, 'reload schema';
