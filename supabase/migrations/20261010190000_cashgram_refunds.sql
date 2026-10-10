-- Fee refunds by Cashgram (director, 10 Oct 2026: "build fee refunds first").
--
-- A Cashgram is a Cashfree Payouts link: the parent gets an SMS, proves the
-- number with an OTP, and chooses where the money goes. The school never needs
-- their bank details — which is exactly what an offline refund (cash or UPI
-- receipt, or money paid over the bill) never has.
--
-- cashgram_refunds: one row per link. The row is written BEFORE Cashfree is
-- asked, so a lost reply still leaves evidence; cashgram_id is the id sent to
-- Cashfree and is never reused.
--
--   fee_effect  'excess'  returns money paid over the bill; no receipt changes
--               'void'    cancels one receipt; voided only once REDEEMED
--
-- Nothing touches the fee book or the ledger until Cashfree says REDEEMED
-- (applied_at). A link is not money.
--
-- payout_settings gains the school's approval rule for these links:
--   'owner'  every link waits for the owner (default — the safe one)
--   'above'  links above refund_approval_above_paise wait; smaller go out
--   'none'   anyone with fees:void sends it

create table if not exists public.cashgram_refunds (
  cashgram_id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  fee_effect text not null check (fee_effect in ('excess', 'void')),
  household_id text not null default '',
  voucher_id text not null default '',
  receipt_no text not null default '',
  amount_paise bigint not null check (amount_paise >= 100),
  payee_name text not null default '',
  payee_phone text not null default '',
  payee_email text not null default '',
  reason text not null default '',
  link_expiry date not null,
  status text not null default 'PENDING_APPROVAL',
  cashgram_link text not null default '',
  reference_id text not null default '',
  utr text not null default '',
  requested_by text not null default '',
  approved_by text not null default '',
  approved_at timestamptz,
  decided_note text not null default '',
  applied_at timestamptz,
  ledger_voucher_id text not null default '',
  last_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cashgram_refunds_household_idx
  on public.cashgram_refunds (tenant_id, household_id, created_at desc);
create index if not exists cashgram_refunds_voucher_idx
  on public.cashgram_refunds (tenant_id, voucher_id);
create index if not exists cashgram_refunds_status_idx
  on public.cashgram_refunds (tenant_id, status);
alter table public.cashgram_refunds enable row level security;
grant all on public.cashgram_refunds to service_role;

alter table public.payout_settings
  add column if not exists refund_approval text not null default 'owner';
alter table public.payout_settings
  add column if not exists refund_approval_above_paise bigint not null default 0;
alter table public.payout_settings drop constraint if exists payout_settings_refund_approval_check;
alter table public.payout_settings
  add constraint payout_settings_refund_approval_check check (refund_approval in ('owner', 'above', 'none'));

notify pgrst, 'reload schema';
