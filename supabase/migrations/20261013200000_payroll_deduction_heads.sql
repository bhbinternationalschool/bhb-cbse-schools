-- Payroll deductions posted to the right heads (13 Oct 2026).
--
-- payroll_ledger_post put every deduction that was not PF/ESI/advance into
-- 2300 Statutory Dues — the group heading, as a liability to the government:
--   * loss of pay, whenever a line's LWP component and attendance column
--     disagreed (the run-wide check then dropped LWP altogether);
--   * a special deduction that was an advance recovery ("old advance").
-- Four runs were corrected in the book by journal on 13 Oct (JV/FY2026-27/
-- 00119–00121, PY/FY2026-27/00681). This replaces the function so new runs
-- post loss of pay as reduced Salary & Wages and advance recoveries against
-- 1070 Staff Advances. Only the deduction split changes; the payment leg,
-- wallet booking, overlap guard and idempotency are as in
-- 20261010210000_payroll_wallet_booking.sql. Already-posted runs are not
-- re-posted (ledger_post is idempotent on source).

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
  m record; v_bank text; v_code text; v_paid date; v_wallet numeric; v_adv_special numeric;
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

  -- Loss of pay and advance recoveries, line by line (13 Oct 2026).
  --
  -- The run-wide sums above compared the LWP column with total deductions
  -- for the whole run. When a line's LWP COMPONENT (what was actually
  -- deducted) differed from its attendance LWP column, the run gave up on
  -- LWP entirely and every rupee of it landed in 2300 Statutory Dues as if
  -- owed to the government, overstating salary expense (Prashant Dev,
  -- Devendra Kumar Pandey, May 2026). Per line, the expense is reduced by
  -- what was deducted as LWP, never by more than attendance supports; any
  -- excess stays "other deductions withheld" (Anjali Mishra, April 2026:
  -- an earlier UPI payment folded into the LWP figure).
  --
  -- A special deduction labelled as an advance is an advance recovered and
  -- reduces 1070 Staff Advances, not Statutory Dues (Deepak, April 2026:
  -- "old advance"). It does not reduce the advance register on the Staff
  -- advances desk: recoveries meant to be tracked there belong in the
  -- line's Advance deduction, which is capped by what is outstanding.
  select coalesce(sum(x.lwp), 0), coalesce(sum(x.adv_special), 0)
    into v_lwp, v_adv_special
    from public.payroll_desk_run_lines l
    cross join lateral (
      select coalesce(sum(case when (c->>'amount') ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$'
                               then (c->>'amount')::numeric end)
               filter (where c->>'kind' = 'deduction' and c->>'headCode' = 'LWP'), 0) as comp
        from jsonb_array_elements(coalesce(l.components, '[]'::jsonb)) c
    ) lc
    cross join lateral (
      select case
               when lc.comp > 0 and coalesce(l.lwp_deduction, 0) > 0 then least(lc.comp, l.lwp_deduction)
               when lc.comp > 0 then lc.comp
               else coalesce(l.lwp_deduction, 0)
             end as lwp,
             case
               when coalesce(l.special_deduction, 0) > 0
                -- Only a label that names an advance being recovered:
                -- "advance", "old advance", "staff/salary advance",
                -- "advance recovery/recovered/deduction". Not "advance
                -- tax", "no advance", or a sentence that mentions one.
                and coalesce(l.special_deduction_label, '')
                    ~* '^\s*(old\s+)?((staff|salary)\s+)?advance(\s+(recovery|recovered|deduction|deducted))?\s*$'
               then l.special_deduction else 0
             end as adv_special
    ) x
   where l.run_id = p_run_id and l.tenant_id = p_tenant_id;
  v_adv := v_adv + v_adv_special;
  v_special := v_special - v_adv_special;

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
