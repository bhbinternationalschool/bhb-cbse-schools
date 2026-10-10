-- Let the DIKSHA chapter index hold Nursery, LKG and UKG.
--
-- NCERT has no pre-primary textbooks. It publishes nine competency books —
-- one per NCF foundational-stage developmental goal (Health and Well-being,
-- Effective Communicators, Involved Learners) for each of DIKSHA's Preschool
-- 1–3 — whose units are learning outcomes, each with worksheets, videos and
-- infographics. lib/dikshaIndex.ts indexes them like any other book, with
-- the outcomes as its "chapters".
--
-- The school teaches pre-primary from its own publisher books; the director
-- set these NCERT outcomes as the MINIMUM a child should reach (2026-09-16),
-- not the syllabus. The tutor and lesson plans say so.
--
-- Grades use the scale lib/tutorVideoSources.ts already uses: one below
-- Class 1 per year — Nursery (Preschool 1) -2, LKG (Preschool 2) -1,
-- UKG (Preschool 3) 0. The constraint was 1–12.

alter table public.diksha_textbooks drop constraint if exists diksha_textbooks_grade_check;
alter table public.diksha_textbooks
  add constraint diksha_textbooks_grade_check check (grade between -2 and 12);

comment on column public.diksha_textbooks.grade is
  'Class 1–12 as 1–12; Nursery, LKG, UKG (DIKSHA Preschool 1–3) as -2, -1, 0.';
