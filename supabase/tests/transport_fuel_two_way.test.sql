-- Behavioural test for 20261014150000_transport_fuel_two_way (14 Oct 2026):
-- a fuel fill and its voucher land together or not at all; rate × qty is
-- enforced; a fill in the book is never edited or deleted; voiding in
-- Transport reverses the voucher; reversing in Accounts voids the fill.
--
-- Runs in CI against the E2E stack (every migration on Postgres 17):
--   bash scripts/e2e-stack.sh sql-test supabase/tests/transport_fuel_two_way.test.sql
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
  v_id uuid;
  v_no text;
  multi uuid;
  fill jsonb := jsonb_build_object(
    'id', 'fill_p1', 'line_no', 1, 'vehicle_id', 'veh_a', 'fill_date', '2026-08-31',
    'quantity', 7.53, 'unit', 'kg', 'fuel_type', 'cng', 'rate_paise', 9300, 'amount_paise', 70029,
    'odometer_km', 41200, 'payment_mode', 'cash', 'entry_source', 'web', 'created_by_name', 'probe');
  cash_voucher jsonb := jsonb_build_object(
    'voucher_type', 'payment', 'date', '2026-08-31', 'narration', 'Fuel — UP65RT9825',
    'lines', jsonb_build_array(
      jsonb_build_object('account_code', '5031', 'debit_paise', 70029, 'credit_paise', 0,
                         'cost_centre_code', 'transport', 'narration', 'cng 7.53 kg @ ₹93.00/kg — UP65RT9825'),
      jsonb_build_object('account_code', '1000', 'debit_paise', 0, 'credit_paise', 70029)));
begin
  insert into public.tenants (id, slug, name) values (t, 'fuel-probe-' || left(t::text, 8), 'Fuel probe');
  insert into public.ledger_accounts (tenant_id, code, name, kind)
  values (t, '5031', 'Vehicle Fuel', 'expense'), (t, '5010', 'Stationery', 'expense'),
         (t, '1000', 'Cash in Hand', 'asset'), (t, '2000', 'Accounts Payable', 'liability');
  insert into public.ledger_cost_centres (tenant_id, code, name) values (t, 'transport', 'Transport');
  insert into public.ledger_fiscal_years (tenant_id, code, label, start_date, end_date, status)
  values (t, 'FY2026-27', 'probe', '2026-04-01', '2027-03-31', 'open');

  -- 1. Voucher and fill together, keyed like the register (transport_fuel_fill, id).
  r := public.transport_fuel_fill_post(t, cash_voucher, jsonb_build_array(fill), 'probe');
  assert (r->>'ok')::boolean, format('1: post refused %s', r);
  v_id := (r->>'voucher_id')::uuid;
  v_no := r->>'voucher_no';
  select count(*) into n from public.transport_fuel_fills f
    join public.ledger_lines l on l.id = f.voucher_line_id
   where f.tenant_id = t and f.id = 'fill_p1' and f.voucher_id = v_id and f.voucher_no = v_no
     and f.voucher_origin = 'posted' and l.line_no = 1 and l.debit_paise = f.amount_paise;
  assert n = 1, '1: fill not tied to its line';
  assert (select source_type || ':' || source_id from public.ledger_vouchers where id = v_id) = 'transport_fuel_fill:fill_p1',
    '1: the voucher names its fill';

  -- 2. A replay lands once.
  r := public.transport_fuel_fill_post(t, cash_voucher, jsonb_build_array(fill), 'probe');
  assert (r->>'ok')::boolean and (r->>'created')::boolean = false, format('2: replay %s', r);
  select count(*) into n from public.ledger_vouchers where tenant_id = t;
  assert n = 1, format('2: %s vouchers after a replay', n);

  -- 3. Book and register must carry the same figure — refused, nothing written.
  r := public.transport_fuel_fill_post(t,
         jsonb_set(jsonb_set(cash_voucher, '{lines,0,debit_paise}', '70000'), '{lines,1,credit_paise}', '70000'),
         jsonb_build_array(fill || '{"id":"fill_p2"}'), 'probe');
  assert not (r->>'ok')::boolean and r->>'error' like '%same figure%', format('3: %s', r);
  select count(*) into n from public.ledger_vouchers where tenant_id = t;
  assert n = 1, '3: a refused fill left a voucher behind';

  -- 4. A fill on a non-fuel line is refused.
  r := public.transport_fuel_fill_post(t, jsonb_set(cash_voucher, '{lines,0,account_code}', '"5010"'),
         jsonb_build_array(fill || '{"id":"fill_p3"}'), 'probe');
  assert not (r->>'ok')::boolean and r->>'error' like '%not a fuel head%', format('4: %s', r);

  -- 5. Rate × qty is the table's rule.
  begin
    insert into public.transport_fuel_fills (id, tenant_id, vehicle_id, fill_date, quantity, unit, amount_paise, rate_paise)
    values ('fill_bad', t, 'veh_a', '2026-09-01', 7.53, 'kg', 70000, 9300);
    raise exception '5: a wrong amount was stored';
  exception when check_violation then null;
  end;

  -- 6. In the book: not edited, not deleted, not voided without its voucher.
  begin
    update public.transport_fuel_fills set quantity = 8 where id = 'fill_p1';
    raise exception '6: quantity was edited';
  exception when others then if sqlerrm like '6:%' then raise; end if;
  end;
  begin
    delete from public.transport_fuel_fills where id = 'fill_p1';
    raise exception '6: a fill in the book was deleted';
  exception when others then if sqlerrm like '6:%' then raise; end if;
  end;
  begin
    update public.transport_fuel_fills set voided_at = now() where id = 'fill_p1';
    raise exception '6: voided without reversing';
  exception when others then if sqlerrm like '6:%' then raise; end if;
  end;
  update public.transport_fuel_fills set odometer_km = 41210, bill_no = 'B1' where id = 'fill_p1';

  -- 7. A fill saved "not in the book" is posted later, tied in place.
  insert into public.transport_fuel_fills (id, tenant_id, vehicle_id, fill_date, quantity, unit, fuel_type, amount_paise, payment_mode, entry_source)
  values ('fill_q1', t, 'veh_b', '2026-09-02', 5.7, 'kg', 'cng', 53010, 'cash', 'app');
  r := public.transport_fuel_fill_post(t,
         jsonb_build_object('voucher_type', 'payment', 'date', '2026-09-02', 'lines', jsonb_build_array(
           jsonb_build_object('account_code', '5031', 'debit_paise', 53010, 'credit_paise', 0),
           jsonb_build_object('account_code', '1000', 'debit_paise', 0, 'credit_paise', 53010))),
         jsonb_build_array(jsonb_build_object('id', 'fill_q1', 'line_no', 1, 'existing', true)), 'office');
  assert (r->>'ok')::boolean, format('7: %s', r);
  assert (select voucher_no from public.transport_fuel_fills where id = 'fill_q1') = r->>'voucher_no', '7: not tied';

  -- 8. Void in Transport reverses the voucher in the same transaction.
  r := public.transport_fuel_fill_void(t, 'fill_p1', '', 'probe');
  assert not (r->>'ok')::boolean, '8: a void needs a reason';
  r := public.transport_fuel_fill_void(t, 'fill_p1', 'wrong vehicle', 'probe');
  assert (r->>'ok')::boolean and r->>'reversal_voucher_no' like 'RV/%', format('8: %s', r);
  assert exists (select 1 from public.ledger_vouchers where tenant_id = t and reverses_voucher_id = v_id),
    '8: voucher not reversed';
  assert (select voided_at is not null and void_reason = 'wrong vehicle' and reversal_voucher_no = r->>'reversal_voucher_no'
            from public.transport_fuel_fills where id = 'fill_p1'), '8: fill not stamped';
  r := public.transport_fuel_fill_void(t, 'fill_p1', 'again', 'probe');
  assert (r->>'already')::boolean, '8: a second void is a no-op';

  -- 9. Accounts multi-line voucher: not reversed from Transport; reversing it
  --    in Accounts voids the fill by itself.
  r := public.transport_fuel_fill_post(t,
         jsonb_build_object('voucher_type', 'payment', 'date', '2026-09-05', 'lines', jsonb_build_array(
           jsonb_build_object('account_code', '5010', 'debit_paise', 5000, 'credit_paise', 0),
           jsonb_build_object('account_code', '5031', 'debit_paise', 70029, 'credit_paise', 0),
           jsonb_build_object('account_code', '1000', 'debit_paise', 0, 'credit_paise', 75029))),
         jsonb_build_array(fill || '{"id":"fill_m1","line_no":2,"fill_date":"2026-09-05","entry_source":"accounts"}'), 'office');
  assert (r->>'ok')::boolean, format('9: %s', r);
  multi := (r->>'voucher_id')::uuid;
  assert (select source_type from public.ledger_vouchers where id = multi) = 'transport_fuel_fill', '9: source';
  r := public.transport_fuel_fill_void(t, 'fill_m1', 'test', 'probe');
  assert not (r->>'ok')::boolean and r->>'error' like '%other expense line%', format('9: %s', r);
  r := public.ledger_reverse(t, multi, 'duplicate bill', null, 'accounts');
  assert (r->>'ok')::boolean, format('9: reverse %s', r);
  assert (select voided_at is not null and reversal_voucher_no = r->>'voucher_no' and void_reason like '%duplicate bill%'
            from public.transport_fuel_fills where id = 'fill_m1'), '9: Accounts reversal did not void the fill';

  -- 10. A fill not in the book voids without touching the book.
  insert into public.transport_fuel_fills (id, tenant_id, vehicle_id, fill_date, quantity, unit, amount_paise)
  values ('fill_z1', t, 'veh_a', '2026-09-09', 5, 'kg', 46500);
  select count(*) into n from public.ledger_vouchers where tenant_id = t;
  r := public.transport_fuel_fill_void(t, 'fill_z1', 'typed twice', 'probe');
  assert (r->>'ok')::boolean and r->>'reversal_voucher_no' = '', format('10: %s', r);
  assert (select count(*) from public.ledger_vouchers where tenant_id = t) = n, '10: the book moved';
  delete from public.transport_fuel_fills where id = 'fill_z1'; -- not in the book: the driver-app rules apply

  raise notice 'transport_fuel_two_way: all checks passed';
end;
$test$;

rollback;
