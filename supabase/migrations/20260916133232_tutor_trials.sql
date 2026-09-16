-- A free first day of the full AI tutor, once per child.
--
-- WHY A TABLE OF ITS OWN (2026-09-16): the obvious shortcut — a ₹0 "paid"
-- row in tutor_pass_orders — is refused by that table's own check
-- (amount_paise > 0), and rightly: every reader of tutor_pass_orders treats
-- a paid row as money received. A free trial written there would have been
-- counted as tutor revenue and could have reached the ledger projection.
-- Money and gifts stay in separate tables.
--
-- The owner's decision: the half-yearly exam (16–26 Sep 2026) is the moment
-- to let every family try the full tutor free for a day, so the habit forms
-- when the child most needs it. The day starts when the family first uses
-- it, not when it is granted — a trial that expires unopened builds nothing.
--
-- One row per child, ever: the primary key is the rule.

create table if not exists public.tutor_trials (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id text not null,
  household_id text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  source text not null default '',
  created_at timestamptz not null default now(),
  primary key (tenant_id, student_id),
  check (ends_at > starts_at)
);

create index if not exists tutor_trials_household_idx
  on public.tutor_trials (tenant_id, household_id);

alter table public.tutor_trials enable row level security;

-- Every new table needs this explicitly, or server writes fail with 42501.
grant all on public.tutor_trials to service_role;
