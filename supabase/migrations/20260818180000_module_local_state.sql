-- One server-backed store for the modules that were still localStorage-only
-- on 2026-08-18 (fee holds, fee adjustments, salary increment/hold/account,
-- complaints handling, discipline, health, visitors, duty roster, exam
-- invigilation, staff attendance rules, UDISE settings, Tally settings, WA
-- campaigns, CRM parent chat, WA chatbot flows, ID-card templates). One row
-- per (tenant, module); the app's module-state route enforces RBAC per
-- module. Same LWW blob shape as payroll_state — each of these is edited by
-- one desk at a time.
create table if not exists public.module_local_state (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  module_key text not null,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, module_key)
);

alter table public.module_local_state enable row level security;
drop policy if exists module_local_state_tenant_all on public.module_local_state;
create policy module_local_state_tenant_all
  on public.module_local_state for all
  using (is_tenant_member(tenant_id));

grant select, insert, update, delete on public.module_local_state to service_role;

notify pgrst, 'reload schema';
