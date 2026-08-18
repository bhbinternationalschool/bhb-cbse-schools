-- public.roles (phase 0) was created without a service_role grant, so
-- bootstrap-go-live's owner-role lookup fails 42501 on every deploy
-- (postgres log 2026-08-17 19:38:59). Read-only is all the app needs.
grant select on public.roles to service_role;
