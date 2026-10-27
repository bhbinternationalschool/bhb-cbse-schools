-- Behavioural test for 20261027090000_data_layer_masters_series_claim
-- (masters_series_claim — a RECEIPT / SRN number reserved in the database):
--   A. the counter lags the records (production, 27 Oct: counter 701, receipts
--      to RCV-00710) → the claim skips past the records and moves the counter
--   B. claims in a row: consecutive, never repeated; _rev moves by one; the
--      row table follows
--   C. what counts as "on record" (numberSeriesIssued): prefix + 1–12 digits
--      only, other schools ignored, voided receipts count
--   D. per-year counters and the session in the prefix
--   E. SRN from sis_students.srn
--   F. unknown series / a series with no table of record — nothing written
--   G. grants: service_role only; lock_timeout 5s on the function
--
-- Concurrency (separate connections) is masters_series_claim_parallel.sh.
--
-- Runs in CI against the E2E stack (every migration on Postgres 17):
--   bash scripts/e2e-stack.sh sql-test supabase/tests/masters_series_claim.test.sql
-- One transaction, rolled back — nothing survives. Any failed check raises.
-- Never point it at production.

\set ON_ERROR_STOP 1
begin;

create or replace function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if;
  raise notice 'ok  %', what;
end $$;

-- One series element by CODE (each probe school's ids are its own: the
-- masters_desk_number_series row table is keyed by id alone).
create or replace function pg_temp.el(p_tenant uuid, p_code text) returns jsonb language sql as $$
  select e from public.masters_desk_slices s, jsonb_array_elements(s.payload) e
   where s.tenant_id = p_tenant and s.slice_key = 'numberSeries' and e->>'code' = p_code
$$;

create or replace function pg_temp.new_school(p_name text) returns uuid language plpgsql as $$
declare t uuid := gen_random_uuid();
begin
  insert into public.tenants (id, slug, name) values (t, p_name || '-' || left(t::text, 8), p_name);
  insert into public.masters_desk_slices (tenant_id, slice_key, payload, updated_at) values (t, 'numberSeries',
    replace('[{"id":"ns_rc_@","code":"RECEIPT","prefix":"RCV-","padWidth":5,"resetOnAy":false,"nextNumber":701,"includeSessionInPrefix":false},
      {"id":"ns_srn_@","code":"SRN","prefix":"SRN-","padWidth":5,"resetOnAy":false,"nextNumber":1,"includeSessionInPrefix":false},
      {"id":"ns_tc_@","code":"TC","prefix":"TC-","padWidth":4,"resetOnAy":false,"nextNumber":5,"includeSessionInPrefix":false}]', '@', left(t::text, 8))::jsonb,
    now() - interval '1 hour');
  insert into public.masters_desk_sync_meta (tenant_id, updated_at, last_updated_at) values (t, now() - interval '1 hour', now() - interval '1 hour');
  return t;
end $$;

create or replace function pg_temp.receipt(p_tenant uuid, p_no text) returns void language sql as $$
  insert into public.fee_desk_vouchers (id, tenant_id, academic_year_code, receipt_no, collection_date, transaction_date, total_paise)
  values (gen_random_uuid()::text, p_tenant, '2026-27', p_no, current_date, current_date, 100)
$$;

-- @section A: the counter lags the records → skip past them
do $test$
declare
  t uuid := pg_temp.new_school('claim-lag');
  r jsonb; i int; rev0 int; at0 timestamptz;
begin
  for i in 690..710 loop perform pg_temp.receipt(t, 'RCV-' || lpad(i::text, 5, '0')); end loop;
  rev0 := coalesce((pg_temp.el(t, 'RECEIPT')->>'_rev')::int, 0);
  select updated_at into at0 from public.masters_desk_slices where tenant_id = t and slice_key = 'numberSeries';
  r := public.masters_series_claim(t, 'RECEIPT');
  perform pg_temp.check((r->>'ok')::boolean and r->>'status' = 'claimed', 'A: claimed');
  perform pg_temp.check((r->>'number')::int = 711 and r->>'formatted' = 'RCV-00711',
    format('A: counter 701, receipts to RCV-00710 → RCV-00711 (got %s)', r->>'formatted'));
  perform pg_temp.check((r->>'lifted')::boolean, 'A: reported as lifted');
  perform pg_temp.check((pg_temp.el(t, 'RECEIPT')->>'nextNumber')::int = 712, 'A: the counter is written to 712');
  perform pg_temp.check((pg_temp.el(t, 'RECEIPT')->>'_rev')::int = rev0 + 1, 'A: the element''s _rev moves by one');
  perform pg_temp.check((select updated_at from public.masters_desk_slices where tenant_id = t and slice_key = 'numberSeries') > at0,
    'A: the slice revision moves');
  perform pg_temp.check((pg_temp.el(t, 'SRN')) ? 'id' and (pg_temp.el(t, 'SRN')->>'nextNumber')::int = 1,
    'A: the other series are untouched');
end $test$;

-- @section B: claims in a row
do $test$
declare
  t uuid := pg_temp.new_school('claim-row');
  r jsonb; i int; got int[] := '{}';
begin
  for i in 1..5 loop
    r := public.masters_series_claim(t, 'RECEIPT');
    got := got || (r->>'number')::int;
    perform pg_temp.check(not (r->>'lifted')::boolean, format('B: claim %s not lifted (no records)', i));
  end loop;
  perform pg_temp.check(got = array[701,702,703,704,705], format('B: consecutive 701..705 (got %s)', got));
  perform pg_temp.check((pg_temp.el(t, 'RECEIPT')->>'nextNumber')::int = 706, 'B: the counter ends at 706');
  perform pg_temp.check((pg_temp.el(t, 'RECEIPT')->>'_rev')::int = 6, 'B: _rev 1 → 6 after five claims');
  perform pg_temp.check((select next_number from public.masters_desk_number_series where tenant_id = t and code = 'RECEIPT') = 706,
    'B: the number-series row table follows');
  -- A receipt saved with a later number (an offline tab) is skipped too.
  perform pg_temp.receipt(t, 'RCV-00720');
  r := public.masters_series_claim(t, 'RECEIPT');
  perform pg_temp.check((r->>'number')::int = 721 and (r->>'lifted')::boolean, 'B: by id, past a later receipt on record');
end $test$;

-- @section C: what counts as on record
do $test$
declare
  t uuid := pg_temp.new_school('claim-record');
  other uuid := pg_temp.new_school('claim-other');
  r jsonb;
begin
  update public.masters_desk_slices set payload = jsonb_set(payload, '{0,nextNumber}', '1')
   where tenant_id = t and slice_key = 'numberSeries';
  perform pg_temp.receipt(other, 'RCV-09000');        -- another school
  perform pg_temp.receipt(t, 'RCV-12A');              -- not digits only
  perform pg_temp.receipt(t, 'RCV-1234567890123');    -- 13 digits
  perform pg_temp.receipt(t, 'XRCV-00800');           -- another prefix
  perform pg_temp.receipt(t, 'RCV_00900');            -- '_' is not a LIKE wildcard here
  perform pg_temp.receipt(t, 'RCV-00040 ');           -- trailing blank: trimmed, counts
  perform pg_temp.receipt(t, 'RCV-00041');
  update public.fee_desk_vouchers set voided_at = now() where tenant_id = t and receipt_no = 'RCV-00041';
  r := public.masters_series_claim(t, 'RECEIPT');
  perform pg_temp.check((r->>'number')::int = 42,
    format('C: only this school''s RCV-<digits>, voided included → 42 (got %s)', r->>'number'));
end $test$;

-- @section D: per-year counter and the session in the prefix
do $test$
declare
  t uuid := pg_temp.new_school('claim-year');
  r jsonb;
begin
  update public.masters_desk_slices set payload =
    '[{"id":"ns_rc_d","code":"RECEIPT","prefix":"R/","padWidth":3,"resetOnAy":true,"nextNumber":50,
       "countersByAy":{"2025-26":90},"includeSessionInPrefix":true}]'
   where tenant_id = t and slice_key = 'numberSeries';
  perform pg_temp.receipt(t, 'R/2026-27/007');
  perform pg_temp.receipt(t, 'R/2025-26/200');
  r := public.masters_series_claim(t, 'RECEIPT', '2026-27');
  perform pg_temp.check(r->>'formatted' = 'R/2026-27/050',
    format('D: 2026-27 has no counter → nextNumber 50, its own records only (got %s)', r->>'formatted'));
  perform pg_temp.check((pg_temp.el(t, 'RECEIPT')->'countersByAy'->>'2026-27')::int = 51
    and (pg_temp.el(t, 'RECEIPT')->'countersByAy'->>'2025-26')::int = 90
    and (pg_temp.el(t, 'RECEIPT')->>'nextNumber')::int = 50, 'D: only that year''s counter moves');
  r := public.masters_series_claim(t, 'RECEIPT', '2025-26');
  perform pg_temp.check(r->>'formatted' = 'R/2025-26/201', format('D: 2025-26 past its record 200 (got %s)', r->>'formatted'));
  -- padStart never truncates
  update public.masters_desk_slices set payload = jsonb_set(payload, '{0,countersByAy,2026-27}', '12345')
   where tenant_id = t and slice_key = 'numberSeries';
  r := public.masters_series_claim(t, 'RECEIPT', '2026-27');
  perform pg_temp.check(r->>'formatted' = 'R/2026-27/12345', 'D: a number longer than the pad is not cut');
end $test$;

-- @section E: SRN from sis_students.srn
do $test$
declare
  t uuid := pg_temp.new_school('claim-srn');
  r jsonb;
begin
  insert into public.sis_students (id, tenant_id, srn, admission_no) values
    (gen_random_uuid()::text, t, 'SRN-00031', 'ADM-1'),
    (gen_random_uuid()::text, t, 'SRN-00009', 'ADM-2');
  r := public.masters_series_claim(t, 'SRN');
  perform pg_temp.check(r->>'formatted' = 'SRN-00032' and (r->>'lifted')::boolean, format('E: SRN past the register (got %s)', r->>'formatted'));
  r := public.masters_series_claim(t, 'SRN');
  perform pg_temp.check(r->>'formatted' = 'SRN-00033', 'E: the next claim is the next number');
  perform pg_temp.check((pg_temp.el(t, 'SRN')->>'nextNumber')::int = 34, 'E: SRN counter 34');
end $test$;

-- @section F: nothing written for unknown / not-on-record series
do $test$
declare
  t uuid := pg_temp.new_school('claim-none');
  r jsonb; before jsonb;
begin
  select payload into before from public.masters_desk_slices where tenant_id = t and slice_key = 'numberSeries';
  r := public.masters_series_claim(t, 'NOPE');
  perform pg_temp.check(not (r->>'ok')::boolean and r->>'status' = 'not_found', 'F: unknown → not_found');
  r := public.masters_series_claim(t, 'TC');
  perform pg_temp.check(not (r->>'ok')::boolean and r->>'status' = 'not_on_record', 'F: TC has no table of record → not_on_record');
  perform pg_temp.check((select payload from public.masters_desk_slices where tenant_id = t and slice_key = 'numberSeries') = before,
    'F: nothing written');
  r := public.masters_series_claim(gen_random_uuid(), 'RECEIPT');
  perform pg_temp.check(r->>'status' = 'not_found', 'F: a school without number series → not_found');
end $test$;

-- @section G: grants and the lock timeout
do $test$
begin
  perform pg_temp.check(has_function_privilege('service_role', 'public.masters_series_claim(uuid, text, text)', 'EXECUTE'),
    'G: service_role may claim');
  perform pg_temp.check(not has_function_privilege('anon', 'public.masters_series_claim(uuid, text, text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.masters_series_claim(uuid, text, text)', 'EXECUTE'),
    'G: anon / authenticated may not');
  perform pg_temp.check((select prosecdef and proconfig @> array['lock_timeout=5s'] and proconfig @> array['search_path=public']
      from pg_proc where oid = 'public.masters_series_claim(uuid, text, text)'::regprocedure),
    'G: security definer, search_path = public, lock_timeout = 5s');
end $test$;

rollback;
