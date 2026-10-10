-- Absence is per subject, not per exam.
--
-- The first cut (20260915130000) recorded one row per absent student per
-- exam, as if a child who missed the Hindi paper had missed everything.
-- Now one row per (student, subject): the marks grid takes AB in a single
-- cell, and "absent in all subjects" is simply every subject listed. The
-- table held no rows in production when this ran.

alter table public.exam_desk_absences
  add column if not exists subject_id text not null default '';

alter table public.exam_desk_absences
  drop constraint if exists exam_desk_absences_mark_sheet_id_student_id_key;

create unique index if not exists exam_desk_absences_sheet_student_subject_key
  on public.exam_desk_absences (mark_sheet_id, student_id, subject_id);

comment on table public.exam_desk_absences is
  'Students absent from one subject''s paper in an exam (one row per student x subject per exam_desk_sheets row) with an optional reason; the report card prints AB.';
