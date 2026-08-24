-- One payment, several children, a receipt each.
--
-- A parent with three children in the school buys books for all three and pays
-- once. Until now the counter could only serve one child at a time, so the
-- clerk either made three sales and split the cash by hand, or put everything
-- on the eldest — which leaves the other two looking as if they never
-- collected anything, and leaves one balance that cannot be split when the
-- parent later pays for only one of them.
--
-- The design decision worth stating: this posts ONE SALE PER CHILD, not one
-- sale for the household. Each child keeps their own receipt, their own dues
-- line at the fee counter, and their own ledger party. Only the PAYMENT is
-- shared, and it is spread across the children's sales in the order given.
--
-- It is one transaction. Three children either all get their books and their
-- receipts, or none of them do and the drawer is untouched. A partial
-- household sale — two receipts printed, the third failing after the parent
-- has handed over the money — is the outcome this exists to make impossible.

/**
 * Sell to several children of one household against a single payment.
 *
 * `p_payload.sales` is an array of ordinary sale payloads (the same shape
 * `inv_post_sale` takes), minus their payments. `p_payload.payments` is the
 * money as it actually arrived — cash, UPI, or both — and is applied across
 * the resulting sales in order until it runs out. Whatever is left unpaid
 * stays as each child's own balance, exactly as a single-child credit sale
 * would.
 */
create or replace function public.inv_post_household_sale(
  p_tenant_id uuid,
  p_actor text,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sales jsonb := coalesce(p_payload->'sales', '[]'::jsonb);
  v_payments jsonb := coalesce(p_payload->'payments', '[]'::jsonb);
  v_sale jsonb;
  v_pay jsonb;
  v_res jsonb;
  v_posted jsonb := '[]'::jsonb;
  v_ids uuid[] := '{}';
  v_balances bigint[] := '{}';
  v_total bigint := 0;
  v_tendered bigint := 0;
  v_left bigint;
  v_take bigint;
  v_i int;
  v_collect jsonb;
begin
  if jsonb_array_length(v_sales) = 0 then
    raise exception 'A household sale needs at least one child';
  end if;

  -- 1. Post each child's sale with no payment attached. Any refusal — a
  --    discount over its cap, a locked period, stock rules — raises here and
  --    takes every sibling's sale down with it.
  for v_sale in select * from jsonb_array_elements(v_sales)
  loop
    v_res := public.inv_post_sale(
      p_tenant_id, p_actor,
      (v_sale - 'payments') || jsonb_build_object('payments', '[]'::jsonb)
    );
    v_ids := v_ids || (v_res->>'sale_id')::uuid;
    v_balances := v_balances || (v_res->>'balance_paise')::bigint;
    v_total := v_total + (v_res->>'total_paise')::bigint;
    v_posted := v_posted || jsonb_build_object(
      'sale_id', v_res->>'sale_id',
      'sale_no', v_res->>'sale_no',
      'student_id', v_sale->>'student_id',
      'buyer_name', v_sale->>'buyer_name',
      'total_paise', (v_res->>'total_paise')::bigint
    );
  end loop;

  -- 2. Refuse money that exceeds what the children actually owe, before any
  --    of it is applied. Taking an over-payment and then discovering it while
  --    half-allocated is how a parent ends up credited on one child and short
  --    on another.
  for v_pay in select * from jsonb_array_elements(v_payments)
  loop
    v_tendered := v_tendered + coalesce((v_pay->>'amount_paise')::bigint, 0);
  end loop;
  if v_tendered > v_total then
    raise exception
      'Tendered % is more than the % these children owe between them',
      to_char(v_tendered / 100.0, 'FM999999990.00'),
      to_char(v_total / 100.0, 'FM999999990.00');
  end if;

  -- 3. Spread the payment across the children in the order they were served.
  --    Each slice goes through inv_collect_on_sale, so every child's ledger
  --    entry and running balance are made the same way a single sale's would
  --    be — there is no second code path to drift.
  for v_pay in select * from jsonb_array_elements(v_payments)
  loop
    v_left := coalesce((v_pay->>'amount_paise')::bigint, 0);
    if v_left <= 0 then
      continue;
    end if;

    v_i := 1;
    while v_i <= array_length(v_ids, 1) and v_left > 0
    loop
      v_take := least(v_left, v_balances[v_i]);
      if v_take > 0 then
        v_collect := public.inv_collect_on_sale(
          p_tenant_id, p_actor,
          jsonb_build_object(
            'sale_id', v_ids[v_i]::text,
            'amount_paise', v_take,
            'mode', coalesce(v_pay->>'mode', 'cash'),
            'reference', coalesce(v_pay->>'reference', ''),
            'note', 'Household payment'
          )
        );
        v_balances[v_i] := (v_collect->>'balance_paise')::bigint;
        v_left := v_left - v_take;
      end if;
      v_i := v_i + 1;
    end loop;

    if v_left > 0 then
      -- Cannot happen: step 2 proved the total fits. Kept as an assertion so a
      -- future change to the allocation cannot silently pocket the remainder.
      raise exception 'Could not allocate % of this payment', v_left;
    end if;
  end loop;

  return jsonb_build_object(
    'sales', v_posted,
    'total_paise', v_total,
    'tendered_paise', v_tendered,
    'balance_paise', v_total - v_tendered
  );
end;
$$;

grant execute on function public.inv_post_household_sale(uuid, text, jsonb) to service_role;

notify pgrst, 'reload schema';
