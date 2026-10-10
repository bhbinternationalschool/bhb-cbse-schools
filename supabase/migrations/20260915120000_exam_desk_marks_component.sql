-- Exam marks gain a component: "" for the whole subject (every row saved
-- before today), else a scheme component code ("TE" term exam, "PT"
-- periodic test, "PR" practical …). One row per (student, subject, part).
--
-- Why: CBSE assesses VI–X as 80 + 20 and XI–XII as theory + practical with
-- each passed separately; the unique key on (sheet, student, subject) could
-- store only one number per subject, so those schemes could not exist. The
-- assessment schemes themselves live in exam_desk_policy.policy_json
-- (schemes[]) — chosen per class band by the school, see
-- apps/web/src/lib/examSchemes.ts.
--
-- Existing rows keep their ids (sheet:student:subject); component rows use
-- a fourth part (sheet:student:subject:CODE), so nothing is renumbered.

alter table public.exam_desk_marks
  add column if not exists component text not null default '';

alter table public.exam_desk_marks
  drop constraint if exists exam_desk_marks_mark_sheet_id_student_id_subject_id_key;

create unique index if not exists exam_desk_marks_sheet_student_subject_component_key
  on public.exam_desk_marks (mark_sheet_id, student_id, subject_id, component);

comment on column public.exam_desk_marks.component is
  'Part of the subject this row scores: empty = whole subject; else a scheme component code (TE, PT, NB, SE, TH, PR …).';
