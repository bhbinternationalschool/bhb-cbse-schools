-- Refunds the school asks Cashfree for, and what became of them.
--
-- Before this, a refund had to be done by hand in the Cashfree dashboard. The
-- ERP learned of it only when the settlement recon report arrived — which
-- already parses refund_details, so the READ side was never the gap. The gap
-- was that the office had to leave the ERP, and the fee book sat saying PAID
-- until somebody remembered to void the receipt by hand.
--
-- WHY A TABLE AND NOT A COLUMN ON THE RECEIPT. A refund is asynchronous. The
-- API answers PENDING and the real outcome arrives by webhook, minutes or days
-- later; it can also be refused or cancelled after being accepted. So there is
-- a period where a refund exists and has not happened, and the fee book must
-- keep saying paid throughout it. A row that can sit in PENDING and be updated
-- is the honest shape for that. A receipt can also be refunded more than once,
-- in parts.
--
-- refund_id is OURS and deterministic (rf_<voucher>_<paise>): Cashfree rejects
-- a duplicate, and that rejection is the outermost guard against refunding a
-- parent twice because a button was double-clicked or a request retried after a
-- lost response. The primary key here is the same string, so our own table
-- refuses it first.
--
-- fee_paise and surcharge_paise are recorded separately for the same reason
-- they are separate on the checkout: the fee is what reopens the dues when the
-- refund succeeds, and the surcharge is the gateway charge going back to the
-- parent. A parent refunded their fee gets the charge back too — the school is
-- not entitled to keep a payment charge on money it did not keep.

create table if not exists public.cashfree_refunds (
  refund_id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- The Cashfree order the money came in on.
  order_id text not null,
  -- The receipt being reversed. Empty only for a refund against an order that
  -- never produced one, which should not happen and is worth seeing if it does.
  voucher_id text not null default '',
  -- Splits to fee_paise + surcharge_paise; kept as its own column so a query
  -- does not have to trust the two parts to add up.
  amount_paise integer not null,
  fee_paise integer not null default 0,
  surcharge_paise integer not null default 0,
  -- PENDING | PENDING_APPROVAL | ONHOLD | CANCELLED | SUCCESS | FAILED.
  -- Starts at whatever Cashfree answers, which is usually PENDING.
  status text not null default 'PENDING',
  cf_refund_id text not null default '',
  -- Bank reference, once the money has actually moved.
  refund_arn text not null default '',
  reason text not null default '',
  requested_by text not null default '',
  -- Set when the receipt was voided, so a redelivered webhook cannot void it
  -- twice. Distinct from status = SUCCESS: the refund succeeding and the book
  -- being corrected are two events, and the second can fail on its own.
  applied_at timestamptz,
  last_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.cashfree_refunds is
  'Refunds requested from Cashfree. A row may sit in PENDING for days; the fee book only reopens when status is SUCCESS and applied_at is set.';

create index if not exists cashfree_refunds_tenant_order_idx
  on public.cashfree_refunds (tenant_id, order_id);

create index if not exists cashfree_refunds_tenant_voucher_idx
  on public.cashfree_refunds (tenant_id, voucher_id);

-- The sweep for refunds that succeeded but whose receipt was never voided —
-- a webhook that never arrived. Partial so it stays small: the rows that
-- matter are the handful still waiting, not every refund ever made.
create index if not exists cashfree_refunds_unapplied_idx
  on public.cashfree_refunds (tenant_id, status)
  where applied_at is null;

-- Same posture as cashfree_checkouts, whose own migration says why: every new
-- table needs an explicit service_role grant, or the server's writes fail
-- 42501 and the request "succeeds" while storing nothing. For a refund that
-- would mean telling the office the money was sent back with no row to show
-- for it — so this grant is the difference between a refund and a lie.
grant all on public.cashfree_refunds to service_role;

notify pgrst, 'reload schema';
