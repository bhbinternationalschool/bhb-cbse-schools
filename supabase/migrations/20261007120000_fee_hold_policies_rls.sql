-- fee_hold_policies: turn on row level security.
--
-- 20260711010000_fee_defaulter_playbook.sql created the table without RLS,
-- and 20260913090000_defaulter_hold_policy_rounds.sql later granted SELECT to
-- authenticated. Since then Supabase's security advisor has reported it every
-- week as rls_disabled_in_public (ERROR): any signed-in user could read every
-- tenant's hold policy rows through PostgREST. anon has no grant, and the
-- rows are policy settings, not personal data — but the table should match
-- its siblings (fee_hold_rounds, fee_hold_round_items, fee_hold_decisions).
--
-- Every reader and writer (lib/defaulterHold.server.ts, through
-- getServerTenantContext) uses the service role, which bypasses RLS, so the
-- Fees → Defaulter policy screen, hold rounds and hold decisions are
-- unaffected. Signed-in users keep read access to their own tenant's rows.
--
-- fee_recovery_policies and student_fee_holds also have RLS off, but no API
-- role has any grant on them, so PostgREST cannot reach them. They are left
-- alone here.

alter table public.fee_hold_policies enable row level security;

drop policy if exists fee_hold_policies_tenant_read on public.fee_hold_policies;
create policy fee_hold_policies_tenant_read on public.fee_hold_policies
  for select to authenticated using (public.is_tenant_member(tenant_id));

-- Restated so the table's access is readable in one place.
grant select on public.fee_hold_policies to authenticated;
grant select, insert, update, delete on public.fee_hold_policies to service_role;

notify pgrst, 'reload schema';
