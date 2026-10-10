-- Grants for the tables created by 20260802100000_audit_api_library_otp.
--
-- That migration had never been applied to this project (found while
-- baselining the migration history). Applying it created the tables but
-- not the grants, so `service_role` — the role the Next.js API layer
-- uses — could not touch them: every writeAudit() call failed with
-- "permission denied for table audit_events" and was swallowed by the
-- warn-and-continue in audit.server.ts. parent_otp_codes was in the same
-- state, meaning parent OTP login could not have worked either.
--
-- Posture matches 20260808130000: service_role only, RLS on with no
-- policy so anon/authenticated are denied even if a grant reappears.

-- audit_events is deliberately append-only. The API layer may write and
-- read the trail but must not be able to rewrite or erase it — an audit
-- log that its own application can edit is not evidence of anything.
grant select, insert on public.audit_events to service_role;

grant select, insert, update, delete on public.api_keys           to service_role;
grant select, insert, update, delete on public.parent_otp_codes   to service_role;
grant select, insert, update, delete on public.library_titles     to service_role;
grant select, insert, update, delete on public.library_copies     to service_role;
grant select, insert, update, delete on public.library_issues     to service_role;

do $$
declare
  t text;
  tables text[] := array[
    'audit_events','api_keys','parent_otp_codes',
    'library_titles','library_copies','library_issues'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('revoke all on table public.%I from anon, authenticated;', t);
  end loop;
end $$;
