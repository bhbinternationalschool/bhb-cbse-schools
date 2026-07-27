-- Transport fleet §6c + boarding + GPS (extends 20260711180000_transport_dues)

alter table if exists public.transport_routes
  add column if not exists vehicle_id uuid;

alter table if exists public.transport_stops
  add column if not exists distance_km numeric not null default 0;

create table if not exists public.transport_vehicles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  registration_no text not null,
  name text not null default '',
  vehicle_type text not null default 'bus',
  fuel_type text not null default 'diesel',
  fuel_unit text not null default 'liter',
  tank_capacity numeric not null default 0,
  odometer_km numeric not null default 0,
  avg_mileage numeric not null default 0,
  primary_route_id uuid references public.transport_routes(id),
  status text not null default 'active',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, registration_no)
);

create table if not exists public.transport_dealers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  dealer_type text not null,
  phone text not null default '',
  gstin text not null default '',
  payment_terms_days integer not null default 15,
  is_active boolean not null default true
);

create table if not exists public.transport_fuel_stock_locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  fuel_type text not null,
  qty_on_hand numeric not null default 0,
  min_alert numeric not null default 0,
  max_capacity numeric not null default 0
);

create table if not exists public.transport_fuel_refills (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  vehicle_id uuid not null references public.transport_vehicles(id),
  filled_at timestamptz not null,
  odometer_km numeric not null,
  qty numeric not null,
  amount_paise bigint not null default 0,
  source text not null,
  dealer_id uuid,
  payment_status text not null default 'on_account',
  created_at timestamptz not null default now()
);

create table if not exists public.transport_payables (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  dealer_id uuid,
  vehicle_id uuid,
  source_type text not null,
  source_id text not null,
  amount_paise bigint not null,
  due_on date not null,
  status text not null default 'open',
  paid_paise bigint not null default 0,
  paid_on date,
  created_at timestamptz not null default now()
);

create table if not exists public.transport_boarding_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_date date not null,
  route_id uuid not null references public.transport_routes(id),
  trip text not null,
  student_id uuid references public.students(id),
  status text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.transport_gps_pings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  vehicle_id uuid not null references public.transport_vehicles(id),
  lat double precision not null,
  lng double precision not null,
  recorded_at timestamptz not null default now(),
  source text not null default 'manual',
  note text not null default ''
);

create index if not exists transport_boarding_date_idx
  on public.transport_boarding_events (tenant_id, event_date, route_id);
create index if not exists transport_gps_vehicle_idx
  on public.transport_gps_pings (tenant_id, vehicle_id, recorded_at desc);
