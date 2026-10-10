-- Salaries paid from the Cashfree Payouts wallet are booked from the wallet
-- (director, 10 Oct 2026: "close it also").
--
-- The salary payment voucher (payroll_ledger_post, source payroll_payment)
-- grouped every line by payment_mode and credited the bank or cash account
-- that mode maps to. A salary sent by Pay via Cashfree or by a Cashgram pay
-- link never touched the bank — it left the prefunded Payouts wallet — so the
-- bank book would show money going out that the bank statement never shows,
-- and the wallet would never come down.
--
-- Now a line is WALLET-PAID when the server's own records say so, never the
-- screen:
--   - a recorded UTR from source 'payout' (Pay via Cashfree) or 'cashgram'
--     (a collected pay link) against that salary line, or
--   - a live staff Cashgram for it (sent, collecting, or collected without a
--     UTR) — the money is leaving the wallet, not the bank.
-- Those lines credit 1110 Cashfree Payouts Wallet; every other line is booked
-- exactly as before.
--
-- 1110 is created here for every tenant whose chart is installed, so neither
-- this posting nor the fee-refund journal (#530) waits for an ensure-masters
-- run. The payroll trigger swallows errors, so a missing account would
-- otherwise drop the payment voucher without a word.
--
-- Vouchers already posted are untouched: ledger_post is keyed on
-- (source_type, source_id) and answers created=false for a run already in the
-- book. No wallet payment had been made when this was written.

insert into public.ledger_accounts (tenant_id, code, name, parent_code, kind, schedule_group, is_cash, is_bank, is_control)
select distinct a.tenant_id, '1110', 'Cashfree Payouts Wallet', '1', 'asset', 'Current assets', false, false, false
  from public.ledger_accounts a
 where a.code = '1000'
   and not exists (
     select 1 from public.ledger_accounts b where b.tenant_id = a.tenant_id and b.code = '1110'
   );

-- One place says what wallet-paid means, so the voucher and anything that
-- later reports on it cannot disagree.
create or replace function public.payroll_line_wallet_paid(p_tenant_id uuid, p_run_id text, p_staff_id text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
           select 1 from public.upi_payment_proofs u
            where u.tenant_id = p_tenant_id
              and u.status = 'recorded'
              and u.source in ('payout', 'cashgram')
              and u.target_kind = 'payroll_line'
              and u.target_id = p_run_id || '|' || p_staff_id
         )
      or exists (
           select 1 from public.cashgram_refunds c
            where c.tenant_id = p_tenant_id
              and c.purpose = 'staff_pay'
              and c.target_kind = 'payroll_line'
              and c.target_id = p_run_id || '|' || p_staff_id
              and c.status in ('SENDING', 'UNKNOWN', 'ACTIVE', 'REDEEMING', 'REDEEMED')
         );
$$;
grant execute on function public.payroll_line_wallet_paid(uuid, text, text) to service_role;

CREATE OR REPLACE FUNCTION public.payroll_ledger_post(p_tenant_id uuid, p_run_id text, p_actor text DEFAULT 'system'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_run record; v_status text; v_month_end date; v_overlap int; v_reclassed int; n_lines int;
  v_gross numeric; v_net numeric; v_payable numeric; v_adv numeric; v_lwp numeric; v_late numeric;
  v_special numeric; v_total_ded numeric; v_pf_govt numeric; v_esi_govt numeric;
  v_pf_ee numeric; v_pf_er numeric; v_esi_ee numeric; v_esi_er numeric; v_rest numeric;
  v_lines jsonb; v_res jsonb; v_accrual jsonb; v_payment jsonb; v_created_by text;
  m record; v_bank text; v_code text; v_paid date; v_wallet numeric;
begin
  if not public.inv_ledger_active(p_tenant_id) then
    return jsonb_build_object('ok', false, 'refused', 'ledger not active for this tenant');
  end if;
  select * into v_run from public.payroll_desk_runs where id = p_run_id and tenant_id = p_tenant_id;
  if not found then return jsonb_build_object('ok', false, 'refused', 'no such payroll run'); end if;
  v_status := lower(coalesce(v_run.status, ''));
  if v_status not in ('posted', 'paid') then
    return jsonb_build_object('ok', true, 'skipped', 'run is ' || coalesce(nullif(v_status, ''), 'draft'));
  end if;
  if coalesce(v_run.month, '') !~ '^\d{4}-\d{2}$' then
    return jsonb_build_object('ok', false, 'refused', 'run has no usable month');
  end if;
  v_month_end := (to_date(v_run.month || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date;
  v_created_by := coalesce(nullif(p_actor, ''), nullif(v_run.posted_by, ''), nullif(v_run.approved_by, ''), 'system');

  select count(*), count(*) filter (where reclassified)
    into v_overlap, v_reclassed
    from public.payroll_ledger_overlap(p_tenant_id, v_run.month);
  if v_overlap > v_reclassed then
    raise exception 'Payroll %: % reconstructed salary voucher(s) dated the following month would be counted twice. Reclassify them first (Accounts → Server book → Payroll in the book).',
      v_run.month, v_overlap - v_reclassed;
  end if;

  select count(*), coalesce(sum(gross), 0), coalesce(sum(net_pay), 0),
         coalesce(sum(coalesce(amount_payable, net_pay)), 0), coalesce(sum(advance_deduct), 0),
         coalesce(sum(lwp_deduction), 0), coalesce(sum(late_penalty), 0), coalesce(sum(special_deduction), 0),
         coalesce(sum(total_deductions), 0), coalesce(sum(pf_govt_deposit), 0), coalesce(sum(esic_govt_deposit), 0)
    into n_lines, v_gross, v_net, v_payable, v_adv, v_lwp, v_late, v_special, v_total_ded, v_pf_govt, v_esi_govt
    from public.payroll_desk_run_lines where run_id = p_run_id and tenant_id = p_tenant_id;
  if n_lines = 0 then return jsonb_build_object('ok', false, 'refused', 'run has no staff lines'); end if;
  if v_gross <= 0 then return jsonb_build_object('ok', false, 'refused', 'run has no gross pay'); end if;

  select coalesce(sum(case when c->>'kind' = 'deduction' and c->>'headCode' = 'PF_EE' then (c->>'amount')::numeric end), 0),
         coalesce(sum(case when c->>'kind' = 'employer'  and c->>'headCode' = 'PF_ER' then (c->>'amount')::numeric end), 0),
         coalesce(sum(case when c->>'kind' = 'deduction' and c->>'headCode' in ('ESIC_EE', 'ESI_EE') then (c->>'amount')::numeric end), 0),
         coalesce(sum(case when c->>'kind' = 'employer'  and c->>'headCode' in ('ESIC_ER', 'ESI_ER') then (c->>'amount')::numeric end), 0)
    into v_pf_ee, v_pf_er, v_esi_ee, v_esi_er
    from public.payroll_desk_run_lines l, jsonb_array_elements(coalesce(l.components, '[]'::jsonb)) c
   where l.run_id = p_run_id and l.tenant_id = p_tenant_id;
  if v_pf_ee + v_pf_er = 0 and v_pf_govt > 0 then v_pf_er := v_pf_govt; end if;
  if v_esi_ee + v_esi_er = 0 and v_esi_govt > 0 then v_esi_er := v_esi_govt; end if;

  v_rest := v_total_ded - v_pf_ee - v_esi_ee - v_adv - v_special - v_lwp - v_late;
  if v_rest < 0 then
    v_lwp := 0; v_late := 0;
    v_rest := v_total_ded - v_pf_ee - v_esi_ee - v_adv - v_special;
  end if;
  if v_rest < 0 or v_gross - v_total_ded <> v_net then
    return jsonb_build_object('ok', false, 'refused',
      format('run %s: gross %s, deductions %s and net %s do not agree', v_run.month, v_gross, v_total_ded, v_net));
  end if;

  v_lines := jsonb_build_array(jsonb_build_object(
    'account_code', '5070', 'debit_paise', round((v_gross - v_lwp - v_late) * 100), 'credit_paise', 0,
    'narration', 'Salary & wages ' || v_run.month, 'cost_centre_code', 'school'));
  if v_pf_er + v_esi_er > 0 then v_lines := v_lines || jsonb_build_object(
    'account_code', '5070', 'debit_paise', round((v_pf_er + v_esi_er) * 100), 'credit_paise', 0,
    'narration', 'Employer PF & ESI ' || v_run.month, 'cost_centre_code', 'school'); end if;
  if v_adv > 0 then v_lines := v_lines || jsonb_build_object(
    'account_code', '1070', 'debit_paise', 0, 'credit_paise', round(v_adv * 100),
    'narration', 'Advances recovered'); end if;
  if v_pf_ee + v_pf_er > 0 then v_lines := v_lines || jsonb_build_object(
    'account_code', '2320', 'debit_paise', 0, 'credit_paise', round((v_pf_ee + v_pf_er) * 100),
    'narration', 'PF payable — employee ' || v_pf_ee || ' + employer ' || v_pf_er); end if;
  if v_esi_ee + v_esi_er > 0 then v_lines := v_lines || jsonb_build_object(
    'account_code', '2330', 'debit_paise', 0, 'credit_paise', round((v_esi_ee + v_esi_er) * 100),
    'narration', 'ESI payable — employee ' || v_esi_ee || ' + employer ' || v_esi_er); end if;
  if v_special + v_rest > 0 then v_lines := v_lines || jsonb_build_object(
    'account_code', '2300', 'debit_paise', 0, 'credit_paise', round((v_special + v_rest) * 100),
    'narration', 'Other deductions withheld'); end if;
  v_lines := v_lines || jsonb_build_object(
    'account_code', '2110', 'debit_paise', 0, 'credit_paise', round(v_net * 100),
    'narration', 'Net payable ' || v_run.month);

  v_res := public.ledger_post(p_tenant_id, jsonb_build_object(
    'voucher_type', 'payroll', 'date', v_month_end,
    'narration', 'Payroll ' || v_run.month || ' — ' || n_lines || ' staff',
    'source_type', 'payroll_run', 'source_id', p_run_id,
    'created_by', v_created_by, 'lines', v_lines));
  if not coalesce((v_res->>'ok')::boolean, false) then
    raise exception 'The books refused payroll %: %', v_run.month, coalesce(v_res->>'error', 'unknown ledger error');
  end if;
  v_accrual := jsonb_build_object('voucher_no', v_res->>'voucher_no', 'created', coalesce((v_res->>'created')::boolean, false));

  v_payment := null;
  if v_status = 'paid' and v_run.paid_at is not null then
    if v_reclassed > 0 then
      v_payment := jsonb_build_object('skipped',
        'the salary payments for this month are already in the book as reclassified reconstruction');
    elsif v_payable > 0 then
      v_paid := (v_run.paid_at at time zone 'Asia/Kolkata')::date;
      v_lines := jsonb_build_array(jsonb_build_object(
        'account_code', '2110', 'debit_paise', round(v_payable * 100), 'credit_paise', 0,
        'narration', 'Net payable ' || v_run.month));

      -- Wallet-paid lines first: they left the Payouts wallet, not a bank.
      select coalesce(sum(coalesce(amount_payable, net_pay)), 0) into v_wallet
        from public.payroll_desk_run_lines
       where run_id = p_run_id and tenant_id = p_tenant_id
         and public.payroll_line_wallet_paid(p_tenant_id, p_run_id, staff_id);
      if v_wallet > 0 then
        v_lines := v_lines || jsonb_build_object(
          'account_code', '1110', 'debit_paise', 0, 'credit_paise', round(v_wallet * 100),
          'narration', 'Salary paid from the Cashfree Payouts wallet');
      end if;

      for m in
        select lower(coalesce(nullif(payment_mode, ''), 'bank_transfer')) as mode,
               sum(coalesce(amount_payable, net_pay)) as amt
          from public.payroll_desk_run_lines
         where run_id = p_run_id and tenant_id = p_tenant_id
           and not public.payroll_line_wallet_paid(p_tenant_id, p_run_id, staff_id)
         group by 1 having sum(coalesce(amount_payable, net_pay)) > 0
      loop
        if m.mode = 'cash' then
          v_code := '1000'; v_bank := '';
        else
          select bank_id into v_bank from public.accounts_desk_mode_bank_map
           where tenant_id = p_tenant_id and mode = m.mode;
          if v_bank is null then
            select bank_id into v_bank from public.accounts_desk_mode_bank_map
             where tenant_id = p_tenant_id and mode in ('neft', 'upi', 'rtgs') order by mode limit 1;
          end if;
          v_code := case when v_bank is null then '1010'
                         else public.accounts_ledger_money_account(p_tenant_id, v_bank, '') end;
        end if;
        v_lines := v_lines || jsonb_build_object(
          'account_code', v_code, 'debit_paise', 0, 'credit_paise', round(m.amt * 100),
          'narration', 'Salary disbursed by ' || m.mode,
          'subledger_kind', case when v_code not in ('1000', '1010') and coalesce(v_bank, '') <> '' then 'bank_account' else '' end,
          'subledger_id', case when v_code not in ('1000', '1010') then coalesce(v_bank, '') else '' end);
      end loop;
      v_res := public.ledger_post(p_tenant_id, jsonb_build_object(
        'voucher_type', 'payment', 'date', v_paid,
        'narration', 'Salary paid ' || v_run.month,
        'source_type', 'payroll_payment', 'source_id', p_run_id,
        'created_by', coalesce(nullif(v_run.paid_by, ''), v_created_by), 'lines', v_lines));
      if not coalesce((v_res->>'ok')::boolean, false) then
        raise exception 'The books refused the salary payment for %: %', v_run.month, coalesce(v_res->>'error', 'unknown ledger error');
      end if;
      v_payment := jsonb_build_object('voucher_no', v_res->>'voucher_no', 'created', coalesce((v_res->>'created')::boolean, false));
    end if;
  end if;

  return jsonb_build_object('ok', true, 'month', v_run.month, 'accrual', v_accrual, 'payment', v_payment);
end;
$function$;

notify pgrst, 'reload schema';
