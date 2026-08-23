-- Inventory & Procurement — Phase 8: the closing-stock journal.
--
-- This one is worth reading before changing, because the obvious answer is
-- the wrong one.
--
-- The instinct is to post opening stock and every stock adjustment to the
-- ledger. Under this chart they must not be. Purchases are expensed to Store
-- Purchases (5060) the moment goods arrive; there is no inventory asset
-- carried day to day. So:
--
--   * A stock adjustment — shrinkage, damage, a corrected count — has already
--     had its cost expensed at purchase. Writing it off again would expense
--     the same goods twice. It correctly has no journal; it simply means less
--     stock is left, which the closing-stock figure picks up on its own.
--
--   * A stock transfer moves value between locations and changes nothing the
--     books care about. No journal either.
--
--   * Opening stock at go-live is goods the school already owned, bought
--     before this system existed. Its cost belongs to the prior year's books,
--     not this one, so it must not be credited to this year's purchases. It
--     belongs in the ledger's own opening-balance flow — `ledger_open_balances`
--     — as Dr Closing Stock against the opening equity, alongside the school's
--     other opening balances. This module does not post it, on purpose.
--
-- What is genuinely missing, and is what this migration adds, is the period-
-- end entry: the goods still on the shelf were expensed but not consumed, so
-- their value is brought back onto the balance sheet.
--
--   Dr  Closing Stock (1090)      value on hand at the period end
--   Cr  Store Purchases (5060)    leaving the expense equal to what was used
--
-- and reversed at the start of the next period, so the stock becomes that
-- period's opening cost. That is ordinary periodic inventory, and without it
-- the surplus is understated by whatever is sitting in the store at year end.

/**
 * What the stock was worth on a given date.
 *
 * Quantity is summed from the ledger up to and including the date, so the
 * figure is what the books would have shown then, not what they show now.
 * Cost is the item's weighted average — the same number the valuation report
 * uses, so the journal and the report cannot disagree.
 */
create or replace function public.inv_stock_value_as_of(
  p_tenant_id uuid,
  p_as_of date
) returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(round(q.qty * i.avg_cost_paise)), 0)::bigint
    from (
      select l.item_id, sum(l.qty_delta) as qty
        from public.inv_stock_ledger l
       where l.tenant_id = p_tenant_id
         and l.at::date <= p_as_of
       group by l.item_id
      having sum(l.qty_delta) > 0
    ) q
    join public.inv_items i
      on i.id = q.item_id and i.tenant_id = p_tenant_id;
$$;

/**
 * Post the closing-stock journal for a period end.
 *
 * Any earlier closing-stock voucher is reversed first, dated the day after it
 * was raised. Two closing-stock balances must never sit in the books at once:
 * the previous period's stock has since been consumed or sold, and leaving it
 * there would overstate assets and understate cost for as long as it stood.
 *
 * Idempotent on the date, so re-running a month end lands once.
 */
create or replace function public.inv_ledger_post_closing_stock(
  p_tenant_id uuid,
  p_as_of date,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_value bigint;
  v_prior record;
  v_result jsonb;
  v_reversed text := null;
begin
  if not public.inv_ledger_active(p_tenant_id) then
    return jsonb_build_object('ok', false, 'error',
      'The server ledger is not set up for this school yet');
  end if;

  v_value := public.inv_stock_value_as_of(p_tenant_id, p_as_of);

  -- Already posted for this date? Say so rather than raising a second one.
  if exists (
    select 1 from public.ledger_vouchers
     where tenant_id = p_tenant_id
       and source_type = 'inv_closing_stock'
       and source_id = p_as_of::text
  ) then
    return jsonb_build_object(
      'ok', true, 'created', false, 'value_paise', v_value,
      'note', 'Closing stock for this date was already posted'
    );
  end if;

  if v_value <= 0 then
    return jsonb_build_object('ok', false, 'error',
      'There was no stock on hand at that date — nothing to bring back');
  end if;

  -- Retire the previous closing-stock entry before raising a new one.
  -- A reversal points back at what it undid (reverses_voucher_id), so an
  -- entry is still standing when nothing points at it.
  select v.id, v.voucher_no, v.voucher_date into v_prior
    from public.ledger_vouchers v
   where v.tenant_id = p_tenant_id
     and v.source_type = 'inv_closing_stock'
     and not exists (
       select 1 from public.ledger_vouchers r
        where r.tenant_id = p_tenant_id and r.reverses_voucher_id = v.id
     )
   order by v.voucher_date desc
   limit 1;

  if found then
    v_result := public.ledger_reverse(
      p_tenant_id, v_prior.id,
      'Opening stock for the period beginning ' || (v_prior.voucher_date + 1)::text,
      v_prior.voucher_date + 1, p_actor
    );
    if not coalesce((v_result->>'ok')::boolean, false) then
      raise exception 'Could not reverse the previous closing stock (%): %',
        v_prior.voucher_no, coalesce(v_result->>'error', 'unknown ledger error');
    end if;
    v_reversed := v_result->>'voucher_no';
  end if;

  v_result := public.ledger_post(p_tenant_id, jsonb_build_object(
    'voucher_type', 'journal',
    'date', p_as_of,
    'narration', 'Closing stock as at ' || p_as_of::text,
    'source_type', 'inv_closing_stock',
    'source_id', p_as_of::text,
    'created_by', p_actor,
    'lines', jsonb_build_array(
      jsonb_build_object(
        'account_code', '1090',
        'debit_paise', v_value,
        'credit_paise', 0,
        'narration', 'Stock on hand'
      ),
      jsonb_build_object(
        'account_code', '5060',
        'debit_paise', 0,
        'credit_paise', v_value,
        'narration', 'Purchases not yet consumed'
      )
    )
  ));

  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'The books refused the closing stock entry: %',
      coalesce(v_result->>'error', 'unknown ledger error');
  end if;

  return jsonb_build_object(
    'ok', true,
    'created', true,
    'value_paise', v_value,
    'voucher_no', v_result->>'voucher_no',
    'reversed_voucher_no', coalesce(v_reversed, '')
  );
end;
$$;

grant execute on function public.inv_stock_value_as_of(uuid, date) to service_role;
grant execute on function public.inv_ledger_post_closing_stock(uuid, date, text) to service_role;

notify pgrst, 'reload schema';
