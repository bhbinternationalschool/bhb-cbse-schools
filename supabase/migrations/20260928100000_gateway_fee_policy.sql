-- Who bears the payment-gateway fee, and what a parent was actually charged.
--
-- Two additions, and they answer different questions.
--
-- accounts_desk_settings.gateway_fee_policy is the school's standing decision:
-- which rails the parent pays the fee on, at what configured rate, and the GST
-- on it. One row per tenant, beside pg_settlement_bank_account_id, because it
-- is the same kind of thing — an instruction the accounts desk owns.
--
-- Empty jsonb is not "unconfigured, guess something". It means the school
-- absorbs the fee on every rail, which is exactly what happens today, so this
-- migration changes nothing for any parent until somebody sets it deliberately.
-- Adding a charge on top of a CBSE-regulated fee has a regulator and a GST
-- treatment attached; a default is the wrong way to arrive at it.
--
-- cashfree_checkouts.surcharge_paise is what one parent was charged on one
-- order. It is kept SEPARATE from amount_paise rather than added into it:
-- amount_paise is the fee due and the receipt is written for exactly that,
-- and the settlement path compares Cashfree's paid amount against it to refuse
-- a receipt for the wrong money. Folding the surcharge in would make every
-- surcharged payment look like a mismatch.
--
-- The gateway then holds amount_paise + surcharge_paise, which is why the fee
-- receipt debits clearing with both — the settlement journal credits clearing
-- with Cashfree's gross, and a receipt that debited only the fee would drive
-- clearing negative by the surcharge on every single online payment.

alter table public.accounts_desk_settings
  add column if not exists gateway_fee_policy jsonb not null default '{}'::jsonb;

comment on column public.accounts_desk_settings.gateway_fee_policy is
  'Who bears the gateway fee, per rail, with the configured rates. Empty object means the school absorbs it everywhere — today''s behaviour.';

alter table public.cashfree_checkouts
  add column if not exists surcharge_paise integer not null default 0;

comment on column public.cashfree_checkouts.surcharge_paise is
  'Gateway fee passed on to the parent, on top of amount_paise. Cashfree collected the sum of the two; the receipt is for amount_paise alone.';

-- The rail the parent chose, when they chose one. Recorded so the quote can be
-- compared against what the settlement recon says the fee really was: a rail
-- whose configured rate is too low loses money on every payment, and without
-- knowing which rail was used there is no way to see which one.
alter table public.cashfree_checkouts
  add column if not exists method_group text not null default '';

comment on column public.cashfree_checkouts.method_group is
  'Payment rail the surcharge was quoted for (upi, credit_card, emi, ...). Empty when the parent had no picker, e.g. a WhatsApp pay-link.';
