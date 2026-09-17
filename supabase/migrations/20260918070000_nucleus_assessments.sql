-- Which exam papers LEAD has prepared, and which are still missing.
--
-- WHY: the office needs the "Not Created" list BEFORE an exam week. A paper
-- missing a fortnight out is a decision — write our own, or ask LEAD; the same
-- line found on the morning of the exam is a crisis.
--
-- Rides on nucleus_progress_snapshots so both readings share one notion of
-- "when this was read" and one staleness rule. `kind` says which table a
-- snapshot holds; timeliness is the default because every snapshot written
-- before this migration is one.

alter table public.nucleus_progress_snapshots
  add column if not exists kind text not null default 'timeliness'
  check (kind in ('timeliness', 'assessments'));

create table if not exists public.nucleus_assessment_rows (
  tenant_id uuid not null,
  snapshot_id uuid not null,
  position smallint not null check (position > 0),
  class_label text not null,
  division text not null default '',
  subject text not null,
  title text not null,
  -- "2 Chapters" as printed; empty when Nucleus shows a dash.
  chapters text not null default '',
  -- Nucleus's own wording ("Ready to Download", "Not Created"), kept verbatim
  -- so the screen never has to paraphrase the publisher.
  status_text text not null,
  status text not null check (status in ('ready', 'not_created', 'other')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, snapshot_id, position),
  foreign key (tenant_id, snapshot_id)
    references public.nucleus_progress_snapshots (tenant_id, id) on delete cascade
);

create index if not exists nucleus_assessment_rows_missing_idx
  on public.nucleus_assessment_rows (tenant_id, snapshot_id, status);

alter table public.nucleus_assessment_rows enable row level security;

grant all on public.nucleus_assessment_rows to service_role;
