/*
 * Transport Manager budget table for the virtual staff room (director,
 * 28 Oct 2026). See automation/n8n (the "Office — Transport Manager"
 * workflow) and migration 20261028170000_office_marketing_budget.sql, which
 * this mirrors.
 *
 * Transport is ONE fleet (the buses serve the school and the ITI together), so
 * — unlike the marketing budget — there is no unit split here. A budget is one
 * cap per channel (diesel | maintenance | insurance | other) per month. The
 * director sets and raises the caps; within a cap the Transport Manager (n8n,
 * service role) records its own `allocated` and `spent`. One row per
 * (tenant, month, channel).
 *
 * Additive and safe to re-run: every statement is IF NOT EXISTS, a guarded
 * DO block, or drop-then-create.
 */

/* ─── office_transport_budget: monthly caps per channel ──────────── */
create table if not exists public.office_transport_budget (
  id bigserial primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  /** First day of the budget month, e.g. 2026-10-01. */
  month date not null,
  /** Diesel and maintenance are asked for every month; insurance when a
   * renewal falls due; other for anything else. */
  channel text not null default 'other'
    check (channel in ('diesel', 'maintenance', 'insurance', 'other')),
  /** The director-set ceiling for this channel × month. */
  cap_amount numeric(12, 2) not null default 0,
  currency text not null default 'INR',
  /** What the Transport Manager has committed within the cap (its own call;
   * always <= cap_amount). */
  allocated numeric(12, 2) not null default 0,
  /** Actual spend recorded against this cap; null until it is known (e.g. the
   * fuel register has fills for the month). The Manager writes "not known"
   * rather than guess, so this stays null until a real figure arrives. */
  spent numeric(12, 2),
  status text not null default 'active'
    check (status in ('active', 'paused', 'archived')),
  note text not null default '',
  payload jsonb not null default '{}'::jsonb,
  decided_by text not null default '',
  decided_at timestamptz,
  unique (tenant_id, month, channel)
);

create index if not exists office_transport_budget_month_idx
  on public.office_transport_budget (tenant_id, month desc, channel);

comment on table public.office_transport_budget is
  'Virtual staff room transport (fleet) budget (automation/n8n). One cap per tenant/month/channel; the Transport Manager allocates within a cap, the director sets and raises caps. Transport is one fleet, never split by unit.';

/* ─── office_tasks.source: allow the Transport Manager to raise tasks ──
 * The Transport Manager raises plain open tasks with source = 'transport'.
 * office_tasks' source check was last widened by the marketing migration;
 * widen it again here, only if the table is present. Idempotent: drop the
 * existing source check and add the full one. */
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'office_tasks'
  ) then
    alter table public.office_tasks drop constraint if exists office_tasks_source_check;
    alter table public.office_tasks add constraint office_tasks_source_check
      check (source in ('huddle', 'receptionist', 'academic', 'director', 'marketing', 'assistant', 'transport'));
  end if;
end
$$;

/* ─── RLS + grants ─────────────────────────────────────────────── */
-- Server only, exactly like the other office_* tables: budget caps and spend
-- are the director's; no signed-in browser user reads them. n8n uses the
-- service role; any ERP screen reads through a server route with its own
-- permission check. Every new table needs the service_role grant spelled out,
-- or the server's writes fail with a bare 42501.
alter table public.office_transport_budget enable row level security;
revoke all on public.office_transport_budget from public, anon, authenticated;
grant select, insert, update, delete on public.office_transport_budget to service_role;
grant usage, select on sequence public.office_transport_budget_id_seq to service_role;

notify pgrst, 'reload schema';
