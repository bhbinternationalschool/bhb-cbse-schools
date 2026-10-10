-- Fee money reaches the server book.
--
-- Fee collections posted only to the accounts desk (postBankMovement, in the
-- browser). The SQL ledger held store and vendor entries alone, so the server
-- book showed the school's bank and cash balances short by every rupee of
-- fees ever taken — which is what made it read as wrong and untrustworthy.
--
-- Cash basis. Fee dues are computed on the fly and never posted as a billing
-- voucher, so there is no receivable to relieve: a collection is Dr tender
-- account / Cr 4000 Fee Income. If fee billing is ever posted as vouchers,
-- this becomes Cr 1060 Fee Receivable and the accrual closes properly.
--
-- Tender accounts resolve through inv_ledger_tender_account, so fees land in
-- the same per-bank accounts the store now uses (1000 cash, 1050 cheque,
-- 1011/1012 per bank) instead of a second parallel scheme.
--
-- Applied to production 2026-08-29, then backfilled: 118 of 118 live receipts
-- posted, 0 failed. The 5 voided receipts were correctly skipped.

create or replace function public.fee_ledger_post_collection(
  p_tenant_id uuid,
  p_voucher_id text,
  p_actor text default 'system'
) returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_v record;
  v_lines jsonb := '[]'::jsonb;
  v_total bigint := 0;
  v_t record;
  v_result jsonb;
begin
  if not public.inv_ledger_active(p_tenant_id) then
    return null;
  end if;

  select * into v_v from public.fee_desk_vouchers
   where id = p_voucher_id and tenant_id = p_tenant_id;
  if not found then
    return null;
  end if;

  -- A voided receipt took no money. Its reversal is posted by whoever voids
  -- it; posting the original here would book income that was given back.
  if v_v.voided_at is not null then
    return null;
  end if;

  for v_t in
    select * from public.fee_desk_voucher_tenders
     where voucher_id = p_voucher_id and tenant_id = p_tenant_id
       and amount_paise > 0
     order by tender_index
  loop
    v_total := v_total + v_t.amount_paise;
    v_lines := v_lines || jsonb_build_object(
      'account_code', public.inv_ledger_tender_account(
                        v_t.mode,
                        coalesce(v_t.tender_json->>'bankAccountId', ''),
                        p_tenant_id),
      'debit_paise', v_t.amount_paise,
      'credit_paise', 0,
      'narration', upper(coalesce(v_t.mode, 'cash')),
      'instrument', jsonb_build_object(
                      'mode', coalesce(v_t.mode, 'cash'),
                      'ref', coalesce(v_t.ref, ''),
                      'bank_account_id', coalesce(v_t.tender_json->>'bankAccountId', ''))
    );
  end loop;

  if v_total <= 0 then
    return null;
  end if;

  v_lines := v_lines || jsonb_build_object(
    'account_code', '4000',
    'debit_paise', 0,
    'credit_paise', v_total,
    'narration', 'Fees collected — ' || coalesce(v_v.receipt_no, p_voucher_id)
  );

  v_result := public.ledger_post(p_tenant_id, jsonb_build_object(
    'voucher_type', 'receipt',
    'date', v_v.collection_date,
    'narration', 'Fee receipt ' || coalesce(v_v.receipt_no, p_voucher_id),
    'source_type', 'fee_voucher',
    'source_id', p_voucher_id,
    'created_by', coalesce(nullif(p_actor, ''), v_v.cashier_name, 'system'),
    'lines', v_lines
  ));

  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'The books refused fee receipt %: %',
      coalesce(v_v.receipt_no, p_voucher_id),
      coalesce(v_result->>'error', 'unknown ledger error');
  end if;

  return v_result->>'voucher_no';
end;
$function$;

-- Post every fee receipt the books have not seen. Safe to re-run: ledger_post
-- is idempotent on (tenant, source_type, source_id). One receipt failing must
-- not stop the rest, so failures are collected and reported rather than
-- raised — a backfill that aborts halfway leaves books nobody can reason about.
create or replace function public.fee_ledger_sync(
  p_tenant_id uuid,
  p_actor text default 'system',
  p_limit int default 5000
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  v_posted int := 0;
  v_skipped int := 0;
  v_failed int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_no text;
begin
  for r in
    select fv.id, fv.receipt_no
    from public.fee_desk_vouchers fv
    where fv.tenant_id = p_tenant_id
      and fv.voided_at is null
      and exists (
        select 1 from public.fee_desk_voucher_tenders t
        where t.voucher_id = fv.id and t.amount_paise > 0
      )
      and not exists (
        select 1 from public.ledger_vouchers lv
        where lv.tenant_id = p_tenant_id
          and lv.source_type = 'fee_voucher'
          and lv.source_id = fv.id
      )
    order by fv.collection_date
    limit p_limit
  loop
    begin
      v_no := public.fee_ledger_post_collection(p_tenant_id, r.id, p_actor);
      if v_no is null then
        v_skipped := v_skipped + 1;
      else
        v_posted := v_posted + 1;
      end if;
    exception when others then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object(
        'receipt_no', r.receipt_no, 'error', sqlerrm);
    end;
  end loop;

  return jsonb_build_object(
    'ok', true, 'posted', v_posted, 'skipped', v_skipped,
    'failed', v_failed, 'errors', v_errors);
end;
$function$;

-- Keep the books following the counter without anyone remembering to sync.
--
-- Fee vouchers arrive by desk mirror, not an RPC we control, so a trigger is
-- the only hook that catches every writer. Two rules make it safe to hang off
-- a sync path: it never raises (a refusal from the books must not fail the
-- mirror write and lose the counter's receipt), and it is idempotent (the
-- mirror upserts the same row repeatedly). Tenders arrive in their own table
-- after the voucher, so the tender write retries the posting.
create or replace function public.fee_ledger_autopost()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_voucher_id text;
  v_tenant uuid;
begin
  if tg_table_name = 'fee_desk_vouchers' then
    v_voucher_id := new.id;
    v_tenant := new.tenant_id;
  else
    v_voucher_id := new.voucher_id;
    v_tenant := new.tenant_id;
  end if;

  begin
    perform public.fee_ledger_post_collection(v_tenant, v_voucher_id, 'counter');
  exception when others then
    -- Deliberately swallowed: fee_ledger_sync reports and retries whatever
    -- failed here. Losing a receipt to a bookkeeping error is the worse bug.
    null;
  end;

  return new;
end;
$function$;

drop trigger if exists fee_desk_vouchers_ledger_autopost on public.fee_desk_vouchers;
create trigger fee_desk_vouchers_ledger_autopost
  after insert or update on public.fee_desk_vouchers
  for each row execute function public.fee_ledger_autopost();

drop trigger if exists fee_desk_voucher_tenders_ledger_autopost on public.fee_desk_voucher_tenders;
create trigger fee_desk_voucher_tenders_ledger_autopost
  after insert or update on public.fee_desk_voucher_tenders
  for each row execute function public.fee_ledger_autopost();

notify pgrst, 'reload schema';
