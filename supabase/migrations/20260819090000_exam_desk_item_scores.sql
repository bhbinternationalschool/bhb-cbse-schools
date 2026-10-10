-- Item-level exam scores (AI roadmap §1 prerequisite, 2026-08-19).
--
-- One row per student × question paper × set × question on a mark sheet:
-- the marks the student got on that item. Same shape/lifecycle as
-- exam_desk_coscholastic / exam_desk_remarks (child of exam_desk_sheets,
-- rewritten with the sheet, cascade on delete). Subject totals on
-- exam_desk_marks may be summed from these (saveSheetItemScores with
-- applyTotals) but are stored separately — a sheet without item scores is
-- still valid.

create table if not exists public.exam_desk_item_scores (
  id text primary key,
  mark_sheet_id text not null references public.exam_desk_sheets(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id text not null,
  subject_id text not null,
  paper_id text not null,
  set_code text not null default 'A',
  question_id text not null,
  marks_obtained numeric,
  updated_at timestamptz not null default now(),
  unique (mark_sheet_id, student_id, paper_id, set_code, question_id)
);

create index if not exists exam_desk_item_scores_sheet_idx
  on public.exam_desk_item_scores (tenant_id, mark_sheet_id);
create index if not exists exam_desk_item_scores_paper_idx
  on public.exam_desk_item_scores (tenant_id, paper_id, question_id);
create index if not exists exam_desk_item_scores_student_idx
  on public.exam_desk_item_scores (tenant_id, student_id);

comment on table public.exam_desk_item_scores is
  'Question-wise marks per student per question paper set, child of exam_desk_sheets; feeds LO/competency analytics and (optionally) subject totals.';

grant all on public.exam_desk_item_scores to service_role;

notify pgrst, 'reload schema';
