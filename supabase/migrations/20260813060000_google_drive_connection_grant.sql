-- google_drive_connection was created in 20260812124817 without a
-- service_role grant — every write from the app failed with 42501
-- ("permission denied for table google_drive_connection") once deployed.
-- Every other table's migration in this repo does this grant explicitly
-- (this project has no default privilege for new tables); this one was
-- missed. Confirmed live in Supabase via a probe insert/delete before
-- writing this file, so this migration documents what's already applied.

grant select, insert, update, delete on public.google_drive_connection to service_role;
