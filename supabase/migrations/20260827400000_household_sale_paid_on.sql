-- Household sale payments take the collection date, not the posting date.
--
-- The counter lets the clerk backdate a sale (entering April's sales in
-- August). Single-child sales already stamped their payments with the sale
-- date — inv_post_sale writes paid_on := v_sale_date. The household path
-- routes the shared payment through inv_collect_on_sale instead, and never
-- forwarded a date, so every backdated family sale recorded its money as
-- collected "today". Caught on SL/0001–SL/0004 (2026-08-27): receipts dated
-- 02/04/2026 with payments and ledger vouchers dated 27/08/2026.
--
-- The payload's payments may now carry paid_on; when absent, the first
-- sale's sale_date is the default — one family, one visit, one date.

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
  v_default_paid text := coalesce(
    nullif(p_payload->'sales'->0->>'sale_date', ''),
    current_date::text
  );
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
            'paid_on', coalesce(nullif(v_pay->>'paid_on', ''), v_default_paid),
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
