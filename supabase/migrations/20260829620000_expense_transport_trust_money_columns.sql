-- Record which account the money moved through.
--
-- Expense vouchers already carry bank_id and pool_id. Transport payables and
-- owner/trust loans record only that they were paid, not from where — the
-- same gap the store had, and it makes a ledger posting impossible to route.
-- Added before these features are used, so nothing needs backfilling later.

alter table public.transport_payables
  add column if not exists paid_bank_account_id text not null default '',
  add column if not exists paid_pool_id text not null default '';

alter table public.accounts_desk_owner_loans
  add column if not exists bank_account_id text not null default '',
  add column if not exists pool_id text not null default '';

alter table public.accounts_desk_owner_loan_schedule
  add column if not exists paid_bank_account_id text not null default '',
  add column if not exists paid_pool_id text not null default '',
  add column if not exists interest_paise bigint not null default 0;

comment on column public.accounts_desk_owner_loan_schedule.interest_paise is
  'Interest portion of the installment. The remainder is principal, which is what relieves the 2100 liability.';

-- One place that turns "which bank / which cash pool" into a ledger account,
-- shared by every bridge so they cannot drift apart.
create or replace function public.accounts_ledger_money_account(
  p_tenant_id uuid, p_bank_account_id text, p_pool_id text
) returns text
language plpgsql stable
as $function$
declare v_code text;
begin
  if coalesce(p_bank_account_id, '') <> '' then
    select code into v_code from public.ledger_accounts
     where tenant_id = p_tenant_id and bank_account_id = p_bank_account_id and is_active;
    if v_code is not null then return v_code; end if;
    -- A bank we know moved the money but have no ledger account for: the
    -- group, not cash. Booking it to cash would be a lie about the drawer.
    return '1010';
  end if;
  if coalesce(p_pool_id, '') <> '' then return '1000'; end if;
  -- Nothing said. Cash is safer than a bank here: an unbanked payment at a
  -- school counter is overwhelmingly cash, and it shows up in the physical
  -- count, where a wrong bank line would not.
  return '1000';
end;
$function$;

notify pgrst, 'reload schema';
