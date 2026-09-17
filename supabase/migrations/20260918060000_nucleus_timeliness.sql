-- Syllabus progress as LEAD's Nucleus portal reports it.
--
-- WHY (director, 18 Sep 2026): Nucleus (nucleus.leadgroup.co.in) is where the
-- publisher records how far each teacher has taken the Propel day plans. It
-- shows required progress against what the teacher has marked done — the
-- school's own operational numbers, but locked inside someone else's portal,
-- looked at once in a while and forgotten. Kept here, the ERP can chart them,
-- compare them with our own lesson plans and period logs, and show the
-- principal who is behind.
--
-- LEAD has no API (confirmed with them, 18 Sep 2026) and their login is behind
-- reCAPTCHA, so nothing here logs in by itself. A snapshot arrives EITHER as a
-- table the principal copies out of Nucleus and pastes in, OR — once the
-- session token's shape is known — by the ERP reading their JSON with a token
-- the principal pastes each week. Both land in the same rows.
--
-- Every row records `captured_on` and `source`: these are a reading of another
-- system on a date, not a fact about today. A stale snapshot must be visible
-- as stale rather than passed off as current ([[erp-unknown-must-not-become-fact]]).

create table if not exists public.nucleus_progress_snapshots (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  -- The date the numbers were READ from Nucleus, not the date they were typed.
  captured_on date not null,
  -- 'paste' — principal copied the table; 'token' — ERP read their JSON.
  source text not null check (source in ('paste', 'token')),
  academic_year_code text not null,
  -- Who pasted/triggered it, for the "who to ask" question later.
  captured_by text not null default '',
  row_count integer not null default 0,
  note text not null default '',
  created_at timestamptz not null default now(),
  primary key (tenant_id, id)
);

create index if not exists nucleus_progress_snapshots_recent_idx
  on public.nucleus_progress_snapshots (tenant_id, captured_on desc);

create table if not exists public.nucleus_progress_rows (
  tenant_id uuid not null,
  snapshot_id uuid not null,
  -- Nucleus's own row order, so a re-read can be diffed line by line.
  position smallint not null check (position > 0),
  -- As Nucleus spells them: "Kiran patel", "Class1-Propel Hindi". Their teacher
  -- names are typed by the publisher's onboarding, not by us, so they are NOT
  -- assumed to match staff ids; matching is a later, separate decision.
  teacher_name text not null,
  class_label text not null,
  subject_label text not null,
  -- Day plans: the course is a fixed number of them (140 in 2026-27).
  total_plans smallint not null check (total_plans > 0),
  required_plans smallint not null check (required_plans >= 0),
  current_plans smallint not null check (current_plans >= 0),
  -- Positive = ahead of schedule, negative = behind. Derived, but stored so a
  -- later change to the arithmetic cannot silently rewrite old readings.
  gap_plans smallint not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, snapshot_id, position),
  foreign key (tenant_id, snapshot_id)
    references public.nucleus_progress_snapshots (tenant_id, id) on delete cascade
);

create index if not exists nucleus_progress_rows_behind_idx
  on public.nucleus_progress_rows (tenant_id, snapshot_id, gap_plans);

alter table public.nucleus_progress_snapshots enable row level security;
alter table public.nucleus_progress_rows enable row level security;

-- New tables get no grants by default and every write fails 42501 in silence
-- ([[erp-supabase-new-table-grant]]).
grant all on public.nucleus_progress_snapshots to service_role;
grant all on public.nucleus_progress_rows to service_role;
