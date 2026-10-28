/*
 * Marketing Manager budget table for the virtual staff room (director,
 * 28 Oct 2026). See automation/n8n (the "Office — Marketing Manager"
 * workflow) and migration 20261021120000_office_staff_room.sql.
 *
 * The one Google Ads account (and every marketing budget) is shared by the
 * school and the ITI; they are NEVER blended. A budget is one cap per unit
 * (school | iti | shared) per channel (google_ads | meta | whatsapp | survey
 * | other) per month. The director sets and raises the caps; within a cap the
 * Marketing Manager (n8n, service role) sets its own `allocated` and records
 * `spent`. One row per (tenant, month, unit, channel).
 *
 * Additive and safe to re-run: every statement is IF NOT EXISTS, a guarded
 * DO block, or drop-then-create.
 */

/* ─── office_marketing_budget: monthly caps per unit × channel ──── */
create table if not exists public.office_marketing_budget (
  id bigserial primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  /** First day of the budget month, e.g. 2026-10-01. */
  month date not null,
  /** The school and the ITI are separate units, never blended. 'shared' is
   * for a cap the director has not yet split. */
  unit text not null default 'school'
    check (unit in ('school', 'iti', 'shared')),
  channel text not null default 'other'
    check (channel in ('google_ads', 'meta', 'whatsapp', 'survey', 'other')),
  /** The director-set ceiling for this unit × channel × month. */
  cap_amount numeric(12, 2) not null default 0,
  currency text not null default 'INR',
  /** What the Marketing Manager has committed within the cap (its own call;
   * always <= cap_amount). */
  allocated numeric(12, 2) not null default 0,
  /** Actual spend recorded against this cap; null until it is known (e.g. a
   * Google Ads report exists). The Manager writes "not known" rather than
   * guess, so this stays null until a real figure arrives. */
  spent numeric(12, 2),
  status text not null default 'active'
    check (status in ('active', 'paused', 'archived')),
  note text not null default '',
  /** Who/what to attribute a cap change to, and anything the workflow needs. */
  payload jsonb not null default '{}'::jsonb,
  decided_by text not null default '',
  decided_at timestamptz,
  unique (tenant_id, month, unit, channel)
);

create index if not exists office_marketing_budget_month_idx
  on public.office_marketing_budget (tenant_id, month desc, unit, channel);

comment on table public.office_marketing_budget is
  'Virtual staff room marketing budget (automation/n8n). One cap per tenant/month/unit/channel; the Marketing Manager allocates within a cap, the director sets and raises caps. School and ITI are never blended.';

/* ─── office_tasks.source: allow the Marketing Manager and the director
 *      console to raise tasks ───────────────────────────────────────
 * The Marketing Manager raises gated proposals with source = 'marketing';
 * the director Telegram console raises drafts with source = 'assistant'.
 * office_tasks is created by 20261021120000_office_staff_room.sql with a
 * narrower check; widen it here, only if that table is present (so this
 * migration also applies on a database that does not yet have the office
 * tables). Idempotent: drop the existing source check and add the full one. */
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'office_tasks'
  ) then
    alter table public.office_tasks drop constraint if exists office_tasks_source_check;
    alter table public.office_tasks add constraint office_tasks_source_check
      check (source in ('huddle', 'receptionist', 'academic', 'director', 'marketing', 'assistant'));
  end if;
end
$$;

/* ─── RLS + grants ─────────────────────────────────────────────── */
-- Server only, exactly like the other office_* tables (director, 22 Oct 2026):
-- budget caps and spend are the director's; no signed-in browser user reads
-- them. n8n uses the service role; any ERP screen reads through a server route
-- with its own permission check. Every new table needs the service_role grant
-- spelled out, or the server's writes fail with a bare 42501.
alter table public.office_marketing_budget enable row level security;
revoke all on public.office_marketing_budget from public, anon, authenticated;
grant select, insert, update, delete on public.office_marketing_budget to service_role;
grant usage, select on sequence public.office_marketing_budget_id_seq to service_role;

notify pgrst, 'reload schema';
