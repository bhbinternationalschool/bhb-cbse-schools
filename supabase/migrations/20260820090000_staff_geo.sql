-- Staff GPS presence: last ping per staff (upsert — no movement trail) and
-- geofence incidents. Settings/consents live in module_local_state
-- ("staff_geo_settings"); pings must be a table because 30+ staff write
-- every few minutes and module_local_state is one row per tenant.

create table if not exists public.staff_geo_last (
  tenant_id uuid not null,
  staff_id text not null,
  at timestamptz not null,
  lat double precision not null,
  lng double precision not null,
  accuracy_m integer not null default 0,
  inside boolean not null default true,
  distance_m integer not null default 0,
  -- First ping of the current continuous outside stretch ("" = inside)
  outside_since timestamptz,
  device text not null default '',
  updated_at timestamptz not null default now(),
  primary key (tenant_id, staff_id)
);

create table if not exists public.staff_geo_incidents (
  id text primary key,
  tenant_id uuid not null,
  staff_id text not null,
  emp_code text not null default '',
  full_name text not null default '',
  date date not null,
  at timestamptz not null,
  kind text not null check (kind in ('left_premises','location_off','returned','back_online')),
  distance_m integer,
  detail text not null default '',
  alerted boolean not null default false,
  alert_detail text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists staff_geo_incidents_tenant_date_idx
  on public.staff_geo_incidents (tenant_id, date desc, at desc);
create index if not exists staff_geo_incidents_staff_idx
  on public.staff_geo_incidents (tenant_id, staff_id, date desc);

alter table public.staff_geo_last enable row level security;
alter table public.staff_geo_incidents enable row level security;

-- Same posture as the other ERP tables: service-role only (the app's server
-- routes are the gate); no anon/authenticated policies.
grant all on public.staff_geo_last to service_role;
grant all on public.staff_geo_incidents to service_role;

notify pgrst, 'reload schema';
