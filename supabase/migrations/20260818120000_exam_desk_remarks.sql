-- Report-card remarks with provenance.
--
-- 1. exam_desk_marks.remark_source — was the per-subject remark typed by a
--    teacher ("manual"), an accepted AI draft ("ai"), or an AI draft the
--    teacher edited ("ai_edited")? Existing rows are "manual": every remark
--    saved before this migration was human-typed.
-- 2. exam_desk_remarks — the class teacher's overall remark per student per
--    mark sheet (the "Remarks" line at the foot of the report card), with an
--    optional Hindi rendering and the same provenance fields. Same shape as
--    exam_desk_coscholastic: one row per student per exam_desk_sheets row.

alter table public.exam_desk_marks
  add column if not exists remark_source text not null default 'manual';

create table if not exists public.exam_desk_remarks (
  id text primary key,
  mark_sheet_id text not null references public.exam_desk_sheets(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id text not null,
  text text not null default '',
  text_hi text not null default '',
  source text not null default 'manual',
  generated_at timestamptz,
  model text not null default '',
  updated_at timestamptz not null default now(),
  unique (mark_sheet_id, student_id)
);

create index if not exists exam_desk_remarks_student_idx
  on public.exam_desk_remarks (tenant_id, student_id);

comment on table public.exam_desk_remarks is
  'Class teacher''s overall report-card remark per student per exam_desk_sheets row, with AI/human provenance and optional Hindi rendering.';
comment on column public.exam_desk_marks.remark_source is
  'manual | ai | ai_edited — provenance of the per-subject remark';

grant all on public.exam_desk_remarks to service_role;

notify pgrst, 'reload schema';
