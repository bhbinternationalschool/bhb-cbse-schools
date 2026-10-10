-- Take a store collection back when the fee receipt that paid it is voided.
--
-- A store sale issued on account is PAID at the fee counter, which posts a
-- collection stamped with the fee receipt number. Voiding that receipt gave
-- the money back to the parent but left the store sale marked paid — the
-- slip kept saying PAID for money the school no longer held, and the due
-- never came back onto the family's fee lines.
--
-- Reversal is not deletion: the payment row stays with reversed_at set, the
-- ledger receipt is reversed by a proper contra voucher, and the sale's
-- balance and status are recomputed from what remains.

alter table public.inv_sale_payments
  add column if not exists reversed_at timestamptz;
alter table public.inv_sale_payments
  add column if not exists reversed_reason text not null default '';

create index if not exists inv_sale_payments_extref_idx
  on public.inv_sale_payments (tenant_id, external_ref)
  where external_ref <> '';

create or replace function public.inv_reverse_collection(
  p_tenant_id uuid,
  p_actor text,
  p_external_ref text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay record;
  v_sale record;
  v_paid bigint;
  v_balance bigint;
  v_status text;
  v_voucher_id uuid;
  v_res jsonb;
  v_count int := 0;
  v_amount bigint := 0;
  v_sales jsonb := '[]'::jsonb;
begin
  if coalesce(btrim(p_external_ref), '') = '' then
    raise exception 'A receipt reference is required to reverse a collection';
  end if;

  for v_pay in
    select * from public.inv_sale_payments
     where tenant_id = p_tenant_id
       and external_ref = p_external_ref
       and reversed_at is null
       and amount_paise > 0
  loop
    update public.inv_sale_payments
       set reversed_at = now(),
           reversed_reason = coalesce(p_reason, 'Fee receipt voided')
     where id = v_pay.id;

    select * into v_sale from public.inv_sales
     where id = v_pay.sale_id and tenant_id = p_tenant_id
     for update;
    if found then
      v_paid := greatest(0, v_sale.paid_paise - v_pay.amount_paise);
      v_balance := greatest(0, v_sale.total_paise - v_paid);
      v_status := case
        when v_sale.status = 'void' then 'void'
        when v_balance <= 0 then 'paid'
        when v_paid > 0 then 'part_paid'
        else 'open'
      end;
      update public.inv_sales
         set paid_paise = v_paid,
             balance_paise = v_balance,
             status = v_status,
             updated_at = now()
       where id = v_sale.id and tenant_id = p_tenant_id;

      v_sales := v_sales || jsonb_build_object(
        'sale_id', v_sale.id::text,
        'sale_no', v_sale.sale_no,
        'amount_paise', v_pay.amount_paise,
        'status', v_status
      );
    end if;

    -- The books: reverse the receipt voucher this collection posted.
    select id into v_voucher_id from public.ledger_vouchers
     where tenant_id = p_tenant_id
       and source_type = 'inv_sale_payment'
       and source_id = v_pay.id::text;
    if v_voucher_id is not null then
      v_res := public.ledger_reverse(
        p_tenant_id, v_voucher_id,
        coalesce(p_reason, 'Fee receipt voided') || ' — store collection returned',
        null, p_actor);
      if not coalesce((v_res->>'ok')::boolean, false) then
        raise exception 'The books refused the store collection reversal: %',
          coalesce(v_res->>'error', 'unknown ledger error');
      end if;
    end if;

    v_count := v_count + 1;
    v_amount := v_amount + v_pay.amount_paise;
  end loop;

  return jsonb_build_object(
    'reversed', v_count,
    'amount_paise', v_amount,
    'sales', v_sales
  );
end;
$$;

grant execute on function public.inv_reverse_collection(uuid, text, text, text) to service_role;

notify pgrst, 'reload schema';
