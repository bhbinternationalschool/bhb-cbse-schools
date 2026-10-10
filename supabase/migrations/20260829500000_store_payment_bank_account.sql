-- Where store money actually landed.
--
-- A store payment recorded only its mode ("upi"), never which bank account
-- received it, so a UPI collection could not be reconciled against any
-- statement — the accounts desk knew money came in by UPI but not into which
-- of the school's accounts. Fee Take has captured mode + account since the
-- payment-channel work; the store and registration counters had not caught up.
--
-- Nullable and defaulted to '' rather than backfilled: payments taken before
-- this column existed genuinely have no account on record, and inventing one
-- would be worse than leaving the gap visible to whoever reconciles.

alter table public.inv_sale_payments
  add column if not exists bank_account_id text not null default '';

comment on column public.inv_sale_payments.bank_account_id is
  'Accounts-desk bank account that received this payment. Empty for cash, and for payments taken before 2026-08-29.';

notify pgrst, 'reload schema';
