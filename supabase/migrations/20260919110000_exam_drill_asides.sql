-- How many of their own questions a child has asked inside one drill.
--
-- WHY (director, 19 Sep 2026): "when tutor asked question and if student is
-- asking any other question from class subject syllabus then should be get
-- right answer of their questions". The drill now answers those, from the
-- child's own textbook, and puts its question back afterwards.
--
-- Counted because it is not free: each aside is a model call, and a night
-- that drifts into a free chat costs the school money and the child their
-- revision. Past MAX_ASIDES the question is answered by their teacher in
-- the morning instead.
alter table public.exam_drill_sessions
  add column if not exists asides smallint not null default 0;
