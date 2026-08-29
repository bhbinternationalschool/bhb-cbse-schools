-- Ledger v2 — what the payment gateway actually paid into the bank.
--
-- The gap this closes
-- ───────────────────
-- A parent pays ₹5,000 on a Cashfree link. The webhook mints a receipt and the
-- book debits Bank ₹5,000, today. Neither number is true. The bank receives
-- nothing today; it receives ₹4,901.50 tomorrow, netted into one lump credit
-- alongside every other payment of the same cycle, and the ₹98.50 difference
-- is a gateway fee and its GST that the book has never heard of.
--
-- So a gateway receipt could never be reconciled: there is no statement line
-- of ₹5,000 to find, there never will be, and the bank balance in the book
-- drifts by the fees for as long as the school collects online. This is the
-- same defect class as the store's undifferentiated 1010 bucket — the books
-- recording a plausible number instead of the one that happened.
--
-- The fix is the standard one, and it is standard because it is the only shape
-- that reconciles:
--
--   On capture     Dr Payment Gateway Clearing   5,000
--                    Cr Fee Income                       5,000
--
--   On settlement  Dr Bank (the account that got it)  4,901.50
--                  Dr Payment Gateway Charges            83.47
--                  Dr GST Input Credit                   15.03
--                    Cr Payment Gateway Clearing              5,000.00
--
-- Now the bank debit is one number, on one date, carrying the settlement's own
-- UTR as its instrument reference — which is exactly what the bank statement
-- line says, so the matcher in ledger_v2_bank_recon matches it `exact` with no
-- human involved. The clearing account's balance becomes a real quantity with
-- a name: money captured but not yet settled. It should be roughly one cycle
-- of collections, and if it is anything else, something is wrong and provable.
--
-- These two tables are a mirror of the gateway's own records, not part of the
-- book. They are mutable — a settlement genuinely moves INITIATED → SUCCESS,
-- and its UTR is null until it does. The book is written from them by
-- ledger_post, which is append-only and idempotent, so re-pulling a settlement
-- any number of times posts it exactly once.
--
-- PII: the recon API returns the payer's bank account number, IFSC and phone
-- for trace purposes. None of it is stored here — the ingestion redacts those
-- fields before the row is written. A school reconciling its own settlements
-- has no reason to hold a parent's bank account number.

/* ─── Settlements ───────────────────────────────────────────── */

create table if not exists public.ledger_pg_settlements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider text not null default 'cashfree',
  -- The gateway's own settlement id. One of these = one bank credit = one UTR.
  cf_settlement_id text not null,
  -- Null until the transfer is actually made. A missing UTR is "not yet",
  -- never "failed" — reading it as failure is the classic recon mistake.
  utr text not null default '',
  settlement_type text not null default '',
  status text not null default '',

  -- Every amount in paise. The gateway sends rupees as decimals; they are
  -- converted once, at ingestion, and never stored as floats.
  payment_amount_paise bigint not null default 0,
  amount_settled_paise bigint not null default 0,
  service_charge_paise bigint not null default 0,
  service_tax_paise bigint not null default 0,
  settlement_charge_paise bigint not null default 0,
  settlement_tax_paise bigint not null default 0,
  -- Signed: prior-cycle refunds and disputes make this negative, reversals
  -- of those make it positive.
  adjustment_paise bigint not null default 0,

  settled_on date,
  initiated_at timestamptz,
  settled_at timestamptz,

  -- Which of the school's bank accounts received it, once known. Empty until
  -- the settlement account is mapped; the posting falls back to the 1010
  -- group rather than refusing, exactly as inv_ledger_tender_account does.
  bank_account_id text not null default '',

  -- The journal this settlement posted, once it has one.
  voucher_id uuid references public.ledger_vouchers(id),
  posted_at timestamptz,
  post_error text not null default '',

  -- Event-level breakdown state.
  events_pulled_at timestamptz,
  event_count integer not null default 0,
  -- Signed sum of the events: credits positive, debits negative. Must equal
  -- amount_settled_paise + the fees. Where it does not, the recon view says so.
  events_total_paise bigint not null default 0,

  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, provider, cf_settlement_id)
);

create index if not exists ledger_pg_settlements_tenant_date_idx
  on public.ledger_pg_settlements (tenant_id, settled_on desc);
create index if not exists ledger_pg_settlements_utr_idx
  on public.ledger_pg_settlements (tenant_id, utr) where utr <> '';
create index if not exists ledger_pg_settlements_unposted_idx
  on public.ledger_pg_settlements (tenant_id, status)
  where voucher_id is null;

/* ─── The events inside a settlement ────────────────────────── */

-- Every rupee of a settlement is the sum of these. A payment credit, a refund
-- debit, a chargeback, an ad-hoc adjustment. Reconciling at this level rather
-- than at order level is what makes a prior-cycle refund explicable: it lands
-- in the settlement of the cycle it was processed in, not the cycle of the
-- payment it reverses, and only an event-level view shows that honestly.
create table if not exists public.ledger_pg_settlement_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider text not null default 'cashfree',
  cf_settlement_id text not null,
  event_id text not null,
  -- PAYMENT | REFUND | REFUND_REVERSAL | DISPUTE | DISPUTE_REVERSAL |
  -- CHARGEBACK | CHARGEBACK_REVERSAL | OTHER_ADJUSTMENT | FUND_SWEEP_REVERSAL
  event_type text not null default '',
  -- CREDIT (into the settlement) or DEBIT (out of it).
  sale_type text not null default '',
  event_status text not null default '',
  -- Always positive, as the gateway reports it.
  event_amount_paise bigint not null default 0,
  -- The same amount in the book's own sign convention: positive is money
  -- arriving. Carried as a column rather than derived at read time so that a
  -- SUM() reconciles without every caller having to re-derive the sign — the
  -- single most common place a reconciliation goes quietly wrong.
  signed_paise bigint not null default 0,

  -- What it was for. Our order/link id travels here, which is what lets a
  -- settlement line be traced back to the family that paid it.
  order_id text not null default '',
  cf_payment_id text not null default '',
  refund_id text not null default '',
  utr text not null default '',
  event_time timestamptz,

  -- Redacted at ingestion: no payer bank account, IFSC or phone.
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, provider, event_id)
);

create index if not exists ledger_pg_settlement_events_settlement_idx
  on public.ledger_pg_settlement_events (tenant_id, cf_settlement_id);
create index if not exists ledger_pg_settlement_events_order_idx
  on public.ledger_pg_settlement_events (tenant_id, order_id) where order_id <> '';

/* ─── Where a settlement does not add up ────────────────────── */

-- The finance query, as a view so nobody has to remember it.
--
-- Three independent numbers have to agree, and each catches a different
-- failure. `amount_settled` is what the gateway says it paid. The signed sum
-- of the events is what the gateway's own breakdown adds up to — if that
-- differs, pagination was cut short or an event is missing. The posted
-- voucher is what the book believes — if that differs, the journal was built
-- from a settlement that has since been restated.
create or replace view public.ledger_v_pg_settlement_recon as
select
  s.tenant_id,
  s.provider,
  s.cf_settlement_id,
  s.utr,
  s.status,
  s.settled_on,
  s.amount_settled_paise,
  s.payment_amount_paise,
  s.service_charge_paise + s.service_tax_paise
    + s.settlement_charge_paise + s.settlement_tax_paise as fee_paise,
  s.adjustment_paise,
  s.event_count,
  s.events_total_paise,
  -- What the settlement's own numbers say the net should be.
  (s.payment_amount_paise
     - s.service_charge_paise - s.service_tax_paise
     - s.settlement_charge_paise - s.settlement_tax_paise
     + s.adjustment_paise) as derived_net_paise,
  s.voucher_id,
  v.voucher_no,
  s.post_error,
  -- A settlement is explained when its arithmetic closes, its events were
  -- pulled and summed to the same gross, and the book has a voucher for it.
  case
    when s.status not in ('SUCCESS', 'PAID', 'COMPLETED') then 'pending'
    when (s.payment_amount_paise
            - s.service_charge_paise - s.service_tax_paise
            - s.settlement_charge_paise - s.settlement_tax_paise
            + s.adjustment_paise) <> s.amount_settled_paise then 'amounts_disagree'
    when s.events_pulled_at is null then 'events_not_pulled'
    when s.events_total_paise <> s.payment_amount_paise + s.adjustment_paise then 'events_disagree'
    when s.voucher_id is null then 'not_posted'
    else 'explained'
  end as recon_state
from public.ledger_pg_settlements s
left join public.ledger_vouchers v on v.id = s.voucher_id;

/* ─── Grants ────────────────────────────────────────────────── */

-- Every new table needs this explicitly or the service-role writes fail 42501.
grant all on public.ledger_pg_settlements to service_role;
grant all on public.ledger_pg_settlement_events to service_role;
grant select on public.ledger_v_pg_settlement_recon to service_role;

notify pgrst, 'reload schema';
