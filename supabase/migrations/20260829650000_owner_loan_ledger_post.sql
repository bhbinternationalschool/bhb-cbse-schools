-- Owner / trustee loans reach the server book.
--
-- All owner loans are money a trustee lends TO the school (loan_type is the
-- purpose — working capital, vehicle, capex — not a direction), so:
--
--   Disbursement   Dr cash / bank        Cr 2100 Owner / Trustee Loans
--   Repayment      Dr 2100 (principal)
--                  Dr 5090 (interest)    Cr cash / bank
--
-- Splitting principal from interest is the whole point. Posting a whole
-- installment against 2100 would show the loan clearing faster than it is;
-- posting it all as expense would overstate costs — the school would be told
-- it is paying for something it is actually still borrowing.

insert into public.ledger_accounts
  (tenant_id, code, name, parent_code, kind, schedule_group, is_cash, is_bank, is_control, is_active)
select p.tenant_id, '5090', 'Interest Expense', '5', 'expense',
       coalesce(p.schedule_group, ''), false, false, false, true
from public.ledger_accounts p
where p.code = '5'
  and not exists (select 1 from public.ledger_accounts la
                  where la.tenant_id = p.tenant_id and la.code = '5090');

create or replace function public.owner_loan_ledger_post(
  p_tenant_id uuid, p_loan_id text, p_actor text default 'system'
) returns text
language plpgsql security definer set search_path to 'public'
as $function$
declare v_loan record; v_result jsonb; v_money text;
begin
  if not public.inv_ledger_active(p_tenant_id) then return null; end if;

  select * into v_loan from public.accounts_desk_owner_loans
   where id = p_loan_id and tenant_id = p_tenant_id;
  if not found or coalesce(v_loan.principal_paise, 0) <= 0 then return null; end if;

  v_money := public.accounts_ledger_money_account(
               p_tenant_id, coalesce(v_loan.bank_account_id, ''), coalesce(v_loan.pool_id, ''));

  v_result := public.ledger_post(p_tenant_id, jsonb_build_object(
    'voucher_type', 'receipt', 'date', v_loan.start_date,
    'narration', 'Trustee loan received — ' || coalesce(v_loan.loan_type, 'loan'),
    'source_type', 'owner_loan', 'source_id', p_loan_id, 'created_by', p_actor,
    'lines', jsonb_build_array(
      jsonb_build_object('account_code', v_money, 'debit_paise', v_loan.principal_paise,
                         'credit_paise', 0, 'narration', 'Loan received'),
      jsonb_build_object('account_code', '2100', 'debit_paise', 0,
                         'credit_paise', v_loan.principal_paise,
                         'narration', 'Owed to trustee'))));
  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'The books refused trustee loan %: %',
      p_loan_id, coalesce(v_result->>'error', 'unknown ledger error');
  end if;
  return v_result->>'voucher_no';
end;
$function$;

-- A repayment is its own voucher, keyed on the installment, so a schedule can
-- be paid one row at a time and each payment is independently reversible.
create or replace function public.owner_loan_installment_ledger_post(
  p_tenant_id uuid, p_schedule_id text, p_actor text default 'system'
) returns text
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_row record; v_paid bigint; v_interest bigint; v_principal bigint;
  v_money text; v_lines jsonb; v_result jsonb;
begin
  if not public.inv_ledger_active(p_tenant_id) then return null; end if;

  select * into v_row from public.accounts_desk_owner_loan_schedule
   where id = p_schedule_id and tenant_id = p_tenant_id;
  if not found then return null; end if;

  v_paid := coalesce(nullif(v_row.paid_amount_paise, 0), 0);
  if v_paid <= 0 then return null; end if;  -- nothing paid yet

  v_interest := least(coalesce(v_row.interest_paise, 0), v_paid);
  v_principal := v_paid - v_interest;

  v_money := public.accounts_ledger_money_account(
               p_tenant_id, coalesce(v_row.paid_bank_account_id, ''), coalesce(v_row.paid_pool_id, ''));

  v_lines := '[]'::jsonb;
  if v_principal > 0 then
    v_lines := v_lines || jsonb_build_object('account_code', '2100',
      'debit_paise', v_principal, 'credit_paise', 0, 'narration', 'Loan principal repaid');
  end if;
  if v_interest > 0 then
    v_lines := v_lines || jsonb_build_object('account_code', '5090',
      'debit_paise', v_interest, 'credit_paise', 0, 'narration', 'Loan interest');
  end if;
  v_lines := v_lines || jsonb_build_object('account_code', v_money,
    'debit_paise', 0, 'credit_paise', v_paid,
    'narration', 'Installment ' || coalesce(v_row.installment_no::text, ''));

  v_result := public.ledger_post(p_tenant_id, jsonb_build_object(
    'voucher_type', 'payment', 'date', coalesce(v_row.paid_on, v_row.due_on),
    'narration', 'Trustee loan installment ' || coalesce(v_row.installment_no::text, ''),
    'source_type', 'owner_loan_installment', 'source_id', p_schedule_id,
    'created_by', p_actor, 'lines', v_lines));

  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'The books refused loan installment %: %',
      p_schedule_id, coalesce(v_result->>'error', 'unknown ledger error');
  end if;
  return v_result->>'voucher_no';
end;
$function$;

notify pgrst, 'reload schema';
