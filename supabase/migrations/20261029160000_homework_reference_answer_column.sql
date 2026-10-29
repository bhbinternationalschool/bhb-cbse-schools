-- Repo drift fix (29 Oct 2026): homework_desk_posts.reference_answer.
--
-- Production has had this column (text not null default '') since the
-- grading-assist work — added outside a migration. Every fresh database
-- built from supabase/migrations (the e2e stack, CI, a rebuild) lacked it,
-- so every homework save there failed with "Could not find the
-- 'reference_answer' column of 'homework_desk_posts'" and a post lived only
-- in one server's memory. On production this is a no-op.
--
-- No new table or function; the table's privileges are unchanged.

alter table public.homework_desk_posts
  add column if not exists reference_answer text not null default '';

comment on column public.homework_desk_posts.reference_answer is
  'Teacher-entered reference answer / rubric: grounds the AI grading assist on submitted photos. Never shown to students or parents (school chat cards leave it out).';
