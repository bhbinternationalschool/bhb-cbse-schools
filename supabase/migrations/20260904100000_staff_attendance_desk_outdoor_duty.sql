-- Outdoor duty sessions — the third slice of the staff attendance desk,
-- alongside registers/marks and settings.
--
-- Until now these lived only in each browser's localStorage: the mark the
-- session produces reached the server, the session itself never did. So the
-- purpose, destination, GPS start/end points and timings — the evidence the
-- feature exists to capture — differed per machine and died with a cache
-- clear.
--
-- No FK on staff_id to sis_staff, deliberately: these desk tables are
-- written by a push/pull sync, and a hard constraint would break pushes
-- from a client whose roster is stale. The equivalent guarantee is enforced
-- at the push boundary, which drops any session whose staff_id has no
-- sis_staff row (see staffAttendanceOutdoorDuty.server.ts).

create table if not exists public.staff_attendance_desk_outdoor_duty (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  staff_id text not null,
  purpose text not null default 'other'
    check (purpose in ('bank', 'inspection', 'vendor_meeting',
                       'admission_survey', 'official_errand', 'other')),
  destination text not null default '',
  note text not null default '',
  started_at timestamptz not null,
  ended_at timestamptz,
  status text not null default 'active' check (status in ('active', 'ended')),
  start_geo jsonb,
  end_geo jsonb,
  created_by text not null default '',
  updated_at timestamptz not null default now(),
  -- An ended session has an end time; an active one does not.
  constraint staff_attendance_desk_outdoor_duty_end_consistent
    check ((status = 'ended') = (ended_at is not null))
);

create index if not exists staff_attendance_desk_outdoor_duty_staff_idx
  on public.staff_attendance_desk_outdoor_duty (tenant_id, staff_id, started_at desc);

-- Staff → Outdoor duty opens on "who is out right now".
--
-- Deliberately NOT unique on (tenant_id, staff_id). "One active session per
-- staff member" is a client-side rule and startOutdoorDuty already enforces
-- it, but it enforces it against LOCAL state: two browsers can each open a
-- session for the same person before either syncs. A unique index would turn
-- that benign duplicate into an upsert that fails forever, wedging the whole
-- desk push behind a row it can never write. The check constraint above is
-- different in kind — it is about one row's internal consistency, which the
-- mapper can always satisfy.
create index if not exists staff_attendance_desk_outdoor_duty_active_idx
  on public.staff_attendance_desk_outdoor_duty (tenant_id, staff_id)
  where status = 'active';

alter table public.staff_attendance_desk_sync_meta
  add column if not exists outdoor_duty_count int not null default 0;

alter table public.staff_attendance_desk_sync_meta
  add column if not exists outdoor_duty_updated_at timestamptz;

comment on table public.staff_attendance_desk_outdoor_duty is
  'Staff outdoor duty sessions — system of record; upsert-only, never pruned by sync';
