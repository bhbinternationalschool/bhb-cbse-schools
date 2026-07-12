-- Transport routes, stops, student assignments → Fee Take monthly dues

create table if not exists public.transport_routes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  bus_no text not null default '',
  vehicle_reg text not null default '',
  monthly_fee_paise bigint not null check (monthly_fee_paise >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create table if not exists public.transport_stops (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.transport_routes(id) on delete cascade,
  name text not null,
  sequence integer not null default 1
);

create table if not exists public.transport_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id uuid not null references public.students(id),
  household_id uuid references public.households(id),
  route_id uuid not null references public.transport_routes(id),
  stop_id uuid not null references public.transport_stops(id),
  academic_year_code text not null,
  effective_from date not null,
  effective_to date,
  monthly_fee_paise bigint not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists transport_assignments_student_idx
  on public.transport_assignments (tenant_id, student_id, academic_year_code);

comment on table public.transport_assignments is
  'Student bus route assignment; Fee Take due_key transport:student:assignment:YYYY-MM';
