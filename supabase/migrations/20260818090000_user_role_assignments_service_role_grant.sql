-- bootstrap-go-live upserts the super admins' owner role into
-- user_role_assignments on every deploy and logged 42501 each time
-- (6 in the hour after the 2026-08-18 deploys). Same missing-grant class as
-- public.roles (20260818061000).
grant select, insert, update, delete on public.user_role_assignments to service_role;
