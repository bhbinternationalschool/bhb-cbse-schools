/* ─── Payroll reaches the server book on its own ─────────────────────────
   A posted payroll run is the school's largest expense, and until now it
   reached the ledger only when somebody pressed "Run projection" — and that
   projection read the run lines as paise when they are stored in rupees, so
   it would have booked the July run at one hundredth of its value.

   This is the one implementation from now on. The trigger below posts a run
   the moment it is saved as posted (accrual, at month end) or paid (payment,
   on the paid date); the TypeScript projection calls the same function, so
   the two can never disagree and ledger_post's idempotency on
   (source_type, source_id) means a replay lands exactly once.

   THE OVERLAP GUARD. Salary for April–August 2026 was reconstructed into the
   ledger from the old ERP and the Google Pay statement as per-staff payment
   vouchers (Dr 5070 / Cr bank, source old_erp_import or gpay_backfill). A run
   posted on top of those would count the same salary twice. A reconstructed
   salary voucher is attributed to the salary month BEFORE its date — salary is
   paid in arrears — so run M overlaps the reconstructed vouchers dated in the
   month after M. The guard refuses to post the accrual while any of those is
   unreclassified.

   Reclassification, not reversal: the money really left the bank on those
   dates and the recon needs those lines. For each reconstructed voucher a
   journal on its own date moves the expense and withholding out (Cr 5070,
   Dr 2320/2330/1070) and books the money leg as a settlement of Salary
   Payable (Dr 2110). What remains of the old voucher is "Dr 2110 / Cr bank":
   a salary payment. The run's accrual then books the expense once, and the
   run's own payment voucher is SKIPPED for a month whose payments were
   reconstructed, because they are already in the book.                  */

-- Reconstructed salary vouchers a run for p_month would double-count.
create or replace function public.payroll_ledger_overlap(p_tenant_id uuid, p_month text)
returns table (
  voucher_id uuid, voucher_no text, voucher_date date, source_type text,
  narration text, salary_paise bigint, reclassified boolean, mixed boolean
)
language sql stable security definer set search_path = public
as $$
  with win as (
    select (to_date(p_month || '-01', 'YYYY-MM-DD') + interval '1 month')::date as from_d,
           (to_date(p_month || '-01', 'YYYY-MM-DD') + interval '2 month' - interval '1 day')::date as to_d
  ),
  sal as (
    select v.id, v.voucher_no, v.voucher_date, v.source_type, v.narration,
           coalesce(sum(l.debit_paise - l.credit_paise) filter (where a.code = '5070'), 0)::bigint as salary_paise,
           bool_or(a.code not in ('5070','1000','1010','1011','1012','1013','1070','2110','2300','2310','2320','2330')) as mixed
      from public.ledger_vouchers v
      join public.ledger_lines l on l.voucher_id = v.id
      join public.ledger_accounts a on a.id = l.account_id
      cross join win
     where v.tenant_id = p_tenant_id
       and v.source_type in ('old_erp_import', 'gpay_backfill')
       and v.voucher_type <> 'reversal'
       and v.voucher_date between win.from_d and win.to_d
       and not exists (select 1 from public.ledger_vouchers r where r.reverses_voucher_id = v.id)
     group by v.id, v.voucher_no, v.voucher_date, v.source_type, v.narration
  )
  select s.id, s.voucher_no, s.voucher_date, s.source_type, s.narration, s.salary_paise,
         exists (
           select 1 from public.ledger_vouchers j
            where j.tenant_id = p_tenant_id and j.source_type = 'payroll_reclass'
              and j.source_id = s.id::text
              and not exists (select 1 from public.ledger_vouchers r where r.reverses_voucher_id = j.id)
         ) as reclassified,
         s.mixed
    from sal s
   where s.salary_paise > 0
   order by s.voucher_date, s.voucher_no;
$$;

-- Turn the reconstructed salary of p_month's payment month into settlements
-- of Salary Payable, one journal per voucher, on the voucher's own date.
create or replace function public.payroll_ledger_reclass_overlap(
  p_tenant_id uuid, p_month text, p_actor text default 'system'
) returns jsonb
language plpgsql security definer set search_path = public
as $function$
declare
  v record; v_5070 bigint; v_2320 bigint; v_2330 bigint; v_1070 bigint; v_2110 bigint;
  v_lines jsonb; v_res jsonb; n_done int := 0; n_skip int := 0;
  v_nos text[] := '{}'; v_skips text[] := '{}';
begin
  for v in select * from public.payroll_ledger_overlap(p_tenant_id, p_month) where not reclassified loop
    select coalesce(sum(case when a.code = '5070' then l.debit_paise - l.credit_paise end), 0),
           coalesce(sum(case when a.code = '2320' then l.credit_paise - l.debit_paise end), 0),
           coalesce(sum(case when a.code = '2330' then l.credit_paise - l.debit_paise end), 0),
           coalesce(sum(case when a.code = '1070' then l.credit_paise - l.debit_paise end), 0)
      into v_5070, v_2320, v_2330, v_1070
      from public.ledger_lines l join public.ledger_accounts a on a.id = l.account_id
     where l.voucher_id = v.voucher_id;
    v_2110 := v_5070 - v_2320 - v_2330 - v_1070;
    if v_5070 <= 0 or v_2110 < 0 then
      n_skip := n_skip + 1; v_skips := v_skips || v.voucher_no; continue;
    end if;

    v_lines := jsonb_build_array(jsonb_build_object(
      'account_code', '5070', 'debit_paise', 0, 'credit_paise', v_5070,
      'narration', 'Salary expense moved to the payroll run for ' || p_month,
      'cost_centre_code', 'school'));
    if v_2320 > 0 then v_lines := v_lines || jsonb_build_object(
      'account_code', '2320', 'debit_paise', v_2320, 'credit_paise', 0,
      'narration', 'PF withheld — now accrued by the payroll run'); end if;
    if v_2330 > 0 then v_lines := v_lines || jsonb_build_object(
      'account_code', '2330', 'debit_paise', v_2330, 'credit_paise', 0,
      'narration', 'ESI withheld — now accrued by the payroll run'); end if;
    if v_1070 > 0 then v_lines := v_lines || jsonb_build_object(
      'account_code', '1070', 'debit_paise', v_1070, 'credit_paise', 0,
      'narration', 'Advance recovery — now accrued by the payroll run'); end if;
    if v_2110 > 0 then v_lines := v_lines || jsonb_build_object(
      'account_code', '2110', 'debit_paise', v_2110, 'credit_paise', 0,
      'narration', 'Salary paid — settles the payroll run''s payable'); end if;

    v_res := public.ledger_post(p_tenant_id, jsonb_build_object(
      'voucher_type', 'journal', 'date', v.voucher_date,
      'narration', 'Payroll ' || p_month || ' — ' || v.voucher_no ||
                   ' reclassified: reconstructed salary becomes a payment of Salary Payable so the payroll run can book the expense once',
      'source_type', 'payroll_reclass', 'source_id', v.voucher_id::text,
      'created_by', coalesce(nullif(p_actor, ''), 'system'),
      'lines', v_lines));
    if coalesce((v_res->>'ok')::boolean, false) then
      n_done := n_done + 1; v_nos := v_nos || (v_res->>'voucher_no');
    else
      n_skip := n_skip + 1; v_skips := v_skips || (v.voucher_no || ': ' || coalesce(v_res->>'error', 'refused'));
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'month', p_month, 'reclassified', n_done, 'skipped', n_skip,
                            'voucher_nos', to_jsonb(v_nos), 'skipped_nos', to_jsonb(v_skips));
end;
$function$;

-- Post one run: the accrual at month end, and the payment on the paid date.
create or replace function public.payroll_ledger_post(
  p_tenant_id uuid, p_run_id text, p_actor text default 'system'
) returns jsonb
language plpgsql security definer set search_path = public
as $function$
declare
  v_run record; v_status text; v_month_end date; v_overlap int; v_reclassed int; n_lines int;
  v_gross numeric; v_net numeric; v_payable numeric; v_adv numeric; v_lwp numeric; v_late numeric;
  v_special numeric; v_total_ded numeric; v_pf_govt numeric; v_esi_govt numeric;
  v_pf_ee numeric; v_pf_er numeric; v_esi_ee numeric; v_esi_er numeric; v_rest numeric;
  v_lines jsonb; v_res jsonb; v_accrual jsonb; v_payment jsonb; v_created_by text;
  m record; v_bank text; v_code text; v_paid date; v_paid_total numeric := 0;
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

  -- The guard.
  select count(*), count(*) filter (where reclassified)
    into v_overlap, v_reclassed
    from public.payroll_ledger_overlap(p_tenant_id, v_run.month);
  if v_overlap > v_reclassed then
    raise exception 'Payroll %: % reconstructed salary voucher(s) dated the following month would be counted twice. Reclassify them first (Accounts → Server book → Payroll in the book).',
      v_run.month, v_overlap - v_reclassed;
  end if;

  -- The run's own figures. Rupees on the desk; paise in the book.
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
  -- No component split: the deposit column is the employer's whole cost.
  if v_pf_ee + v_pf_er = 0 and v_pf_govt > 0 then v_pf_er := v_pf_govt; end if;
  if v_esi_ee + v_esi_er = 0 and v_esi_govt > 0 then v_esi_er := v_esi_govt; end if;

  -- Deductions that are owed to nobody (leave without pay, late penalty)
  -- reduce the expense; everything else withheld is a liability or an advance
  -- recovered. If the arithmetic says LWP was already netted out of gross,
  -- treat it so rather than inventing a balancing figure.
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

  -- Payment: its own event on its own date.
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
      for m in
        select lower(coalesce(nullif(payment_mode, ''), 'bank_transfer')) as mode,
               sum(coalesce(amount_payable, net_pay)) as amt
          from public.payroll_desk_run_lines
         where run_id = p_run_id and tenant_id = p_tenant_id
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

-- The hook. Never raise: a bookkeeping refusal must not cost the office its
-- payroll record. The Server book's payroll card shows what did not post.
create or replace function public.payroll_desk_ledger_autopost()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
begin
  begin
    if tg_table_name = 'payroll_desk_runs' then
      perform public.payroll_ledger_post(new.tenant_id, new.id, 'desk');
    elsif tg_table_name = 'payroll_desk_run_lines' then
      perform public.payroll_ledger_post(new.tenant_id, new.run_id, 'desk');
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$function$;

drop trigger if exists payroll_runs_ledger_autopost on public.payroll_desk_runs;
create trigger payroll_runs_ledger_autopost
  after insert or update on public.payroll_desk_runs
  for each row execute function public.payroll_desk_ledger_autopost();

drop trigger if exists payroll_run_lines_ledger_autopost on public.payroll_desk_run_lines;
create trigger payroll_run_lines_ledger_autopost
  after insert or update on public.payroll_desk_run_lines
  for each row execute function public.payroll_desk_ledger_autopost();

notify pgrst, 'reload schema';
