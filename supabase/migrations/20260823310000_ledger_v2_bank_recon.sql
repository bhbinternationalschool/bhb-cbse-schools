-- Ledger v2 — bank statements and reconciliation.
--
-- Sequenced after the village-demographics migrations only to keep the
-- version numbers unique; it depends on nothing in them, and nothing in them
-- depends on this. Its real dependency is ledger_v2_core.
--
-- The book now knows what the school *thinks* happened. This is where it
-- learns what the bank says happened, and the two are made to agree.
--
-- Reconciliation is the check that catches what nothing else does. A posting
-- can be balanced, correctly dated, correctly numbered and still wrong — a fee
-- receipt entered for the wrong amount, a payment made twice, a cheque that
-- was never presented, a bank charge nobody knew about. None of that shows up
-- in a trial balance, because both sides of a wrong entry are equally wrong.
-- It shows up here, as a line on the statement with nothing in the book to
-- match it, or a line in the book the bank never saw.
--
-- Design notes worth keeping:
--
--   - Statement lines are deduplicated on a content hash, not on a bank
--     reference. Indian bank exports frequently reuse or omit the reference,
--     and re-importing an overlapping date range is the normal case rather
--     than the exception. The hash makes a re-import a no-op.
--   - A match is 1:1 and unique on both sides, so a statement line cannot be
--     used to explain two book entries, nor a book entry two statement lines.
--     Real statements do sometimes net several book entries into one line;
--     that is left unmatched for a human rather than guessed at.
--   - Matches record how confident the rule was and who made them, so an
--     auto-match can be told apart from a human's judgement later.

/* ─── Statements ────────────────────────────────────────────── */

create table if not exists public.ledger_bank_statements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- The desk's own bank account id, matching ledger_lines.subledger_id.
  bank_subledger_id text not null,
  statement_ref text not null default '',
  from_date date,
  to_date date,
  opening_balance_paise bigint,
  closing_balance_paise bigint,
  imported_by text not null default '',
  imported_at timestamptz not null default now(),
  unique (tenant_id, bank_subledger_id, statement_ref)
);

create index if not exists ledger_bank_statements_tenant_idx
  on public.ledger_bank_statements (tenant_id, bank_subledger_id);

create table if not exists public.ledger_bank_statement_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  statement_id uuid not null references public.ledger_bank_statements(id) on delete cascade,
  bank_subledger_id text not null,
  line_no integer not null default 0,
  txn_date date not null,
  value_date date,
  -- Always positive; `direction` carries the sign.
  amount_paise bigint not null check (amount_paise > 0),
  -- 'credit' is money arriving in the bank, which the book records as a
  -- DEBIT to the bank account. The inversion is the single most common source
  -- of reconciliation confusion, so the column is named for the bank's own
  -- vocabulary and translated at the point of matching.
  direction text not null check (direction in ('credit', 'debit')),
  narration text not null default '',
  ref text not null default '',
  balance_paise bigint,
  row_hash text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, row_hash)
);

create index if not exists ledger_bank_statement_lines_stmt_idx
  on public.ledger_bank_statement_lines (statement_id);
create index if not exists ledger_bank_statement_lines_match_idx
  on public.ledger_bank_statement_lines (tenant_id, bank_subledger_id, txn_date, amount_paise);

/* ─── Matches ───────────────────────────────────────────────── */

create table if not exists public.ledger_recon_matches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  statement_line_id uuid not null references public.ledger_bank_statement_lines(id) on delete cascade,
  ledger_line_id uuid not null references public.ledger_lines(id) on delete restrict,
  -- exact  : the bank's own reference matched, and so did the amount
  -- strong : amount and direction matched within a few days
  -- weak   : amount matched but the dates are far apart — proposed only
  -- manual : a person decided
  confidence text not null check (confidence in ('exact', 'strong', 'weak', 'manual')),
  matched_by text not null default '',
  matched_at timestamptz not null default now(),
  note text not null default '',
  unique (tenant_id, statement_line_id),
  unique (tenant_id, ledger_line_id)
);

create index if not exists ledger_recon_matches_tenant_idx
  on public.ledger_recon_matches (tenant_id);

/* ─── Due dates, for payables ageing ────────────────────────── */

-- Ageing a payable by the date its invoice was raised is not the same as
-- ageing it by the date it falls due, and only the second tells anyone what
-- is actually overdue. The vendor-bill projector fills this from the desk's
-- own `due_on`; it stays null for everything that has no due date.
alter table public.ledger_vouchers
  add column if not exists due_date date;

create index if not exists ledger_vouchers_due_idx
  on public.ledger_vouchers (tenant_id, due_date)
  where due_date is not null;

/* ─── What the bank has explained ───────────────────────────── */

-- Every bank line in the book, with its match if it has one. This is the
-- working set for a reconciliation: anything here with no statement line is
-- either in transit or wrong, and after a month it is almost always wrong.
create or replace view public.ledger_v_bank_book as
select
  l.tenant_id,
  l.id as ledger_line_id,
  l.subledger_id as bank_subledger_id,
  v.voucher_date,
  v.voucher_no,
  v.narration as voucher_narration,
  l.narration as line_narration,
  l.instrument_mode,
  l.instrument_ref,
  l.debit_paise,
  l.credit_paise,
  -- The book's view: a debit to the bank is money in.
  (l.debit_paise - l.credit_paise)::bigint as signed_paise,
  m.id as match_id,
  m.confidence,
  m.statement_line_id
from public.ledger_lines l
join public.ledger_vouchers v on v.id = l.voucher_id
left join public.ledger_recon_matches m on m.ledger_line_id = l.id
where l.subledger_kind = 'bank_account';

-- The mirror image: every statement line, with its match if it has one.
create or replace view public.ledger_v_statement_lines as
select
  s.tenant_id,
  s.id as statement_line_id,
  s.bank_subledger_id,
  s.txn_date,
  s.amount_paise,
  s.direction,
  s.narration,
  s.ref,
  s.balance_paise,
  -- Translated into the book's sign convention, so the two views can be
  -- compared without every caller re-deriving the inversion.
  (case when s.direction = 'credit' then s.amount_paise else -s.amount_paise end)::bigint as signed_paise,
  m.id as match_id,
  m.confidence,
  m.ledger_line_id
from public.ledger_bank_statement_lines s
left join public.ledger_recon_matches m on m.statement_line_id = s.id;

/* ─── Access ────────────────────────────────────────────────── */
-- Same two rules as the core migration: service_role needs an explicit grant,
-- and a stock Supabase project's default privileges hand anon and
-- authenticated everything unless they are revoked by name.

alter table public.ledger_bank_statements enable row level security;
alter table public.ledger_bank_statement_lines enable row level security;
alter table public.ledger_recon_matches enable row level security;

revoke all on public.ledger_bank_statements from anon, authenticated;
revoke all on public.ledger_bank_statement_lines from anon, authenticated;
revoke all on public.ledger_recon_matches from anon, authenticated;
revoke all on public.ledger_v_bank_book from anon, authenticated;
revoke all on public.ledger_v_statement_lines from anon, authenticated;

grant all on public.ledger_bank_statements to service_role;
grant all on public.ledger_bank_statement_lines to service_role;
grant all on public.ledger_recon_matches to service_role;
grant select on public.ledger_v_bank_book to service_role;
grant select on public.ledger_v_statement_lines to service_role;
