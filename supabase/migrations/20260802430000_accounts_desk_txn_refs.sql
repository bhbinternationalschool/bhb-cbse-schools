-- Accounts desk — transaction refs on cash/bank ledger + expense payment splits

alter table public.accounts_desk_cash_ledger
  add column if not exists transaction_ref text not null default '';

alter table public.accounts_desk_bank_ledger
  add column if not exists transaction_ref text not null default '';

alter table public.accounts_desk_expense_vouchers
  add column if not exists payment_splits jsonb not null default '[]'::jsonb;
