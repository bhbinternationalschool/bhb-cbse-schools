-- household_message_log — record the table production already has (29 Oct 2026).
--
-- The WhatsApp half of the staff timeline and the household history
-- (lib/householdMessageLog.server.ts, lib/staffMessageLog.server.ts) reads
-- and writes this table, and production has had it since early October, but
-- it was created outside the migrations folder: a fresh database (the local
-- e2e stack, CI) had no such table. Until now that went unseen because a
-- failed read became an empty log; it is now a 503, so the table must exist.
--
-- Copied from production's catalog (columns, defaults, keys, indexes, RLS,
-- grants). Every statement is "if not exists" / a restated grant: applying
-- it to production changes nothing.

create table if not exists public.household_message_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  channel text not null default 'wa',
  direction text not null default 'out',
  household_id text,
  mobile_e164 text not null default '',
  purpose text not null default '',
  via text not null default '',
  template_name text not null default '',
  preview text not null default '',
  status text not null default 'sent',
  error text,
  wa_message_id text,
  created_at timestamptz not null default now()
);

create index if not exists household_message_log_tenant_idx
  on public.household_message_log (tenant_id, created_at desc);
create index if not exists household_message_log_household_idx
  on public.household_message_log (tenant_id, household_id, created_at desc);
create index if not exists household_message_log_mobile_idx
  on public.household_message_log (tenant_id, mobile_e164, created_at desc);

alter table public.household_message_log enable row level security;

-- Rows only through the server (service role), as in production.
revoke all on public.household_message_log from public, anon, authenticated;
grant select, insert, update, delete on public.household_message_log to service_role;
