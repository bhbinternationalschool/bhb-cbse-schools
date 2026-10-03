-- Money the school sends out through Cashfree Payouts.
--
-- Today bankFileExport.ts writes a NEFT/bulk file that somebody uploads into
-- net banking by hand. The ERP then has no idea what happened: the payroll run
-- is marked published and every staff member is assumed paid. A transfer that
-- bounced is invisible until the person says they were not paid.
--
-- This table is the per-transfer record that makes that knowable.
--
-- transfer_id is OURS and deterministic (kind_subject_period_paise). Cashfree
-- rejects a duplicate, and that rejection is the last line of defence against
-- paying somebody twice — the one mistake here that cannot be undone by us,
-- because the money is in their account and getting it back is a conversation,
-- not an API call. The primary key is the same string, so our own table refuses
-- it first. The amount is part of the id so a CORRECTED payment for the same
-- person and month is a different transfer, which it is.
--
-- status carries Cashfree's own values plus UNKNOWN, which is what a row holds
-- before Cashfree has answered and what it KEEPS after a 5XX. That distinction
-- is the point: a 5XX is not evidence the transfer did not happen, so the row
-- must not read as failed, because a failed row invites a second send.
--
-- REVERSED deserves its own mention. A transfer can succeed and then be
-- returned by the beneficiary's bank days later. The salary looked paid and the
-- money is back, so it is unpaid again — collapsing it into "failed" or
-- "pending" would leave a staff member unpaid with nothing flagging it.

create table if not exists public.payout_transfers (
  transfer_id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- sal | vnd | ref — what kind of payment this is.
  kind text not null default '',
  -- The staff member, vendor or household being paid.
  subject_id text not null default '',
  -- Salary month, bill id: what distinguishes one payment from the next.
  period text not null default '',
  beneficiary_id text not null default '',
  amount_paise integer not null check (amount_paise > 0),
  -- RECEIVED | APPROVAL_PENDING | PENDING | SUCCESS | FAILED | REJECTED |
  -- REVERSED | UNKNOWN. Only SUCCESS clears a payable.
  status text not null default 'UNKNOWN',
  cf_transfer_id text not null default '',
  -- The bank reference, once the money has actually moved. This is what pairs
  -- against the bank statement line in reconciliation.
  utr text not null default '',
  status_description text not null default '',
  requested_by text not null default '',
  last_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.payout_transfers is
  'Outgoing Cashfree Payouts transfers. transfer_id is deterministic so a duplicate is refused. UNKNOWN means Cashfree has not answered — never treat it as failed, because a 5XX leaves it here and a failed row invites a second payment.';

create index if not exists payout_transfers_period_idx
  on public.payout_transfers (tenant_id, kind, period);

create index if not exists payout_transfers_subject_idx
  on public.payout_transfers (tenant_id, subject_id);

-- The rows somebody has to look at: sent and returned, refused, or never
-- answered for. Partial so it stays small — on a healthy month it is empty.
create index if not exists payout_transfers_attention_idx
  on public.payout_transfers (tenant_id, status)
  where status in ('FAILED', 'REJECTED', 'REVERSED', 'UNKNOWN');

-- Every new table needs an explicit service_role grant, or the server's writes
-- fail 42501 and the request "succeeds" while storing nothing. Here that would
-- mean sending a transfer with no record of it — the exact state in which a
-- salary gets paid twice.
grant all on public.payout_transfers to service_role;
-- Server-only, like fee_autopay: no anon/authenticated access and RLS on,
-- so the public key cannot read money records through PostgREST.
revoke all on public.payout_transfers from anon, authenticated;
alter table public.payout_transfers enable row level security;

notify pgrst, 'reload schema';
