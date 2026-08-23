-- Inventory parity must not cry wolf at a school that has no ledger yet.
--
-- `inv_inventory_parity` compares stock on the shelf against account 1090.
-- A school that has not seeded a chart of accounts has no 1090 at all, so the
-- books read zero and the difference comes back as the ENTIRE stock value —
-- which the Reports screen then showed in red as "needs looking at". Nothing
-- is wrong in that case: sales deliberately skip posting until the ledger is
-- opened (`inv_ledger_active`), so empty books are the designed state, not a
-- discrepancy.
--
-- This was invisible in production, which has 42 accounts seeded and so always
-- took the true branch. It only appeared when the whole migration set was
-- applied to an empty database on 2026-08-24.
--
-- The arithmetic is left honest — the difference still reports what it really
-- is. What was missing is the fact needed to interpret it, so the caller can
-- tell "the books disagree" from "there are no books yet".

create or replace function public.inv_inventory_parity(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with ledger_value as (
    select coalesce((
      select sum(l.debit_paise) - sum(l.credit_paise)
        from public.ledger_lines l
        join public.ledger_accounts a on a.id = l.account_id
       where a.tenant_id = p_tenant_id and a.code = '1090'
    ), 0) as paise
  ),
  stock_value as (
    select public.inv_stock_value_as_of(p_tenant_id, current_date) as paise
  )
  select jsonb_build_object(
    'stock_value_paise', s.paise,
    'ledger_value_paise', v.paise,
    'difference_paise', s.paise - v.paise,
    -- False means postings are switched off for want of a chart of accounts,
    -- so a difference is expected and must not be reported as a fault.
    'ledger_active', public.inv_ledger_active(p_tenant_id)
  )
  from stock_value s, ledger_value v;
$$;

grant execute on function public.inv_inventory_parity(uuid) to service_role;

notify pgrst, 'reload schema';
