-- Accounts desk reads 22 tables in parallel on every page load
-- (accountsNormalized.server.ts), each filtered by tenant_id. Only
-- accounts_desk_cash_ledger and accounts_desk_bank_ledger had a
-- tenant_id-covering index — every other table forced a full sequential
-- scan on every load. Add the missing indexes; skip any table/column
-- that doesn't exist so this is safe to run regardless of exact schema
-- drift.

do $$
declare
  t text;
  tables text[] := array[
    'accounts_desk_cash_pools',
    'accounts_desk_bank_accounts',
    'accounts_desk_mode_bank_map',
    'accounts_desk_recon_sessions',
    'accounts_desk_recon_lines',
    'accounts_desk_expense_categories',
    'accounts_desk_expense_vouchers',
    'accounts_desk_expense_voucher_lines',
    'accounts_desk_recurring_rules',
    'accounts_desk_vendors',
    'accounts_desk_vendor_bills',
    'accounts_desk_vendor_bill_lines',
    'accounts_desk_payables',
    'accounts_desk_trustees',
    'accounts_desk_owner_loans',
    'accounts_desk_owner_loan_schedule',
    'accounts_desk_owner_cash_handovers',
    'accounts_desk_coa_accounts',
    'accounts_desk_journal_entries',
    'accounts_desk_journal_lines',
    'accounts_desk_fiscal_years',
    'accounts_desk_settings'
  ];
begin
  foreach t in array tables loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'tenant_id'
    ) then
      execute format(
        'create index if not exists %I on public.%I (tenant_id);',
        t || '_tenant_idx', t
      );
    end if;
  end loop;
end $$;

-- Journal lines are unbounded, append-only history with no date filter on
-- the read side today. A covering index on (tenant_id, updated_at) keeps
-- a future date-ranged query cheap once the read side adds one (see
-- performance audit M-series).
create index if not exists accounts_desk_journal_lines_tenant_updated_idx
  on public.accounts_desk_journal_lines (tenant_id, updated_at desc);
