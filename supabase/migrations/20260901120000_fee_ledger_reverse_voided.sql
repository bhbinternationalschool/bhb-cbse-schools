-- Voided fee receipts must be reversed in the server book.
--
-- fee_ledger_post_collection skipped a voided receipt and returned null, on
-- the comment that "its reversal is posted by whoever voids it". Nobody did.
-- Voiding on the desk writes a reversing DESK journal, which reaches the book
-- only through the desk mirror — and the mirror has never once succeeded
-- (production holds zero vouchers with a desk_ source type). The reversal
-- therefore fell in the gap between the two systems.
--
-- Result on production, and it GROWS with every void: measured twice a few
-- hours apart on 2026-09-01 it went from 40 voided / 35 unreversed to 58
-- voided / 53 unreversed, 2,35,950 of receipts given back but never taken off
-- the books. Receipts voided before they ever reached the book are correctly
-- absent from it and must stay absent — this reverses only what was booked.
--
-- The fix belongs here rather than on the desk. ledger_* is server truth: a
-- desk push cannot delete from it, so a reversal written here stays written,
-- and it applies no matter which browser or device did the voiding.

-- Reverse the ledger voucher behind one voided fee receipt.
--
-- Idempotent twice over: it does nothing unless the receipt is actually
-- voided, and ledger_reverse itself returns the existing reversal rather than
-- writing a second one. Safe to call on every sync of every receipt.
create or replace function public.fee_ledger_reverse_voided(
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
  v_orig record;
  v_result jsonb;
begin
  select * into v_v from public.fee_desk_vouchers
   where id = p_voucher_id and tenant_id = p_tenant_id;
  if not found or v_v.voided_at is null then
    return null;
  end if;

  -- The original posting. Absent when the receipt was voided before it ever
  -- reached the book, which is the correct state and needs no reversal.
  select * into v_orig from public.ledger_vouchers
   where tenant_id = p_tenant_id
     and source_type = 'fee_voucher'
     and source_id = p_voucher_id
     and voucher_type <> 'reversal'
   order by created_at
   limit 1;
  if not found then
    return null;
  end if;

  v_result := public.ledger_reverse(
    p_tenant_id,
    v_orig.id,
    -- fee_desk_vouchers stores no void reason (the desk keeps it locally),
    -- so the receipt number is the useful thing to carry into the book.
    'Voided fee receipt ' || coalesce(v_v.receipt_no, p_voucher_id),
    -- Reverse on the day of the void, not the day of the receipt: a receipt
    -- taken in April and voided in August did earn income in April, and
    -- back-dating the reversal would rewrite a month that may be locked.
    greatest(v_orig.voucher_date, v_v.voided_at::date),
    p_actor
  );

  if coalesce((v_result->>'ok')::boolean, false) then
    return v_result->>'voucher_no';
  end if;
  return null;
end;
$function$;

-- A voided receipt now reverses instead of being silently skipped.
--
-- Done in the TRIGGER, not in fee_ledger_post_collection.
--
-- post_collection is the function that books every receipt in the school, and
-- changing it here would mean reproducing its whole body in this migration.
-- A first attempt at exactly that got the tender columns wrong (`v_t.ref`,
-- and the bank id lives in tender_json) and dropped the inv_ledger_active
-- guard — a silent change to how every receipt posts. The trigger is small,
-- it already fires on update of fee_desk_vouchers, and branching here leaves
-- the posting path untouched.
--
-- post_collection keeps returning null for a voided receipt, which stays
-- correct: it must not book income for one.
create or replace function public.fee_ledger_autopost()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_voucher_id text;
  v_tenant uuid;
  v_voided timestamptz;
begin
  if tg_table_name = 'fee_desk_vouchers' then
    v_voucher_id := new.id;
    v_tenant := new.tenant_id;
  else
    v_voucher_id := new.voucher_id;
    v_tenant := new.tenant_id;
  end if;

  select fv.voided_at into v_voided
    from public.fee_desk_vouchers fv
   where fv.id = v_voucher_id and fv.tenant_id = v_tenant;

  begin
    if v_voided is not null then
      -- Voided: take the original back off the books.
      perform public.fee_ledger_reverse_voided(v_tenant, v_voucher_id, 'counter');
    else
      perform public.fee_ledger_post_collection(v_tenant, v_voucher_id, 'counter');
    end if;
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

-- One-time sweep for the receipts voided before the rule above existed.
--
-- Returns how many were reversed. Idempotent, so it can be run again safely
-- and will report 0 once the backlog is clear.
create or replace function public.fee_ledger_reverse_voided_backlog(
  p_tenant_id uuid,
  p_actor text default 'backfill'
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  v_no text;
  v_done int := 0;
  v_seen int := 0;
begin
  for r in
    select fv.id
      from public.fee_desk_vouchers fv
     where fv.tenant_id = p_tenant_id
       and fv.voided_at is not null
       -- Booked, and not already reversed. Without the second half the sweep
       -- would keep counting receipts it had already dealt with and report
       -- the same backlog every run — ledger_reverse would return the
       -- existing reversal, so nothing doubles, but the number would lie.
       and exists (
         select 1 from public.ledger_vouchers lv
          where lv.tenant_id = p_tenant_id
            and lv.source_type = 'fee_voucher'
            and lv.source_id = fv.id
            and lv.voucher_type <> 'reversal'
            and not exists (
              select 1 from public.ledger_vouchers rv
               where rv.tenant_id = p_tenant_id
                 and rv.reverses_voucher_id = lv.id
            )
       )
     order by fv.voided_at
  loop
    v_seen := v_seen + 1;
    v_no := public.fee_ledger_reverse_voided(p_tenant_id, r.id, p_actor);
    if v_no is not null then
      v_done := v_done + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'considered', v_seen, 'reversed', v_done);
end;
$function$;

notify pgrst, 'reload schema';
