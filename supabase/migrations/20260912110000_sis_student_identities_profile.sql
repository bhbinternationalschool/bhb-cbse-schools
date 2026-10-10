-- sis_student_identities.profile — so the identity/enrollment split cannot
-- lose what sis_students.profile holds.
--
-- Phase 3 of docs/SIS_IDENTITY_ENROLLMENT_SPLIT_PLAN.md lets SIS_IDENTITY_SPLIT
-- switch the roster GET onto sis_enrollments ⋈ sis_student_identities. That
-- read reconstructs a student field by field — and there was no profile column
-- to reconstruct from, so flipping the flag would have blanked, on every
-- browser, exactly the fields migration 20260912100000 just stopped losing:
-- the full Aadhaar numbers of student/father/mother, verification, the UDISE+
-- flags, caste, permanent address, bank, occupation, qualification, income,
-- health, RFID, languages, tag ids.
--
-- The flag is off in production (nothing sets SIS_IDENTITY_SPLIT), so this is
-- pre-emptive: the column exists and is seeded from sis_students, and
-- identityEnrollmentToStudent now reads it, before anyone can turn the flag on.
alter table public.sis_student_identities
  add column if not exists profile jsonb not null default '{}'::jsonb;

comment on column public.sis_student_identities.profile is
  'Non-column SisStudent fields — mirrors sis_students.profile. Columns win over profile on read.';

-- Seed from the row each identity was backfilled from. Ids were carried across
-- unchanged by the Phase 2 backfill, which is what makes this join sound.
update public.sis_student_identities i
   set profile = s.profile
  from public.sis_students s
 where s.id = i.id
   and s.tenant_id = i.tenant_id
   and i.profile = '{}'::jsonb
   and s.profile <> '{}'::jsonb;
