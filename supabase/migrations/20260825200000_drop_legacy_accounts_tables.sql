-- Accounts redesign phase C: drop the dead 2026-07 accounts_* tables.
--
-- These 19 tables were the first attempt at normalized accounts storage
-- (migration 20260715), superseded first by the accounts_desk_* sync and now
-- by the Ledger v2 book. Verified on 2026-08-25: every one holds ZERO rows in
-- production and none is referenced anywhere in the codebase.
--
-- NOT dropped, deliberately:
--   · accounts_state        — the desk blob store, still the persistence for
--                             the remaining legacy tabs (Masters, Bills & AP,
--                             Owner loans, Day close) until phase C completes
--   · accounts_desk_*       — same reason; they go when the last legacy tab
--                             does, with the parity report at zero
--
-- Each drop is guarded: a table that unexpectedly holds rows is SKIPPED with
-- a notice instead of destroyed — the audit said empty, and this migration
-- refuses to trust that claim over a live count.

do $$
declare
  t text;
  n bigint;
begin
  foreach t in array array[
    'accounts_bank_ledger',
    'accounts_cash_ledger',
    'accounts_journal_lines',
    'accounts_journal_entries',
    'accounts_expense_vouchers',
    'accounts_vendor_bills',
    'accounts_payables',
    'accounts_owner_loan_schedule',
    'accounts_owner_cash_handovers',
    'accounts_owner_loans',
    'accounts_recurring_rules',
    'accounts_mode_bank_map',
    'accounts_bank_accounts',
    'accounts_cash_pools',
    'accounts_expense_categories',
    'accounts_coa',
    'accounts_fiscal_years',
    'accounts_trustees',
    'accounts_vendors'
  ]
  loop
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) then
      execute format('select count(*) from public.%I', t) into n;
      if n = 0 then
        execute format('drop table public.%I cascade', t);
        raise notice 'dropped empty legacy table %', t;
      else
        raise warning 'SKIPPED %: holds % row(s) — investigate before dropping', t, n;
      end if;
    end if;
  end loop;
end
$$;

notify pgrst, 'reload schema';
