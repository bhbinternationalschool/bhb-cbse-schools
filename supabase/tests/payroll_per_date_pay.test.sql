-- Behavioural test for 20261014120000_payroll_per_date_pay (14 Oct 2026):
-- recall reverses the book, re-post after recall, salary paid per day.
--
-- Runs in CI against the E2E stack (every migration on Postgres 17):
--   bash scripts/e2e-stack.sh sql-test supabase/tests/payroll_per_date_pay.test.sql
-- It makes its own probe school, works inside one transaction and rolls it
-- back — nothing it does survives. Any failed check raises, and psql
-- (ON_ERROR_STOP) exits non-zero. Never point it at production.

\set ON_ERROR_STOP 1
begin;

do $test$
declare
  t uuid := gen_random_uuid();
  r jsonb;
  n int;
  live text;
  amt bigint;
  pay_before int;
begin
  insert into public.tenants (id, slug, name) values (t, 'payroll-probe-' || left(t::text, 8), 'Payroll probe');
  insert into public.ledger_accounts (tenant_id, code, name, kind, bank_account_id)
  select t, c, 'probe ' || c,
         case when c like '1%' then 'asset' when c like '2%' then 'liability' when c like '4%' then 'income' else 'expense' end,
         case when c = '1012' then 'bnk_probe_a' when c = '1013' then 'bnk_probe_b' else '' end
    from unnest(array['4200','5070','1070','2320','2330','2300','2110','1000','1010','1012','1013','1110']) c;
  insert into public.ledger_fiscal_years (tenant_id, code, label, start_date, end_date, status)
  values (t, 'FY2026-27', 'probe', '2026-04-01', '2027-03-31', 'open');
  insert into public.accounts_desk_mode_bank_map (tenant_id, mode, bank_id)
  select t, m, 'bnk_probe_a' from unnest(array['upi', 'neft', 'rtgs', 'cheque']) m;

  -- A posted run of four staff, 8,800 each (gross 10,000, PF 1,200).
  insert into public.payroll_desk_runs (id, tenant_id, month, status, lock_version)
  values ('prb_run', t, '2026-07', 'draft', 1);
  insert into public.payroll_desk_run_lines (id, tenant_id, run_id, line_index, staff_id, full_name, components,
                                             gross, total_deductions, net_pay, amount_payable, payment_mode)
  select 'prb_run_L' || i, t, 'prb_run', i, 's' || i, 'Staff ' || i,
         '[{"kind":"earning","headCode":"BASIC","amount":10000},{"kind":"deduction","headCode":"PF_EE","amount":1200},{"kind":"employer","headCode":"PF_ER","amount":1200}]'::jsonb,
         10000, 1200, 8800, 8800, case when i < 2 then 'cash' else 'bank_transfer' end
    from generate_series(0, 3) i;

  -- 1. Posting books the accrual under the bare run id.
  update public.payroll_desk_runs set status = 'posted', posted_at = now(), lock_version = 2 where id = 'prb_run';
  select string_agg(v.source_id, ',' order by v.source_id) into live
    from public.ledger_vouchers v
   where v.tenant_id = t and v.source_type = 'payroll_run'
     and not exists (select 1 from public.ledger_vouchers x where x.reverses_voucher_id = v.id);
  assert live = 'prb_run', format('1: live accrual %s', live);
  select sum(l.credit_paise) into amt from public.ledger_lines l join public.ledger_vouchers v on v.id = l.voucher_id
    join public.ledger_accounts a on a.id = l.account_id
   where v.tenant_id = t and v.source_id = 'prb_run' and a.code = '2110';
  assert amt = 3520000, format('1: net payable %s', amt);

  -- 2. Two staff paid in cash on 30 Jul (one statement), one by NEFT on 9 Aug.
  update public.payroll_desk_run_lines set paid_on = '2026-07-30', paid_by = 'probe' where run_id = 'prb_run' and line_index in (0, 1);
  update public.payroll_desk_run_lines set paid_on = '2026-08-09', payment_mode = 'neft', payment_ref = 'UTR1' where run_id = 'prb_run' and line_index = 2;
  select string_agg(v.source_id || '=' || (select sum(debit_paise) from public.ledger_lines l where l.voucher_id = v.id), ',' order by v.source_id)
    into live from public.ledger_vouchers v
   where v.tenant_id = t and v.source_type = 'payroll_payment'
     and not exists (select 1 from public.ledger_vouchers x where x.reverses_voucher_id = v.id);
  assert live = 'prb_run:pay:2026-07-30:cash=1760000,prb_run:pay:2026-08-09:bnk_probe_a=880000', format('2: groups %s', live);
  select count(*) into n from public.ledger_vouchers where tenant_id = t and source_type = 'payroll_payment';
  assert n = 2, format('2: one statement, one voucher per group — %s payment vouchers', n);
  select paid_account_code into live from public.payroll_desk_run_lines where run_id = 'prb_run' and line_index = 2;
  assert live = '1012', format('2: money account fixed on the line: %s', live);

  -- 3. The mode → bank map changes: a past payment is not moved.
  update public.accounts_desk_mode_bank_map set bank_id = 'bnk_probe_b' where tenant_id = t;
  update public.payroll_desk_run_lines set note = 'touched' where run_id = 'prb_run';
  select count(*) into n from public.ledger_vouchers where tenant_id = t and source_type = 'payroll_payment';
  assert n = 2, format('3: a map change re-booked a past payment (%s payment vouchers)', n);

  -- 4. Same day and account, a different person, same total: regrouped.
  update public.payroll_desk_run_lines
     set paid_on = case when line_index = 1 then null else date '2026-07-30' end,
         payment_mode = case when line_index = 3 then 'cash' else payment_mode end
   where run_id = 'prb_run' and line_index in (1, 3);
  select string_agg(v.source_id || '=' || (select sum(debit_paise) from public.ledger_lines l where l.voucher_id = v.id), ',' order by v.source_id)
    into live from public.ledger_vouchers v
   where v.tenant_id = t and v.source_type = 'payroll_payment'
     and not exists (select 1 from public.ledger_vouchers x where x.reverses_voucher_id = v.id);
  assert live = 'prb_run:pay:2026-07-30:cash#2=1760000,prb_run:pay:2026-08-09:bnk_probe_a=880000', format('4: %s', live);

  select count(*) into n from public.ledger_vouchers where tenant_id = t and narration like '%set %';
  assert n = 0, '4: no staff-set hash in a narration';

  -- 5. Un-mark the NEFT line: its group is reversed, nothing else moves.
  update public.payroll_desk_run_lines set paid_on = null where run_id = 'prb_run' and line_index = 2;
  select string_agg(v.source_id, ',' order by v.source_id) into live from public.ledger_vouchers v
   where v.tenant_id = t and v.source_type = 'payroll_payment'
     and not exists (select 1 from public.ledger_vouchers x where x.reverses_voucher_id = v.id);
  assert live = 'prb_run:pay:2026-07-30:cash#2', format('5: %s', live);
  select paid_account_code into live from public.payroll_desk_run_lines where run_id = 'prb_run' and line_index = 2;
  assert live = '', '5: un-marking clears the fixed account';

  -- 5b. A regroup whose re-post fails leaves the book as it was: the group's
  --     voucher is not left reversed. (Frozen account forced to a code the
  --     chart lacks, with the freeze trigger off inside this transaction.)
  alter table public.payroll_desk_run_lines disable trigger payroll_run_lines_freeze_paid_account;
  select count(*) into pay_before from public.ledger_vouchers where tenant_id = t;
  update public.payroll_desk_run_lines set paid_account_code = '9999' where run_id = 'prb_run' and line_index = 3;
  alter table public.payroll_desk_run_lines enable trigger payroll_run_lines_freeze_paid_account;
  select count(*) into n from public.ledger_vouchers where tenant_id = t;
  assert n = pay_before, format('5b: a failed regroup wrote %s voucher(s)', n - pay_before);
  select string_agg(v.source_id, ',') into live from public.ledger_vouchers v
   where v.tenant_id = t and v.source_type = 'payroll_payment'
     and not exists (select 1 from public.ledger_vouchers x where x.reverses_voucher_id = v.id);
  assert live = 'prb_run:pay:2026-07-30:cash#2', format('5b: live after failed regroup %s', live);
  begin
    perform public.payroll_ledger_post(t, 'prb_run', 'probe');
    assert false, '5b: a direct post must raise';
  exception when assert_failure then raise;
  when others then
    assert sqlerrm like '%no ledger account with code 9999%', format('5b: %s', sqlerrm);
  end;
  update public.payroll_desk_run_lines set paid_on = null where run_id = 'prb_run' and line_index = 3;
  update public.payroll_desk_run_lines set paid_on = '2026-07-30', payment_mode = 'cash' where run_id = 'prb_run' and line_index = 3;

  -- 5c. A locked period: un-marking changes nothing in the book (the desk
  --     save's book step is refused and swallowed); a direct post raises.
  insert into public.ledger_periods (tenant_id, period, fy_code, status) values (t, '2026-07', 'FY2026-27', 'locked');
  select count(*) into pay_before from public.ledger_vouchers where tenant_id = t;
  update public.payroll_desk_run_lines set paid_on = null where run_id = 'prb_run' and line_index = 3;
  select count(*) into n from public.ledger_vouchers where tenant_id = t;
  assert n = pay_before, format('5c: locked period wrote %s voucher(s)', n - pay_before);
  begin
    perform public.payroll_ledger_post(t, 'prb_run', 'probe');
    assert false, '5c: a direct post must raise';
  exception when assert_failure then raise;
  when others then
    assert sqlerrm like '%locked%', format('5c: %s', sqlerrm);
  end;
  delete from public.ledger_periods where tenant_id = t and period = '2026-07';
  update public.payroll_desk_run_lines set paid_on = '2026-07-30' where run_id = 'prb_run' and line_index = 3;

  -- 5d. Run lines post once per statement: no row-level book trigger.
  select count(*) filter (where (tg.tgtype & 1) = 1), count(*) filter (where (tg.tgtype & 1) = 0)
    into n, pay_before
    from pg_trigger tg join pg_proc p on p.oid = tg.tgfoid
   where tg.tgrelid = 'public.payroll_desk_run_lines'::regclass and not tg.tgisinternal
     and p.proname in ('payroll_desk_ledger_autopost', 'payroll_desk_lines_ledger_autopost');
  assert n = 0 and pay_before = 2, format('5d: %s row-level, %s statement-level book triggers on run lines', n, pay_before);

  -- 6. Idempotent: posting again writes nothing.
  select count(*) into pay_before from public.ledger_vouchers where tenant_id = t;
  r := public.payroll_ledger_post(t, 'prb_run', 'probe');
  assert (r->>'ok')::boolean, format('6: %s', r);
  select count(*) into n from public.ledger_vouchers where tenant_id = t;
  assert n = pay_before, format('6: a repeat post wrote %s voucher(s)', n - pay_before);

  -- 7. Recall is refused while anyone on the run is marked paid.
  r := public.payroll_ledger_recall(t, 'prb_run', 'Director', '');
  assert not (r->>'ok')::boolean and r->>'refused' like '%already marked paid%', format('7: %s', r);
  select count(*) into n from public.ledger_vouchers where tenant_id = t;
  assert n = pay_before, '7: a refused recall wrote nothing';

  -- 8. Nobody paid → recall reverses the accrual; the stale posted copy
  --    does not re-post; posting again books version #2.
  update public.payroll_desk_run_lines set paid_on = null where run_id = 'prb_run';
  select count(*) into n from public.ledger_vouchers v where v.tenant_id = t and v.source_type = 'payroll_payment'
     and not exists (select 1 from public.ledger_vouchers x where x.reverses_voucher_id = v.id);
  assert n = 0, format('8: %s live payment vouchers after un-marking everyone', n);
  r := public.payroll_ledger_recall(t, 'prb_run', 'Director', '');
  assert (r->>'ok')::boolean and jsonb_array_length(r->'reversed') = 1, format('8: recall %s', r);
  assert r->'reversed'->0->>'reversal_no' like 'RV/%', format('8: %s', r);
  r := public.payroll_ledger_post(t, 'prb_run', 'probe');
  assert r->>'skipped' like 'run was recalled%', format('8: stale copy %s', r);
  update public.payroll_desk_runs set status = 'draft', lock_version = 3 where id = 'prb_run';
  update public.payroll_desk_runs set status = 'posted', lock_version = 5 where id = 'prb_run';
  select string_agg(v.source_id, ',' order by v.source_id) into live from public.ledger_vouchers v
   where v.tenant_id = t and v.source_type = 'payroll_run'
     and not exists (select 1 from public.ledger_vouchers x where x.reverses_voucher_id = v.id);
  assert live = 'prb_run#2', format('8: re-posted accrual %s', live);
  select count(*) into n from public.ledger_vouchers where tenant_id = t and source_type = 'payroll_run';
  assert n = 2, format('8: %s accrual vouchers (want the reversed one and #2)', n);

  -- 9. A paid run is never recalled.
  update public.payroll_desk_run_lines set paid_on = '2026-08-12' where run_id = 'prb_run';
  update public.payroll_desk_runs set status = 'paid', paid_at = '2026-08-12 06:30+00', lock_version = 6 where id = 'prb_run';
  r := public.payroll_ledger_recall(t, 'prb_run', 'Director', '');
  assert not (r->>'ok')::boolean, format('9: %s', r);

  -- 10. Totals: live accrual net = live payments = 35,200.
  select coalesce(sum(l.debit_paise), 0) into amt from public.ledger_lines l join public.ledger_vouchers v on v.id = l.voucher_id
   where v.tenant_id = t and v.source_type = 'payroll_payment'
     and not exists (select 1 from public.ledger_vouchers x where x.reverses_voucher_id = v.id);
  assert amt = 3520000, format('10: live payments %s', amt);
  select coalesce(sum(l.credit_paise - l.debit_paise), 0) into amt from public.ledger_lines l
    join public.ledger_vouchers v on v.id = l.voucher_id join public.ledger_accounts a on a.id = l.account_id
   where v.tenant_id = t and a.code = '2110';
  assert amt = 0, format('10: salary payable left %s', amt);

  -- 11. A run paid the old way (one payment keyed by the run id) is left alone.
  insert into public.payroll_desk_runs (id, tenant_id, month, status, lock_version) values ('prb_old', t, '2026-05', 'draft', 1);
  insert into public.payroll_desk_run_lines (id, tenant_id, run_id, line_index, staff_id, full_name, gross, net_pay, amount_payable)
  values ('prb_old_L0', t, 'prb_old', 0, 's0', 'Staff 0', 5000, 5000, 5000);
  perform public.ledger_post(t, jsonb_build_object('voucher_type', 'payment', 'date', '2026-06-20',
    'source_type', 'payroll_payment', 'source_id', 'prb_old', 'lines', jsonb_build_array(
      jsonb_build_object('account_code', '2110', 'debit_paise', 500000),
      jsonb_build_object('account_code', '1000', 'credit_paise', 500000))));
  update public.payroll_desk_runs set status = 'paid', posted_at = now(), paid_at = '2026-06-20 06:30+00', lock_version = 3 where id = 'prb_old';
  select count(*) into n from public.ledger_vouchers where tenant_id = t and source_type = 'payroll_payment' and source_id like 'prb_old%';
  assert n = 1, format('11: old-style payment duplicated (%s)', n);

  raise notice 'payroll_per_date_pay.test.sql: all checks passed';
end;
$test$;

rollback;
