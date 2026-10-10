-- Online classes: a live class a teacher runs over a video link, scheduled
-- against a section, and the record of which children actually joined.
--
-- Rows, not a state blob. A session is created by one person, started by
-- another device, joined by thirty households and closed by a cron tick;
-- a whole-module JSON blob rewritten on each of those is a lost-update
-- problem by design (see the 2026-08-21 transport wipe).
--
-- The video itself is not hosted here. `provider` says where the room
-- lives: 'google_meet' when the ERP created a Meet space on the teacher's
-- own Workspace account, 'link' when somebody pasted a URL (a Meet code
-- made on a phone, Zoom, a YouTube live). The ERP stores, schedules,
-- announces and records; the call runs where the school already has one.

create table if not exists public.online_class_sessions (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  academic_year_code text not null default '',
  class_id text not null,
  section_id text not null,
  subject_id text not null default '',
  -- Staff roster id of the host. The office may schedule on a teacher's
  -- behalf, so created_by is kept separately.
  teacher_id text not null default '',
  title text not null default '',
  -- Local (IST) calendar date and wall-clock times. A school runs on its
  -- bell, not on UTC; storing the bell's own words keeps "Period 3 on
  -- Monday" reproducible without timezone arithmetic at read time.
  date text not null,
  start_time text not null,
  end_time text not null,
  -- Bell period the class stands in for, when it came from the timetable.
  period_no int,
  provider text not null default 'link'
    check (provider in ('google_meet', 'link')),
  join_url text not null default '',
  meeting_code text not null default '',
  -- Google Meet space resource name (spaces/xxx) — needed to pull the
  -- participant list after the class. Empty for pasted links.
  meet_space_name text not null default '',
  status text not null default 'scheduled'
    check (status in ('scheduled', 'live', 'ended', 'cancelled')),
  note text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  cancelled_at timestamptz,
  -- When the section's households were told the class exists, and when
  -- the "starting soon" nudge went. Each goes out at most once.
  announced_at timestamptz,
  reminded_at timestamptz,
  attendance_synced_at timestamptz
);

-- A parent's view: the child's section, next few days, newest date first.
create index if not exists online_class_sessions_section_date_idx
  on public.online_class_sessions (tenant_id, section_id, date desc);
-- A teacher's view and the cron tick: by date across the school.
create index if not exists online_class_sessions_date_idx
  on public.online_class_sessions (tenant_id, date desc, start_time);
create index if not exists online_class_sessions_teacher_idx
  on public.online_class_sessions (tenant_id, teacher_id, date desc);

-- Who joined. One row per child per session, updated on every tap of
-- "Join" so the first tap and the last are both known. `source` says
-- whether the ERP saw the tap itself or learned of the presence from the
-- Meet participant list afterwards.
create table if not exists public.online_class_joins (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id text not null references public.online_class_sessions(id) on delete cascade,
  student_id text not null,
  household_id text not null default '',
  source text not null default 'app'
    check (source in ('app', 'web', 'meet_sync')),
  display_name text not null default '',
  first_joined_at timestamptz not null default now(),
  last_joined_at timestamptz not null default now(),
  -- Minutes in the call, when the provider can tell us (Meet sync). 0 = unknown.
  minutes int not null default 0,
  unique (session_id, student_id)
);

create index if not exists online_class_joins_session_idx
  on public.online_class_joins (tenant_id, session_id);
create index if not exists online_class_joins_student_idx
  on public.online_class_joins (tenant_id, student_id);

-- Per-staff Google grant (Classroom read + Meet create/read). The Classroom
-- integration kept this in .data/google_classroom.json, which Cloud Run's
-- filesystem forgets on every deploy — so every teacher's connection died
-- with each release. Same shape as google_drive_connection, keyed by the
-- staff roster id (or login email for staff without a roster row).
create table if not exists public.google_staff_connections (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  staff_key text not null,
  email text not null default '',
  access_token text not null default '',
  refresh_token text not null default '',
  expires_at timestamptz not null default now(),
  -- Space-separated scopes Google actually granted, so a Classroom-only
  -- grant from before Meet existed is recognised as "reconnect needed".
  scopes text not null default '',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, staff_key)
);

-- Every new table needs an explicit service_role grant, or the server's
-- writes fail 42501 and the request "succeeds" while storing nothing.
grant all on public.online_class_sessions to service_role;
grant all on public.online_class_joins to service_role;
grant all on public.google_staff_connections to service_role;

notify pgrst, 'reload schema';
