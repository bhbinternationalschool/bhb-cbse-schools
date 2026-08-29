-- Transport payables reach the server book.
--
-- The chart had 5030 Transport Batta (a staff allowance) and nothing for
-- running the vehicles, so fuel, repairs and insurance would all have fallen
-- into 5900 Other Expenses and told the school nothing.

insert into public.ledger_accounts
  (tenant_id, code, name, parent_code, kind, schedule_group, is_cash, is_bank, is_control, is_active)
select p.tenant_id, x.code, x.name, '5', 'expense', coalesce(p.schedule_group, ''), false, false, false, true
from public.ledger_accounts p
cross join (values
  ('5031', 'Vehicle Fuel'),
  ('5032', 'Vehicle Repair & Maintenance'),
  ('5033', 'Vehicle Insurance & Permits')
) as x(code, name)
where p.code = '5'
  and not exists (select 1 from public.ledger_accounts la
                  where la.tenant_id = p.tenant_id and la.code = x.code);

-- EMI installments are excluded on purpose: an EMI is repayment of borrowing,
-- so its principal relieves a liability and only its interest is an expense.
-- Posting the whole EMI as expense would overstate costs and understate what
-- is still owed.
create or replace function public.transport_payable_expense_account(p_source_type text)
returns text language sql immutable
as $function$
  select case lower(coalesce(p_source_type, ''))
           when 'fuel_refill' then '5031'
           when 'fuel_purchase' then '5031'
           when 'repair_job' then '5032'
           when 'insurance_premium' then '5033'
           when 'certificate_renewal' then '5033'
           else '5900'
         end;
$function$;

create or replace function public.transport_payable_ledger_post(
  p_tenant_id uuid, p_payable_id uuid, p_actor text default 'system'
) returns text
language plpgsql security definer set search_path to 'public'
as $function$
declare v_p record; v_lines jsonb; v_result jsonb; v_money text; v_expense text;
begin
  if not public.inv_ledger_active(p_tenant_id) then return null; end if;

  select * into v_p from public.transport_payables
   where id = p_payable_id and tenant_id = p_tenant_id;
  if not found or coalesce(v_p.amount_paise, 0) <= 0 then return null; end if;
  if lower(coalesce(v_p.source_type, '')) = 'emi_installment' then return null; end if;

  v_expense := public.transport_payable_expense_account(v_p.source_type);

  -- The bill: expense incurred, money owed.
  v_lines := jsonb_build_array(
    jsonb_build_object('account_code', v_expense, 'debit_paise', v_p.amount_paise,
      'credit_paise', 0, 'narration', 'Transport — ' || coalesce(v_p.source_type, 'expense')),
    jsonb_build_object('account_code', '2000', 'debit_paise', 0,
      'credit_paise', v_p.amount_paise, 'narration', 'Transport payable'));

  v_result := public.ledger_post(p_tenant_id, jsonb_build_object(
    'voucher_type', 'purchase',
    'date', coalesce(v_p.due_on, v_p.created_at::date),
    'narration', 'Transport ' || coalesce(v_p.source_type, 'payable'),
    'source_type', 'transport_payable', 'source_id', p_payable_id::text,
    'created_by', p_actor, 'lines', v_lines));
  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'The books refused transport payable %: %',
      p_payable_id, coalesce(v_result->>'error', 'unknown ledger error');
  end if;

  -- The settlement, as its own voucher so a part payment posts when it
  -- happens rather than waiting for the bill to be fully paid.
  if coalesce(v_p.paid_paise, 0) > 0 then
    v_money := public.accounts_ledger_money_account(
                 p_tenant_id, coalesce(v_p.paid_bank_account_id, ''), coalesce(v_p.paid_pool_id, ''));
    v_result := public.ledger_post(p_tenant_id, jsonb_build_object(
      'voucher_type', 'payment',
      'date', coalesce(v_p.paid_on, v_p.due_on, v_p.created_at::date),
      'narration', 'Transport payable settled',
      'source_type', 'transport_payable_payment', 'source_id', p_payable_id::text,
      'created_by', p_actor,
      'lines', jsonb_build_array(
        jsonb_build_object('account_code','2000','debit_paise',v_p.paid_paise,
                           'credit_paise',0,'narration','Transport payable settled'),
        jsonb_build_object('account_code',v_money,'debit_paise',0,
                           'credit_paise',v_p.paid_paise,'narration','Paid'))));
    if not coalesce((v_result->>'ok')::boolean, false) then
      raise exception 'The books refused the transport payment for %: %',
        p_payable_id, coalesce(v_result->>'error', 'unknown ledger error');
    end if;
  end if;

  return v_result->>'voucher_no';
end;
$function$;

notify pgrst, 'reload schema';
