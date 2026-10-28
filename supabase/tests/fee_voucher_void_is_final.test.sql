-- Behavioural test for 20261015090000_fee_voucher_void_is_final (15 Oct 2026):
-- a voided receipt stays voided whatever a later save sends.
--
-- Runs in CI against the E2E stack (every migration on Postgres 17):
--   bash scripts/e2e-stack.sh sql-test supabase/tests/fee_voucher_void_is_final.test.sql
-- It makes its own probe school, works inside one transaction and rolls it
-- back — nothing it does survives. Any failed check raises, and psql
-- (ON_ERROR_STOP) exits non-zero. Never point it at production.

\set ON_ERROR_STOP 1
begin;

do $test$
declare
  t uuid := gen_random_uuid();
  v_void timestamptz := '2026-10-14 09:00:00+00';
  got timestamptz;
  note_now text;
begin
  insert into public.tenants (id, slug, name) values (t, 'void-probe-' || left(t::text, 8), 'Void probe');

  insert into public.fee_desk_vouchers (id, tenant_id, academic_year_code, receipt_no, collection_date,
                                        transaction_date, total_paise)
  values ('vp_live', t, '2026-27', 'VP-1', '2026-10-14', '2026-10-14', 100000),
         ('vp_void', t, '2026-27', 'VP-2', '2026-10-14', '2026-10-14', 50000);

  -- 1. Voiding a live receipt still works.
  update public.fee_desk_vouchers set voided_at = v_void where id = 'vp_live' and tenant_id = t;
  select voided_at into got from public.fee_desk_vouchers where id = 'vp_live' and tenant_id = t;
  if got is distinct from v_void then
    raise exception 'FAILED: voiding a live receipt (got %)', got;
  end if;

  -- 2. A plain update that clears voided_at keeps the void.
  update public.fee_desk_vouchers set voided_at = null where id = 'vp_live' and tenant_id = t;
  select voided_at into got from public.fee_desk_vouchers where id = 'vp_live' and tenant_id = t;
  if got is distinct from v_void then
    raise exception 'FAILED: update set voided_at = null un-voided the receipt (got %)', got;
  end if;

  -- 3. The whole-desk push's shape — an upsert from a stale copy that carries
  --    voided_at null and a changed note — keeps the void and applies the rest.
  update public.fee_desk_vouchers set voided_at = v_void where id = 'vp_void' and tenant_id = t;
  insert into public.fee_desk_vouchers (id, tenant_id, academic_year_code, receipt_no, collection_date,
                                        transaction_date, total_paise, note, voided_at)
  values ('vp_void', t, '2026-27', 'VP-2', '2026-10-14', '2026-10-14', 50000, 'stale copy edit', null)
  on conflict (id) do update set
    note = excluded.note, voided_at = excluded.voided_at, total_paise = excluded.total_paise;
  select voided_at, note into got, note_now from public.fee_desk_vouchers where id = 'vp_void' and tenant_id = t;
  if got is distinct from v_void then
    raise exception 'FAILED: a stale upsert un-voided the receipt (got %)', got;
  end if;
  if note_now is distinct from 'stale copy edit' then
    raise exception 'FAILED: the rest of the stale save was not applied (note %)', note_now;
  end if;

  -- 4. A save that does not touch voided_at leaves a live receipt live.
  update public.fee_desk_vouchers set note = 'just a note' where id = 'vp_void' and tenant_id = t;
  insert into public.fee_desk_vouchers (id, tenant_id, academic_year_code, receipt_no, collection_date,
                                        transaction_date, total_paise)
  values ('vp_new', t, '2026-27', 'VP-3', '2026-10-14', '2026-10-14', 7000);
  update public.fee_desk_vouchers set voided_at = null, note = 'still live' where id = 'vp_new' and tenant_id = t;
  select voided_at into got from public.fee_desk_vouchers where id = 'vp_new' and tenant_id = t;
  if got is not null then
    raise exception 'FAILED: a live receipt became voided (got %)', got;
  end if;

  raise notice 'fee_voucher_void_is_final: 4 checks passed';
end
$test$;

rollback;
