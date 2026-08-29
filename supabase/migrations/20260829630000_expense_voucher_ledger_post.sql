-- Expense vouchers reach the server book.
--
--   Dr  expense account, per line, from the category's coa_code
--   Cr  cash / bank             for the part actually paid
--   Cr  2000 Accounts Payable   for the part still due
--
-- Splitting the credit is what makes a part-paid voucher truthful: the money
-- that left is on the money account, and what is still owed sits as a payable
-- instead of being pretended away.
--
-- Lines drive the debits so each category lands in its own account. A voucher
-- with no lines falls back to its header category, and anything with no COA
-- mapping goes to 5900 Other Expenses rather than refusing to post — an
-- expense filed imprecisely still has to be filed.

create or replace function public.expense_voucher_ledger_post(
  p_tenant_id uuid, p_voucher_id text, p_actor text default 'system'
) returns text
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_v record; v_l record; v_lines jsonb := '[]'::jsonb; v_code text;
  v_debits bigint := 0; v_result jsonb; v_money text; v_has_lines boolean;
begin
  if not public.inv_ledger_active(p_tenant_id) then return null; end if;

  select * into v_v from public.accounts_desk_expense_vouchers
   where id = p_voucher_id and tenant_id = p_tenant_id;
  if not found then return null; end if;
  if v_v.cancelled_at is not null then return null; end if;
  if coalesce(v_v.grand_total_paise, 0) <= 0 then return null; end if;

  select exists(
    select 1 from public.accounts_desk_expense_voucher_lines
     where voucher_id = p_voucher_id and tenant_id = p_tenant_id and total_paise > 0
  ) into v_has_lines;

  if v_has_lines then
    for v_l in
      select l.*, coalesce(c.coa_code, '') as coa_code
        from public.accounts_desk_expense_voucher_lines l
        left join public.accounts_desk_expense_categories c
               on c.id = coalesce(nullif(l.subcategory_id, ''), l.category_id)
              and c.tenant_id = p_tenant_id
       where l.voucher_id = p_voucher_id and l.tenant_id = p_tenant_id
         and l.total_paise > 0
       order by l.line_index
    loop
      v_code := coalesce(nullif(v_l.coa_code, ''), '5900');
      if not exists (select 1 from public.ledger_accounts
                      where tenant_id = p_tenant_id and code = v_code) then
        v_code := '5900';
      end if;
      v_debits := v_debits + v_l.total_paise;
      v_lines := v_lines || jsonb_build_object(
        'account_code', v_code, 'debit_paise', v_l.total_paise, 'credit_paise', 0,
        'narration', left(coalesce(nullif(v_l.description, ''), v_v.narration, 'Expense'), 180));
    end loop;
  else
    select coalesce(c.coa_code, '') into v_code
      from public.accounts_desk_expense_categories c
     where c.id = v_v.category_id and c.tenant_id = p_tenant_id;
    v_code := coalesce(nullif(v_code, ''), '5900');
    if not exists (select 1 from public.ledger_accounts
                    where tenant_id = p_tenant_id and code = v_code) then
      v_code := '5900';
    end if;
    v_debits := v_v.grand_total_paise;
    v_lines := v_lines || jsonb_build_object(
      'account_code', v_code, 'debit_paise', v_debits, 'credit_paise', 0,
      'narration', left(coalesce(nullif(v_v.narration, ''), 'Expense'), 180));
  end if;

  if v_debits <= 0 then return null; end if;

  v_money := public.accounts_ledger_money_account(
               p_tenant_id, coalesce(v_v.bank_id, ''), coalesce(v_v.pool_id, ''));

  if coalesce(v_v.paid_paise, 0) > 0 then
    v_lines := v_lines || jsonb_build_object(
      'account_code', v_money, 'debit_paise', 0,
      'credit_paise', least(v_v.paid_paise, v_debits),
      'narration', 'Paid — ' || coalesce(v_v.voucher_no, p_voucher_id));
  end if;

  if v_debits - least(coalesce(v_v.paid_paise, 0), v_debits) > 0 then
    v_lines := v_lines || jsonb_build_object(
      'account_code', '2000', 'debit_paise', 0,
      'credit_paise', v_debits - least(coalesce(v_v.paid_paise, 0), v_debits),
      'narration', 'Payable — ' || coalesce(v_v.voucher_no, p_voucher_id));
  end if;

  v_result := public.ledger_post(p_tenant_id, jsonb_build_object(
    'voucher_type', 'payment', 'date', v_v.voucher_date,
    'narration', 'Expense ' || coalesce(v_v.voucher_no, p_voucher_id) ||
                 case when coalesce(v_v.narration,'') <> '' then ' — ' || v_v.narration else '' end,
    'source_type', 'expense_voucher', 'source_id', p_voucher_id,
    'created_by', coalesce(nullif(p_actor,''), v_v.approved_by, 'system'),
    'lines', v_lines));

  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'The books refused expense %: %',
      coalesce(v_v.voucher_no, p_voucher_id),
      coalesce(v_result->>'error', 'unknown ledger error');
  end if;
  return v_result->>'voucher_no';
end;
$function$;

notify pgrst, 'reload schema';
