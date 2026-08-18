-- Salary setup (Masters → Salary: pay cycle settings, salary heads,
-- structures, per-staff assignment) lived only in localStorage — "(demo)"
-- in lib/salarySetup.ts — and every login wipes the browser's bhb_* cache,
-- so a full salary setup done on 2026-08-18 vanished on relogin. Persist it
-- as a one-row-per-tenant blob like payroll_state (one payroll admin edits
-- it; last-writer-wins is acceptable here).
create table if not exists public.salary_setup_state (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  state jsonb not null default '{"version":1}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.salary_setup_state enable row level security;

drop policy if exists "salary_setup_state_tenant_all" on public.salary_setup_state;
create policy "salary_setup_state_tenant_all"
  on public.salary_setup_state for all
  using (is_tenant_member(tenant_id));

-- No default privilege for service_role in this project — grant explicitly.
grant select, insert, update, delete on public.salary_setup_state to service_role;

notify pgrst, 'reload schema';
