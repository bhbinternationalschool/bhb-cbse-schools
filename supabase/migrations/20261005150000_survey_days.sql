-- Field survey days, proven like the staff punch (director, 5 Oct 2026).
--
-- A surveyor's day (start / breaks / end) and every family they capture are
-- written by the SERVER, each step signed by the surveyor's registered phone
-- key (staff_punch_devices) and stamped with the phone's live GPS. Until now
-- the day lived only in the browser's copy of the admissions blob, with GPS
-- optional and nothing checked.
--
-- member_key = the staff id for school staff, 'ext:<externalId>' for an
-- outside surveyor (whose phone is registered in staff_punch_devices under
-- the same key, by an office pairing code).

create table if not exists public.survey_days (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  member_key text not null,
  member_name text not null default '',
  staff_id text not null default '',
  day date not null,
  -- 'school': started with the gate QR code inside the campus.
  -- 'field' : started anywhere with live GPS.
  start_mode text not null check (start_mode in ('school', 'field')),
  beat_id text not null default '',
  status text not null check (status in ('active', 'on_break', 'ended')),
  started_at timestamptz not null,
  start_geo jsonb not null,
  ended_at timestamptz,
  end_geo jsonb,
  -- [{ startAt, startGeo, endAt, endGeo }]
  breaks jsonb not null default '[]'::jsonb,
  device_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, member_key, day)
);

create index if not exists survey_days_day_idx on public.survey_days (tenant_id, day);

create table if not exists public.survey_captures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  survey_day_id uuid not null references public.survey_days(id) on delete cascade,
  member_key text not null,
  lead_id text not null,
  enquiry_no text not null default '',
  child_name text not null default '',
  geo jsonb not null,
  captured_at timestamptz not null default now(),
  unique (tenant_id, lead_id)
);

create index if not exists survey_captures_day_idx on public.survey_captures (tenant_id, survey_day_id);

-- One-time codes the office gives an outside surveyor to register their phone.
create table if not exists public.survey_phone_pairings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  member_key text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  used_at timestamptz
);

create index if not exists survey_phone_pairings_open_idx
  on public.survey_phone_pairings (tenant_id, created_at desc) where used_at is null;

comment on table public.survey_days is
  'Field survey day per surveyor per date: start/breaks/end, each signed by the registered phone and stamped with live GPS. Written only by the server.';
comment on table public.survey_captures is
  'Families captured during a survey day, with the live GPS fix of the capture.';
comment on table public.survey_phone_pairings is
  'One-time 6-digit codes (hashed) that register an outside surveyor''s phone.';

-- Server-only tables: no browser reads them directly.
alter table public.survey_days enable row level security;
alter table public.survey_captures enable row level security;
alter table public.survey_phone_pairings enable row level security;
revoke all on public.survey_days from anon, authenticated;
revoke all on public.survey_captures from anon, authenticated;
revoke all on public.survey_phone_pairings from anon, authenticated;

-- Every new table needs an explicit service_role grant, or the server's
-- writes fail 42501 while the request "succeeds".
grant all on public.survey_days to service_role;
grant all on public.survey_captures to service_role;
grant all on public.survey_phone_pairings to service_role;

notify pgrst, 'reload schema';
