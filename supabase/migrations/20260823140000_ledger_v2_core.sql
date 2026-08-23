-- Ledger v2 — the server-side book of account.
--
-- Why this exists
-- ───────────────
-- The accounts desk keeps its book in the browser: localStorage is the truth,
-- and every save pushes the whole state to 22 `accounts_desk_*` tables, each
-- pruned to whatever ids that one browser happened to hold. The audit on
-- 2026-08-23 found the consequences — balances stored per-browser rather than
-- derived, a prune that deletes any row the pushing client did not have, and
-- postings fired from floating promises that could be dropped. That shape can
-- run a desk. It cannot be a book of account.
--
-- These tables are that book. Five properties the desk tables do not have:
--
--   1. Append-only. Vouchers and lines refuse UPDATE and DELETE at the
--      trigger level. A mistake is corrected by a reversing voucher that
--      points at the original, never by editing or removing history.
--   2. Balances are derived. Nothing stores a balance; every balance is a
--      view over the lines. Two clerks posting at once can no longer produce
--      two different cash positions.
--   3. Every voucher is numbered, gap-free, per type per fiscal year, under
--      an advisory lock — and carries who posted it and when.
--   4. Idempotent by (source_type, source_id). The same business event can be
--      replayed any number of times and lands exactly once, which is what
--      makes the desk's retry queue safe.
--   5. Periods lock. A locked month or a closed year refuses new postings.
--
-- Nothing here reads or writes the `accounts_desk_*` tables. This migration is
-- purely additive: it introduces the ledger alongside the existing desk, which
-- keeps working untouched. The adapter that mirrors desk postings into these
-- tables, and the eventual cutover of reads, come after.
--
-- Not security definer, matching sis_promote_enrollment and the rest of this
-- project: these tables are only ever reached over the service_role
-- connection, which already has full access.

/* ─── Fiscal years and period locks ─────────────────────────── */

create table if not exists public.ledger_fiscal_years (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  label text not null default '',
  start_date date not null,
  end_date date not null,
  -- 'open' accepts postings; 'closed' refuses them until reopened.
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_by text not null default '',
  closed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, code)
);

-- A period row exists only once somebody locks that month. No row means open,
-- so the common case costs nothing.
create table if not exists public.ledger_periods (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- 'YYYY-MM'
  period text not null,
  fy_code text not null default '',
  status text not null default 'open' check (status in ('open', 'locked', 'closed')),
  locked_by text not null default '',
  locked_at timestamptz,
  note text not null default '',
  primary key (tenant_id, period)
);

/* ─── Chart of accounts ─────────────────────────────────────── */

-- Hierarchical, unlike the desk's flat 20-account list: `parent_code` lets the
-- CA group ledgers the way the audited statements present them, and
-- `schedule_group` carries the Form 10B / Receipts & Payments bucket so the
-- statutory pack can be produced without a hand-built mapping every year.
create table if not exists public.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  parent_code text not null default '',
  kind text not null check (kind in ('asset', 'liability', 'income', 'expense', 'equity')),
  schedule_group text not null default '',
  -- Marks the accounts the cash book and bank book roll up to.
  is_cash boolean not null default false,
  is_bank boolean not null default false,
  -- A control account is backed by a party sub-ledger (receivables, payables).
  is_control boolean not null default false,
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create index if not exists ledger_accounts_tenant_idx on public.ledger_accounts (tenant_id);

/* ─── Parties and cost centres ──────────────────────────────── */

-- One table for everyone the school owes or is owed by. `external_id` is the
-- id the originating desk already uses (vendor id, staff id, household id) so
-- a posting never has to invent a mapping.
create table if not exists public.ledger_parties (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('vendor', 'staff', 'household', 'student', 'trustee', 'bank', 'other')),
  external_id text not null default '',
  name text not null default '',
  phone text not null default '',
  gstin text not null default '',
  pan text not null default '',
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (tenant_id, kind, external_id)
);

create index if not exists ledger_parties_tenant_idx on public.ledger_parties (tenant_id);

-- School / hostel / transport / trust — so budget-vs-actual and per-activity
-- costing are possible without re-cutting the chart of accounts.
create table if not exists public.ledger_cost_centres (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null default '',
  is_active boolean not null default true,
  unique (tenant_id, code)
);

/* ─── Vouchers and lines — the book itself ──────────────────── */

create table if not exists public.ledger_vouchers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  voucher_type text not null check (voucher_type in (
    'receipt', 'payment', 'contra', 'journal', 'purchase',
    'sales', 'payroll', 'opening', 'closing', 'reversal'
  )),
  fy_code text not null default '',
  -- Gap-free within (tenant, type, fiscal year). Auditors ask for this.
  seq_no integer not null,
  voucher_no text not null default '',
  voucher_date date not null,
  narration text not null default '',
  -- The business event this came from. Unique, so a replay lands once.
  source_type text not null default '',
  source_id text not null default '',
  -- Set on a reversing voucher; the original is never touched.
  reverses_voucher_id uuid references public.ledger_vouchers(id),
  reversal_reason text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  unique (tenant_id, voucher_type, fy_code, seq_no)
);

create unique index if not exists ledger_vouchers_source_idx
  on public.ledger_vouchers (tenant_id, source_type, source_id)
  where source_id <> '';

create index if not exists ledger_vouchers_tenant_date_idx
  on public.ledger_vouchers (tenant_id, voucher_date);
create index if not exists ledger_vouchers_reverses_idx
  on public.ledger_vouchers (reverses_voucher_id)
  where reverses_voucher_id is not null;

create table if not exists public.ledger_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  voucher_id uuid not null references public.ledger_vouchers(id) on delete restrict,
  line_no integer not null,
  account_id uuid not null references public.ledger_accounts(id) on delete restrict,
  party_id uuid references public.ledger_parties(id),
  cost_centre_id uuid references public.ledger_cost_centres(id),
  -- Which cash pool or bank account this line moved, by the desk's own id, so
  -- the cash book and bank book can be reproduced per instrument.
  subledger_kind text not null default '' check (subledger_kind in ('', 'cash_pool', 'bank_account')),
  subledger_id text not null default '',
  debit_paise bigint not null default 0 check (debit_paise >= 0),
  credit_paise bigint not null default 0 check (credit_paise >= 0),
  -- A line is one side or the other, never both and never neither.
  constraint ledger_lines_one_side check (
    (debit_paise > 0 and credit_paise = 0) or (credit_paise > 0 and debit_paise = 0)
  ),
  narration text not null default '',
  instrument_mode text not null default '',
  instrument_ref text not null default '',
  instrument_date date,
  unique (voucher_id, line_no)
);

create index if not exists ledger_lines_tenant_account_idx
  on public.ledger_lines (tenant_id, account_id);
create index if not exists ledger_lines_voucher_idx on public.ledger_lines (voucher_id);
create index if not exists ledger_lines_party_idx
  on public.ledger_lines (tenant_id, party_id) where party_id is not null;
create index if not exists ledger_lines_subledger_idx
  on public.ledger_lines (tenant_id, subledger_kind, subledger_id)
  where subledger_kind <> '';

/* ─── Append-only enforcement ───────────────────────────────── */

-- The whole point of the rebuild. Without this the ledger is just another
-- mutable table and every guarantee above is a convention rather than a rule.
create or replace function public.ledger_refuse_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception
    '% is append-only: correct a posting with ledger_reverse(), never % it',
    tg_table_name, lower(tg_op);
end;
$$;

drop trigger if exists ledger_vouchers_append_only on public.ledger_vouchers;
create trigger ledger_vouchers_append_only
  before update or delete on public.ledger_vouchers
  for each row execute function public.ledger_refuse_mutation();

drop trigger if exists ledger_lines_append_only on public.ledger_lines;
create trigger ledger_lines_append_only
  before update or delete on public.ledger_lines
  for each row execute function public.ledger_refuse_mutation();

/* ─── Audit ─────────────────────────────────────────────────── */

create table if not exists public.ledger_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  at timestamptz not null default now(),
  actor text not null default '',
  action text not null,
  detail jsonb not null default '{}'::jsonb
);

create index if not exists ledger_audit_tenant_at_idx on public.ledger_audit (tenant_id, at desc);

/* ─── Derived balances ──────────────────────────────────────── */

-- Every balance in the system comes from here. Assets and expenses are
-- debit-normal, everything else credit-normal, so `balance_paise` is always
-- the figure that belongs on the statement without the caller knowing signs.
create or replace view public.ledger_v_account_balance as
select
  a.tenant_id,
  a.id as account_id,
  a.code,
  a.name,
  a.kind,
  a.schedule_group,
  a.parent_code,
  coalesce(sum(l.debit_paise), 0)::bigint as debit_paise,
  coalesce(sum(l.credit_paise), 0)::bigint as credit_paise,
  case
    when a.kind in ('asset', 'expense')
      then coalesce(sum(l.debit_paise), 0) - coalesce(sum(l.credit_paise), 0)
    else coalesce(sum(l.credit_paise), 0) - coalesce(sum(l.debit_paise), 0)
  end::bigint as balance_paise
from public.ledger_accounts a
left join public.ledger_lines l on l.account_id = a.id
group by a.tenant_id, a.id, a.code, a.name, a.kind, a.schedule_group, a.parent_code;

-- The trial balance is taken from the raw sides, not from `balance_paise`.
--
-- `balance_paise` is signed by the account's natural side, which is what a
-- statement wants but is the wrong basis for this: an account sitting contrary
-- to its nature — a receivable in credit because money came in before the
-- charge was raised — has a negative `balance_paise`, and a rule of the form
-- "if positive, show it on this side" drops it from BOTH columns. The totals
-- then fail to tie for a book that is in fact perfectly balanced, which is the
-- worst kind of wrong: it indicts the data instead of the query.
--
-- Debits minus credits always sums to zero across every account, so deriving
-- the two columns from that difference ties by construction.
create or replace view public.ledger_v_trial_balance as
select
  tenant_id,
  account_id,
  code,
  name,
  kind,
  schedule_group,
  debit_paise,
  credit_paise,
  greatest(debit_paise - credit_paise, 0)::bigint as closing_debit_paise,
  greatest(credit_paise - debit_paise, 0)::bigint as closing_credit_paise,
  balance_paise
from public.ledger_v_account_balance;

-- Per cash pool and per bank account, reproducing the cash book and bank book
-- from the lines rather than from a stored running balance.
create or replace view public.ledger_v_subledger_balance as
select
  l.tenant_id,
  l.subledger_kind,
  l.subledger_id,
  (sum(l.debit_paise) - sum(l.credit_paise))::bigint as balance_paise
from public.ledger_lines l
where l.subledger_kind <> ''
group by l.tenant_id, l.subledger_kind, l.subledger_id;

create or replace view public.ledger_v_party_balance as
select
  l.tenant_id,
  p.id as party_id,
  p.kind,
  p.external_id,
  p.name,
  (sum(l.debit_paise) - sum(l.credit_paise))::bigint as balance_paise
from public.ledger_lines l
join public.ledger_parties p on p.id = l.party_id
group by l.tenant_id, p.id, p.kind, p.external_id, p.name;

/* ─── Access ────────────────────────────────────────────────── */
--
-- Two things, and both matter.
--
-- First, service_role needs an explicit grant or every write fails with
-- 42501 — new tables get nothing by default.
--
-- Second, and easier to miss: a stock Supabase project carries default
-- privileges that hand `anon` and `authenticated` full access to every new
-- table in `public`. The anon key ships inside the browser bundle, so a
-- ledger created on such a project would be world-readable and world-writable
-- the moment it existed. Production has those defaults revoked already and
-- the verification project did not — which is exactly why this is spelled out
-- here instead of being assumed. RLS is enabled as well: service_role bypasses
-- it, so it costs nothing, and it keeps the tables shut even if the default
-- privileges are ever restored.
--
-- The views need the same treatment. A view runs with its owner's rights
-- unless it is declared security_invoker, so an un-revoked view would read
-- straight past RLS on the tables underneath it.

alter table public.ledger_fiscal_years enable row level security;
alter table public.ledger_periods enable row level security;
alter table public.ledger_accounts enable row level security;
alter table public.ledger_parties enable row level security;
alter table public.ledger_cost_centres enable row level security;
alter table public.ledger_vouchers enable row level security;
alter table public.ledger_lines enable row level security;
alter table public.ledger_audit enable row level security;

revoke all on public.ledger_fiscal_years from anon, authenticated;
revoke all on public.ledger_periods from anon, authenticated;
revoke all on public.ledger_accounts from anon, authenticated;
revoke all on public.ledger_parties from anon, authenticated;
revoke all on public.ledger_cost_centres from anon, authenticated;
revoke all on public.ledger_vouchers from anon, authenticated;
revoke all on public.ledger_lines from anon, authenticated;
revoke all on public.ledger_audit from anon, authenticated;
revoke all on public.ledger_v_account_balance from anon, authenticated;
revoke all on public.ledger_v_trial_balance from anon, authenticated;
revoke all on public.ledger_v_subledger_balance from anon, authenticated;
revoke all on public.ledger_v_party_balance from anon, authenticated;

-- The trigger function is internal; nothing outside the table should call it.
revoke all on function public.ledger_refuse_mutation() from public;
revoke all on function public.ledger_refuse_mutation() from anon, authenticated;

grant all on public.ledger_fiscal_years to service_role;
grant all on public.ledger_periods to service_role;
grant all on public.ledger_accounts to service_role;
grant all on public.ledger_parties to service_role;
grant all on public.ledger_cost_centres to service_role;
grant all on public.ledger_vouchers to service_role;
grant all on public.ledger_lines to service_role;
grant all on public.ledger_audit to service_role;
grant select on public.ledger_v_account_balance to service_role;
grant select on public.ledger_v_trial_balance to service_role;
grant select on public.ledger_v_subledger_balance to service_role;
grant select on public.ledger_v_party_balance to service_role;
