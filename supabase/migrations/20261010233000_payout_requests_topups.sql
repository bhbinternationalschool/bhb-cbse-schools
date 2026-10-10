-- Vendor bills and payment vouchers paid from the Cashfree Payouts wallet, and
-- wallet top-ups booked (director, 10 Oct 2026: "ok make all and debit would
-- be our union bank account and credit would be wallet").
--
-- 1. payout_requests — the front door for paying a store vendor bill or a
--    payment voucher from the wallet. The school's approval rule
--    (payout_settings.payment_approval) holds it for the owner, or lets it
--    through. Then one of:
--      channel 'transfer'  bank transfer to the vendor's account on file
--                          (payout_transfers, target_kind 'payout_request')
--      channel 'link'      a Cashgram to a phone (cashgram_refunds, purpose
--                          'payout_request') — a vendor with no bank details,
--                          or a voucher payee the school has none for
--    Nothing is booked until Cashfree confirms the money arrived; then the
--    vendor bill is settled through inv_pay_vendor_bill with mode 'cashfree',
--    or the voucher is posted, both crediting 1110. applied_at, once.
--
-- 2. inv_vendor_payments learns mode 'cashfree', and inv_ledger_tender_account
--    maps it to 1110 — so the existing vendor-bill function books a wallet
--    payment from the wallet, not from a bank the money never left.
--
-- 3. payout_wallet_topups — money moved from a school bank (Union Bank) into
--    the wallet: Dr 1110 Cashfree Payouts Wallet / Cr that bank. A transfer
--    between the school's own accounts, never an expense.

-- 1 ─────────────────────────────────────────────────────────────────────────
create table if not exists public.payout_requests (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('vendor_bill', 'voucher')),
  channel text not null check (channel in ('transfer', 'link')),
  amount_paise bigint not null check (amount_paise >= 100),
  payee_name text not null default '',
  payee_phone text not null default '',
  vendor_id text not null default '',
  bill_id text not null default '',
  bill_no text not null default '',
  -- voucher: { narration, partyName, lines: [{accountCode, amountPaise, costCentreCode?}] }
  draft jsonb not null default '{}'::jsonb,
  reason text not null default '',
  status text not null default 'PENDING_APPROVAL'
    check (status in ('PENDING_APPROVAL', 'REJECTED', 'SENT', 'PAID', 'FAILED', 'CANCELLED')),
  transfer_id text not null default '',
  cashgram_id text not null default '',
  utr text not null default '',
  requested_by text not null default '',
  approved_by text not null default '',
  approved_at timestamptz,
  decided_note text not null default '',
  applied_at timestamptz,
  result_ref text not null default '',
  last_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'vendor_bill' or bill_id <> ''),
  check (kind <> 'voucher' or channel = 'link')
);
create index if not exists payout_requests_status_idx on public.payout_requests (tenant_id, status, created_at desc);
create index if not exists payout_requests_bill_idx on public.payout_requests (tenant_id, bill_id);
-- One request in flight per vendor bill: a second would promise the same due twice.
create unique index if not exists payout_requests_one_open_per_bill
  on public.payout_requests (tenant_id, bill_id)
  where kind = 'vendor_bill' and status in ('PENDING_APPROVAL', 'SENT');
alter table public.payout_requests enable row level security;
grant all on public.payout_requests to service_role;

alter table public.payout_settings add column if not exists payment_approval text not null default 'owner';
alter table public.payout_settings add column if not exists payment_approval_above_paise bigint not null default 0;
alter table public.payout_settings drop constraint if exists payout_settings_payment_approval_check;
alter table public.payout_settings
  add constraint payout_settings_payment_approval_check check (payment_approval in ('owner', 'above', 'none'));

-- A transfer made for a request: settled once (webhook and status check race).
alter table public.payout_transfers add column if not exists applied_at timestamptz;

-- Links for requests live with every other Cashgram, so the wallet check sees them.
alter table public.cashgram_refunds drop constraint if exists cashgram_refunds_purpose_check;
alter table public.cashgram_refunds
  add constraint cashgram_refunds_purpose_check check (purpose in ('fee_refund', 'staff_pay', 'payout_request'));
alter table public.cashgram_refunds drop constraint if exists cashgram_refunds_fee_effect_check;
alter table public.cashgram_refunds
  add constraint cashgram_refunds_fee_effect_check check (
    (purpose = 'fee_refund' and fee_effect in ('excess', 'void'))
    or (purpose in ('staff_pay', 'payout_request') and fee_effect = 'none' and target_kind <> '' and target_id <> '')
  );

-- 2 ─────────────────────────────────────────────────────────────────────────
alter table public.inv_vendor_payments drop constraint if exists inv_vendor_payments_mode_check;
alter table public.inv_vendor_payments
  add constraint inv_vendor_payments_mode_check
  check (mode in ('cash', 'bank', 'upi', 'cheque', 'neft', 'rtgs', 'imps', 'card', 'cashfree'));

create or replace function public.inv_ledger_tender_account(p_mode text)
 returns text
 language sql
 immutable
as $function$
  select case lower(coalesce(p_mode, ''))
           when 'cash' then '1000'
           when 'cheque' then '1050'
           when 'dd' then '1050'
           -- Paid out of the Cashfree Payouts wallet, not a bank.
           when 'cashfree' then '1110'
           else '1010'
         end;
$function$;

-- 3 ─────────────────────────────────────────────────────────────────────────
create table if not exists public.payout_wallet_topups (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  amount_paise bigint not null check (amount_paise > 0),
  topup_date date not null,
  -- The school bank the money left: its ledger account (e.g. 1012 UBI -Main)
  -- and, when that account is one desk bank, the desk bank id.
  bank_ledger_code text not null,
  bank_account_id text not null default '',
  reference text not null default '',
  note text not null default '',
  created_by text not null default '',
  ledger_voucher_id text not null default '',
  ledger_voucher_no text not null default '',
  created_at timestamptz not null default now()
);
-- The same bank transfer entered twice would show the wallet twice as full.
create unique index if not exists payout_wallet_topups_reference
  on public.payout_wallet_topups (tenant_id, reference) where reference <> '';
alter table public.payout_wallet_topups enable row level security;
grant all on public.payout_wallet_topups to service_role;

notify pgrst, 'reload schema';
