-- Bus register + driver's log book (Transport → Bus register, 11 Oct 2026).
--
-- The old SStudy ERP had a month-wise transport attendance report and a
-- driver's log book. Both live here as SERVER rows — not in the transport
-- desk's jsonb slices, which a browser push can overwrite.
--
-- transport_boarding_marks — one row per child per route per trip per day.
--   The attendant taps each child on a phone, often on a weak signal, and the
--   phone retries. So a tap is an UPSERT on the natural key, and an older tap
--   that arrives late (a retry queued behind a newer one) never overwrites the
--   newer one: tapped_at decides, through transport_boarding_mark_upsert().
--   'unmarked' is an undo — kept as a row so the newer-tap-wins order still
--   holds — and every reader treats it as "no mark", never as absent.
--
-- transport_vehicle_day_logs — the log book: one row per vehicle per day.
--   start_km / end_km say where each figure came from ('gps' = the Fleet Edge
--   odometer, 'typed' = a person). NULL = not recorded, never 0.
--   row_version is the save stamp: a save must name the version it was
--   loaded at, so two phones cannot silently overwrite each other.
--
-- transport_fuel_fills — fuel put in, with an optional receipt photo in the
--   private school-files bucket (served as /api/file/<path>). The id is made
--   by the phone, so a retried save cannot record the same fill twice.
--   A wrong entry is voided, never deleted.

create table if not exists public.transport_boarding_marks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_date date not null,
  route_id text not null,
  trip text not null check (trip in ('AM', 'PM')),
  shift_id text not null default '',
  vehicle_id text not null default '',
  student_id text not null,
  stop_id text not null default '',
  status text not null check (status in ('boarded', 'not_boarded', 'dropped', 'unmarked')),
  tapped_at timestamptz not null,
  client_ref text not null default '',
  marked_by_staff_id text not null default '',
  marked_by_name text not null default '',
  lat double precision,
  lng double precision,
  accuracy_m double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transport_boarding_marks_slot_key unique (tenant_id, run_date, route_id, trip, student_id)
);
create index if not exists transport_boarding_marks_day_idx
  on public.transport_boarding_marks (tenant_id, run_date);
create index if not exists transport_boarding_marks_student_idx
  on public.transport_boarding_marks (tenant_id, student_id, run_date);

create table if not exists public.transport_vehicle_day_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  vehicle_id text not null,
  log_date date not null,
  start_km numeric(10, 1) check (start_km is null or start_km >= 0),
  start_km_source text not null default '' check (start_km_source in ('', 'gps', 'typed')),
  end_km numeric(10, 1) check (end_km is null or end_km >= 0),
  end_km_source text not null default '' check (end_km_source in ('', 'gps', 'typed')),
  driver_name text not null default '',
  remarks text not null default '',
  row_version integer not null default 1,
  updated_by_staff_id text not null default '',
  updated_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transport_vehicle_day_logs_day_key unique (tenant_id, vehicle_id, log_date)
);
create index if not exists transport_vehicle_day_logs_date_idx
  on public.transport_vehicle_day_logs (tenant_id, log_date);

create table if not exists public.transport_fuel_fills (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  vehicle_id text not null,
  fill_date date not null,
  quantity numeric(10, 2) not null check (quantity > 0),
  unit text not null check (unit in ('litre', 'kg')),
  amount_paise bigint not null check (amount_paise >= 0),
  odometer_km numeric(10, 1) check (odometer_km is null or odometer_km >= 0),
  receipt_path text not null default '',
  note text not null default '',
  created_by_staff_id text not null default '',
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by_name text not null default '',
  void_reason text not null default ''
);
create index if not exists transport_fuel_fills_vehicle_idx
  on public.transport_fuel_fills (tenant_id, vehicle_id, fill_date);
create index if not exists transport_fuel_fills_date_idx
  on public.transport_fuel_fills (tenant_id, fill_date);

alter table public.transport_boarding_marks enable row level security;
alter table public.transport_vehicle_day_logs enable row level security;
alter table public.transport_fuel_fills enable row level security;
grant select, insert, update, delete on public.transport_boarding_marks to service_role;
grant select, insert, update, delete on public.transport_vehicle_day_logs to service_role;
grant select, insert, update, delete on public.transport_fuel_fills to service_role;

-- One tap. Inserts the mark, or replaces the stored one only when this tap is
-- at least as new. Returns {applied, row}: applied=false means a newer tap was
-- already stored, and row is that newer mark (the phone shows it).
create or replace function public.transport_boarding_mark_upsert(p_tenant_id uuid, p jsonb)
returns jsonb
language plpgsql
as $$
declare
  r public.transport_boarding_marks;
begin
  insert into public.transport_boarding_marks as t (
    tenant_id, run_date, route_id, trip, shift_id, vehicle_id, student_id, stop_id,
    status, tapped_at, client_ref, marked_by_staff_id, marked_by_name, lat, lng, accuracy_m
  ) values (
    p_tenant_id,
    (p->>'run_date')::date,
    p->>'route_id',
    p->>'trip',
    coalesce(p->>'shift_id', ''),
    coalesce(p->>'vehicle_id', ''),
    p->>'student_id',
    coalesce(p->>'stop_id', ''),
    p->>'status',
    (p->>'tapped_at')::timestamptz,
    coalesce(p->>'client_ref', ''),
    coalesce(p->>'marked_by_staff_id', ''),
    coalesce(p->>'marked_by_name', ''),
    nullif(p->>'lat', '')::double precision,
    nullif(p->>'lng', '')::double precision,
    nullif(p->>'accuracy_m', '')::double precision
  )
  on conflict (tenant_id, run_date, route_id, trip, student_id) do update set
    shift_id = excluded.shift_id,
    vehicle_id = excluded.vehicle_id,
    stop_id = excluded.stop_id,
    status = excluded.status,
    tapped_at = excluded.tapped_at,
    client_ref = excluded.client_ref,
    marked_by_staff_id = excluded.marked_by_staff_id,
    marked_by_name = excluded.marked_by_name,
    lat = excluded.lat,
    lng = excluded.lng,
    accuracy_m = excluded.accuracy_m,
    updated_at = now()
  where t.tapped_at <= excluded.tapped_at
  returning * into r;

  if r.id is not null then
    return jsonb_build_object('applied', true, 'row', to_jsonb(r));
  end if;

  select * into r from public.transport_boarding_marks
   where tenant_id = p_tenant_id
     and run_date = (p->>'run_date')::date
     and route_id = p->>'route_id'
     and trip = p->>'trip'
     and student_id = p->>'student_id';
  return jsonb_build_object('applied', false, 'row', to_jsonb(r));
end;
$$;

revoke all on function public.transport_boarding_mark_upsert(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.transport_boarding_mark_upsert(uuid, jsonb) to service_role;

notify pgrst, 'reload schema';
