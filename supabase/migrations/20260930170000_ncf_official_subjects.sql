-- The subjects NCERT and CBSE list for each class, as DIKSHA publishes them,
-- the changes a weekly sync finds, and the school's own match of each one.
--
-- WHY
--   Masters' NCF suggestions were typed into the code once and never moved.
--   DIKSHA (NCERT's platform) publishes, per board, the subjects it tags each
--   class with — machine-readable, keyless — so a weekly sync can notice when
--   NCERT adds or renames a subject and put it in front of the office.
--
-- WHAT IS STORED
--   ncf_official_subjects  every (board, grade, subject) ever seen, with when
--                          it was first and last seen; removed_at set when
--                          DIKSHA stops listing it (never deleted).
--   ncf_official_changes   what a sync found new or gone, for the office to
--                          act on or dismiss. The first sync of a board is a
--                          baseline and records no changes.
--   ncf_subject_mappings   the school's match of an official subject to one
--                          of its own subjects, by id — so renaming the
--                          school subject keeps the match.
--
-- Conventions: tenant_id on every table, RLS on with no policy (server-only,
-- service role), explicit service_role grant on every object.

create table if not exists public.ncf_official_subjects (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  board text not null check (board in ('NCERT', 'CBSE')),
  -- DIKSHA's grade name: 'Preschool 1'..'Preschool 3', 'Class 1'..'Class 12'
  grade text not null,
  subject text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  removed_at timestamptz,
  primary key (tenant_id, board, grade, subject)
);

create table if not exists public.ncf_official_changes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  board text not null check (board in ('NCERT', 'CBSE')),
  grade text not null,
  subject text not null,
  kind text not null check (kind in ('added', 'removed')),
  detected_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'done', 'dismissed')),
  decided_at timestamptz,
  decided_by text
);

create index if not exists ncf_official_changes_pending_idx
  on public.ncf_official_changes (tenant_id, status, detected_at desc);

create table if not exists public.ncf_subject_mappings (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- lower-cased official subject name; one match per name, whichever board
  subject_key text not null,
  school_subject_id text not null,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (tenant_id, subject_key)
);

alter table public.ncf_official_subjects enable row level security;
alter table public.ncf_official_changes enable row level security;
alter table public.ncf_subject_mappings enable row level security;

-- Every new table needs an explicit service_role grant, or the server's
-- writes fail with 42501 and look like an empty table on read.
grant all on public.ncf_official_subjects to service_role;
grant all on public.ncf_official_changes to service_role;
grant all on public.ncf_subject_mappings to service_role;

notify pgrst, 'reload schema';
