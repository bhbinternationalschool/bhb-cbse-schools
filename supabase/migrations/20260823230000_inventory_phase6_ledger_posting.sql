-- Inventory & Procurement — Phase 6: post store sales into Ledger v2.
--
-- Sales, collections, returns and cancellations now reach the server book at
-- the moment they happen, from inside the same transaction that moves the
-- stock. `ledger_post` is plain plpgsql and the ledger's own RPCs already call
-- it internally, so this is the intended door rather than a side entrance.
--
-- Why in-transaction: the old desk fired its postings from floating promises
-- that ended in `.catch(() => {})`, so a refused posting left the issue saved
-- and the books untouched with nothing surfaced. Posting inside the sale means
-- a refusal — a locked period, a missing account — rolls the sale back and the
-- clerk is told. Stock never moves without its entry.
--
-- What is NOT posted here: cost of goods sold. This chart expenses purchases
-- to "Store Purchases" (5060) when goods are received rather than capitalising
-- them into an inventory asset, so also posting COGS on sale would count the
-- same cost twice. The store's own valuation report carries stock value; the
-- books carry the expense.
--
-- Discount is netted against income rather than shown as an expense: it is a
-- trade discount off the counter price, not a concession the school funds.

/* ─── Helpers ──────────────────────────────────────────────── */

/**
 * Is the server ledger actually in use for this tenant?
 *
 * A school that has not opened Ledger v2 has no accounts seeded, and every
 * posting would fail on "no ledger account with code 4200". Blocking the shop
 * counter over books nobody has opened would be absurd — so sales post only
 * once the ledger exists. Once it does, posting is mandatory: a ledger in use
 * that silently misses sales is worse than one that is plainly not in use.
 */
create or replace function public.inv_ledger_active(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.ledger_accounts
     where tenant_id = p_tenant_id and code = '4200'
  );
$$;

/** Which account a tender lands in — the same mapping fee receipts use. */
create or replace function public.inv_ledger_tender_account(p_mode text)
returns text
language sql
immutable
as $$
  select case lower(coalesce(p_mode, ''))
           when 'cash' then '1000'
           when 'cheque' then '1050'
           when 'dd' then '1050'
           else '1010'
         end;
$$;

/**
 * Post one store sale, and raise if the ledger refuses.
 *
 * Returns the voucher number, or null when the ledger is not in use.
 */
create or replace function public.inv_ledger_post_sale(
  p_tenant_id uuid,
  p_sale_id uuid,
  p_actor text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale record;
  v_lines jsonb := '[]'::jsonb;
  v_party jsonb;
  v_net bigint;
  v_result jsonb;
  v_pay record;
begin
  if not public.inv_ledger_active(p_tenant_id) then
    return null;
  end if;

  select * into v_sale from public.inv_sales
   where id = p_sale_id and tenant_id = p_tenant_id;
  if not found or v_sale.status = 'void' then
    return null;
  end if;

  -- Income net of discount; GST is a liability, not income.
  v_net := v_sale.subtotal_paise - v_sale.discount_paise;

  v_party := case
    when v_sale.buyer_kind = 'student' and coalesce(v_sale.student_id, '') <> ''
      then jsonb_build_object('kind', 'student', 'external_id', v_sale.student_id,
                              'name', coalesce(v_sale.buyer_name, ''))
    when v_sale.buyer_kind = 'staff' and coalesce(v_sale.staff_id, '') <> ''
      then jsonb_build_object('kind', 'staff', 'external_id', v_sale.staff_id,
                              'name', coalesce(v_sale.buyer_name, ''))
    else null
  end;

  -- Debit what was actually taken, per tender.
  for v_pay in
    select mode, sum(amount_paise) as amt
      from public.inv_sale_payments
     where tenant_id = p_tenant_id and sale_id = p_sale_id
     group by mode
  loop
    if v_pay.amt > 0 then
      v_lines := v_lines || jsonb_build_object(
        'account_code', public.inv_ledger_tender_account(v_pay.mode),
        'debit_paise', v_pay.amt,
        'credit_paise', 0,
        'narration', upper(v_pay.mode),
        'party', v_party
      );
    end if;
  end loop;

  -- Debit what is still owed.
  if v_sale.balance_paise > 0 then
    v_lines := v_lines || jsonb_build_object(
      'account_code', '1040',
      'debit_paise', v_sale.balance_paise,
      'credit_paise', 0,
      'narration', 'Store dues — ' || coalesce(v_sale.buyer_name, ''),
      'party', v_party
    );
  end if;

  if v_net > 0 then
    v_lines := v_lines || jsonb_build_object(
      'account_code', '4200',
      'debit_paise', 0,
      'credit_paise', v_net,
      'narration', 'Store sale ' || v_sale.sale_no
    );
  end if;

  if v_sale.tax_paise > 0 then
    v_lines := v_lines || jsonb_build_object(
      'account_code', '2340',
      'debit_paise', 0,
      'credit_paise', v_sale.tax_paise,
      'narration', 'GST on ' || v_sale.sale_no
    );
  end if;

  if jsonb_array_length(v_lines) < 2 then
    return null;
  end if;

  v_result := public.ledger_post(p_tenant_id, jsonb_build_object(
    'voucher_type', 'sales',
    'date', v_sale.sale_date,
    'narration', 'Store sale ' || v_sale.sale_no ||
                 case when coalesce(v_sale.buyer_name, '') = '' then ''
                      else ' — ' || v_sale.buyer_name end,
    'source_type', 'inv_sale',
    'source_id', p_sale_id::text,
    'created_by', p_actor,
    'lines', v_lines
  ));

  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'The books refused this sale: %',
      coalesce(v_result->>'error', 'unknown ledger error');
  end if;

  return v_result->>'voucher_no';
end;
$$;

/**
 * Post a collection against an existing sale's balance.
 *
 * Dr the tender, Cr Store Receivable — the mirror image of the receivable the
 * sale raised. Keyed on the payment row so a replay lands once.
 */
create or replace function public.inv_ledger_post_collection(
  p_tenant_id uuid,
  p_payment_id uuid,
  p_actor text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay record;
  v_sale record;
  v_party jsonb;
  v_result jsonb;
begin
  if not public.inv_ledger_active(p_tenant_id) then
    return null;
  end if;

  select * into v_pay from public.inv_sale_payments
   where id = p_payment_id and tenant_id = p_tenant_id;
  if not found or v_pay.amount_paise <= 0 then
    return null;
  end if;

  select * into v_sale from public.inv_sales
   where id = v_pay.sale_id and tenant_id = p_tenant_id;
  if not found then
    return null;
  end if;

  v_party := case
    when v_sale.buyer_kind = 'student' and coalesce(v_sale.student_id, '') <> ''
      then jsonb_build_object('kind', 'student', 'external_id', v_sale.student_id,
                              'name', coalesce(v_sale.buyer_name, ''))
    when v_sale.buyer_kind = 'staff' and coalesce(v_sale.staff_id, '') <> ''
      then jsonb_build_object('kind', 'staff', 'external_id', v_sale.staff_id,
                              'name', coalesce(v_sale.buyer_name, ''))
    else null
  end;

  v_result := public.ledger_post(p_tenant_id, jsonb_build_object(
    'voucher_type', 'receipt',
    'date', v_pay.paid_on,
    'narration', 'Store dues collected — ' || v_sale.sale_no,
    'source_type', 'inv_sale_payment',
    'source_id', p_payment_id::text,
    'created_by', p_actor,
    'lines', jsonb_build_array(
      jsonb_build_object(
        'account_code', public.inv_ledger_tender_account(v_pay.mode),
        'debit_paise', v_pay.amount_paise,
        'credit_paise', 0,
        'narration', upper(v_pay.mode),
        'instrument', jsonb_build_object('mode', v_pay.mode,
                                         'ref', coalesce(v_pay.reference, '')),
        'party', v_party
      ),
      jsonb_build_object(
        'account_code', '1040',
        'debit_paise', 0,
        'credit_paise', v_pay.amount_paise,
        'narration', 'Store dues settled',
        'party', v_party
      )
    )
  ));

  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'The books refused this collection: %',
      coalesce(v_result->>'error', 'unknown ledger error');
  end if;

  return v_result->>'voucher_no';
end;
$$;

/**
 * Post a sale return.
 *
 * Dr Store Sales Income and Dr GST Payable to undo the sale's credits, then
 * Cr whatever actually gave the value back: cash out for a refund, or the
 * receivable for a credit against what is still owed.
 */
create or replace function public.inv_ledger_post_sale_return(
  p_tenant_id uuid,
  p_return_id uuid,
  p_actor text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ret record;
  v_sale record;
  v_party jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_credit_left bigint;
  v_result jsonb;
begin
  if not public.inv_ledger_active(p_tenant_id) then
    return null;
  end if;

  select * into v_ret from public.inv_sale_returns
   where id = p_return_id and tenant_id = p_tenant_id;
  if not found or v_ret.total_paise <= 0 then
    return null;
  end if;

  select * into v_sale from public.inv_sales
   where id = v_ret.sale_id and tenant_id = p_tenant_id;

  v_party := case
    when v_sale.buyer_kind = 'student' and coalesce(v_sale.student_id, '') <> ''
      then jsonb_build_object('kind', 'student', 'external_id', v_sale.student_id,
                              'name', coalesce(v_sale.buyer_name, ''))
    when v_sale.buyer_kind = 'staff' and coalesce(v_sale.staff_id, '') <> ''
      then jsonb_build_object('kind', 'staff', 'external_id', v_sale.staff_id,
                              'name', coalesce(v_sale.buyer_name, ''))
    else null
  end;

  if v_ret.subtotal_paise > 0 then
    v_lines := v_lines || jsonb_build_object(
      'account_code', '4200',
      'debit_paise', v_ret.subtotal_paise,
      'credit_paise', 0,
      'narration', 'Return ' || v_ret.return_no
    );
  end if;

  if v_ret.tax_paise > 0 then
    v_lines := v_lines || jsonb_build_object(
      'account_code', '2340',
      'debit_paise', v_ret.tax_paise,
      'credit_paise', 0,
      'narration', 'GST on return ' || v_ret.return_no
    );
  end if;

  -- Money handed back first, then whatever is left credits the receivable.
  v_credit_left := v_ret.total_paise;
  if v_ret.refunded_paise > 0 then
    v_lines := v_lines || jsonb_build_object(
      'account_code',
        public.inv_ledger_tender_account(coalesce(v_ret.refund_mode, 'cash')),
      'debit_paise', 0,
      'credit_paise', v_ret.refunded_paise,
      'narration', 'Refunded',
      'party', v_party
    );
    v_credit_left := v_credit_left - v_ret.refunded_paise;
  end if;

  if v_credit_left > 0 then
    v_lines := v_lines || jsonb_build_object(
      'account_code', '1040',
      'debit_paise', 0,
      'credit_paise', v_credit_left,
      'narration', 'Credited against store dues',
      'party', v_party
    );
  end if;

  if jsonb_array_length(v_lines) < 2 then
    return null;
  end if;

  v_result := public.ledger_post(p_tenant_id, jsonb_build_object(
    'voucher_type', 'sales',
    'date', v_ret.return_date,
    'narration', 'Store return ' || v_ret.return_no || ' against ' || v_sale.sale_no,
    'source_type', 'inv_sale_return',
    'source_id', p_return_id::text,
    'created_by', p_actor,
    'lines', v_lines
  ));

  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'The books refused this return: %',
      coalesce(v_result->>'error', 'unknown ledger error');
  end if;

  return v_result->>'voucher_no';
end;
$$;

/**
 * Reverse a cancelled sale's voucher.
 *
 * The ledger records a cancellation as a reversing voucher, never by deleting
 * or flagging the original — so the book still shows what was posted and what
 * undid it.
 */
create or replace function public.inv_ledger_reverse_sale(
  p_tenant_id uuid,
  p_sale_id uuid,
  p_reason text,
  p_actor text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_voucher_id uuid;
  v_result jsonb;
begin
  if not public.inv_ledger_active(p_tenant_id) then
    return null;
  end if;

  select id into v_voucher_id from public.ledger_vouchers
   where tenant_id = p_tenant_id
     and source_type = 'inv_sale'
     and source_id = p_sale_id::text;
  if v_voucher_id is null then
    return null;
  end if;

  v_result := public.ledger_reverse(p_tenant_id, v_voucher_id, p_reason, null, p_actor);

  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'The books refused this cancellation: %',
      coalesce(v_result->>'error', 'unknown ledger error');
  end if;

  return v_result->>'voucher_no';
end;
$$;

grant execute on function public.inv_ledger_active(uuid) to service_role;
grant execute on function public.inv_ledger_tender_account(text) to service_role;
grant execute on function public.inv_ledger_post_sale(uuid, uuid, text) to service_role;
grant execute on function public.inv_ledger_post_collection(uuid, uuid, text) to service_role;
grant execute on function public.inv_ledger_post_sale_return(uuid, uuid, text) to service_role;
grant execute on function public.inv_ledger_reverse_sale(uuid, uuid, text, text) to service_role;

notify pgrst, 'reload schema';

/* ─── Wire the posting into the sale paths ─────────────────── */

-- The Phase 3 functions are renamed to `*_core` and kept exactly as they were
-- tested; thin wrappers take their old names and add the ledger posting. This
-- is preferred over re-emitting two hundred lines of proven logic with one
-- call spliced in, where a transcription slip would be invisible.
--
-- Guarded so re-running this migration is a no-op rather than an error.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'inv_post_sale'
       and pg_get_function_identity_arguments(p.oid) = 'p_tenant_id uuid, p_actor text, p_payload jsonb'
  ) and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'inv_post_sale_core'
  ) then
    alter function public.inv_post_sale(uuid, text, jsonb) rename to inv_post_sale_core;
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'inv_post_sale_return'
  ) and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'inv_post_sale_return_core'
  ) then
    alter function public.inv_post_sale_return(uuid, text, jsonb) rename to inv_post_sale_return_core;
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'inv_void_sale'
  ) and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'inv_void_sale_core'
  ) then
    alter function public.inv_void_sale(uuid, text, uuid, text) rename to inv_void_sale_core;
  end if;
end
$$;
-- applied migration makes the file disagree with the database.

-- Sale: post after the totals are final, inside the same transaction.
create or replace function public.inv_post_sale(
  p_tenant_id uuid,
  p_actor text,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inner jsonb;
  v_sale_id uuid;
  v_voucher text;
begin
  v_inner := public.inv_post_sale_core(p_tenant_id, p_actor, p_payload);
  v_sale_id := (v_inner->>'sale_id')::uuid;

  -- Raises on refusal, which rolls the whole sale back. Stock must never move
  -- without the entry that explains it.
  v_voucher := public.inv_ledger_post_sale(p_tenant_id, v_sale_id, p_actor);

  return v_inner || jsonb_build_object('ledger_voucher_no', coalesce(v_voucher, ''));
end;
$$;

-- Sale return: same rule.
create or replace function public.inv_post_sale_return(
  p_tenant_id uuid,
  p_actor text,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inner jsonb;
  v_voucher text;
begin
  v_inner := public.inv_post_sale_return_core(p_tenant_id, p_actor, p_payload);
  v_voucher := public.inv_ledger_post_sale_return(
    p_tenant_id, (v_inner->>'return_id')::uuid, p_actor);
  return v_inner || jsonb_build_object('ledger_voucher_no', coalesce(v_voucher, ''));
end;
$$;

-- Cancelling a sale reverses its voucher rather than deleting it.
create or replace function public.inv_void_sale(
  p_tenant_id uuid,
  p_actor text,
  p_sale_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inner jsonb;
  v_voucher text;
begin
  v_voucher := public.inv_ledger_reverse_sale(p_tenant_id, p_sale_id, p_reason, p_actor);
  v_inner := public.inv_void_sale_core(p_tenant_id, p_actor, p_sale_id, p_reason);
  return v_inner || jsonb_build_object('ledger_voucher_no', coalesce(v_voucher, ''));
end;
$$;

/**
 * Collect against an outstanding sale balance, and post the receipt.
 *
 * Moved into SQL from the TypeScript path so the payment row, the sale's new
 * balance and the ledger receipt commit together. Previously these were three
 * separate requests, any of which could land without the others.
 */
create or replace function public.inv_collect_on_sale(
  p_tenant_id uuid,
  p_actor text,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale record;
  v_amount bigint := coalesce((p_payload->>'amount_paise')::bigint, 0);
  v_mode text := coalesce(p_payload->>'mode', 'cash');
  v_paid_on date := coalesce(nullif(p_payload->>'paid_on', '')::date, current_date);
  v_payment_id uuid;
  v_paid bigint;
  v_balance bigint;
  v_status text;
  v_voucher text;
begin
  if v_amount <= 0 then
    raise exception 'Amount must be more than zero';
  end if;

  select * into v_sale from public.inv_sales
   where id = (p_payload->>'sale_id')::uuid and tenant_id = p_tenant_id
   for update;
  if not found then
    raise exception 'Sale not found';
  end if;
  if v_sale.status = 'void' then
    raise exception 'That sale was cancelled';
  end if;
  if v_amount > v_sale.balance_paise then
    raise exception 'Only % is outstanding on this sale',
      to_char(v_sale.balance_paise / 100.0, 'FM999999990.00');
  end if;

  insert into public.inv_sale_payments (
    tenant_id, sale_id, paid_on, amount_paise, mode, reference, note, created_by
  ) values (
    p_tenant_id, v_sale.id, v_paid_on, v_amount, v_mode,
    coalesce(p_payload->>'reference', ''), coalesce(p_payload->>'note', ''), p_actor
  ) returning id into v_payment_id;

  v_paid := v_sale.paid_paise + v_amount;
  v_balance := greatest(0, v_sale.balance_paise - v_amount);
  v_status := case when v_balance <= 0 then 'paid' else 'part_paid' end;

  update public.inv_sales
     set paid_paise = v_paid, balance_paise = v_balance,
         status = v_status, updated_at = now()
   where id = v_sale.id and tenant_id = p_tenant_id;

  v_voucher := public.inv_ledger_post_collection(p_tenant_id, v_payment_id, p_actor);

  return jsonb_build_object(
    'payment_id', v_payment_id,
    'paid_paise', v_paid,
    'balance_paise', v_balance,
    'status', v_status,
    'ledger_voucher_no', coalesce(v_voucher, '')
  );
end;
$$;

grant execute on function public.inv_collect_on_sale(uuid, text, jsonb) to service_role;
