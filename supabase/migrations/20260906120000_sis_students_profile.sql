-- sis_students.profile — the rest of the student record.
--
-- The SIS student type carries ~100 fields; sis_students has 45 columns.
-- Everything else (full Aadhaar numbers of student/father/mother, Aadhaar
-- verification status, the UDISE+ flags the import sets, caste, permanent
-- address, bank details, parents' occupation/qualification, income, height/
-- weight, CWSN, medical notes, RFID, second/third language …) was dropped by
-- studentToRow on every push and therefore never reached the database. With
-- SIS_READ_FROM_DB on, the next hydrate replaced the office browser's copy
-- with the DB rows, so those values vanished from the only place they had
-- ever existed. Found 2026-09-06 when the office asked why no student shows
-- a full Aadhaar number: only aadhaar_last4 was ever stored.
--
-- Same shape as sis_staff.profile: a jsonb bag of the non-column fields,
-- spread under the columns on read (columns win). Adding a column here is
-- not needed for each new field again.
alter table public.sis_students
  add column if not exists profile jsonb not null default '{}'::jsonb;

comment on column public.sis_students.profile is
  'Non-column SisStudent fields (full Aadhaar numbers, verification, UDISE+ flags, address, bank, health …). Columns win over profile on read.';
