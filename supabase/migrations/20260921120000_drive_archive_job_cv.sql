-- CVs sent by job seekers are copied into the school's Google Drive too,
-- one folder per applicant (Careers / <year> / <name> – <mobile>). The
-- archive's kind check only knew media and receipts, so every CV archive
-- row would have been refused and the CV silently left out of Drive.
alter table public.drive_archive drop constraint if exists drive_archive_kind_check;
alter table public.drive_archive
  add constraint drive_archive_kind_check check (kind in ('media', 'receipt', 'job_cv'));

notify pgrst, 'reload schema';
