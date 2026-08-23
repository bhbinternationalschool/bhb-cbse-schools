-- Inventory & Procurement — Phase 10: store dues on the Fee Take counter.
--
-- A family owes for books and for fees. Until now the fee counter could not
-- see the store half, so the clerk collected fees, the parent left, and the
-- store balance sat there unmentioned.
--
-- The awkward part is that fees and the store are two systems. A collection
-- that lands in one and not the other is worse than not integrating at all,
-- because the parent can be asked for the same money twice. Two things make
-- that safe:
--
--   * The store collection is idempotent on the fee receipt that caused it.
--     A retry — by the clerk, by a refreshed page, by a double click — settles
--     once. `external_ref` carries the receipt and is unique per sale.
--
--   * The fee receipt is written first, then the store is told. If the store
--     call fails the money is still recorded and receipted; the store simply
--     still shows the due, the counter says so loudly, and the retry is safe
--     because of the point above. The reverse order would take the money with
--     no receipt to show for it.

/* ─── Idempotency for collections driven from elsewhere ────── */

alter table public.inv_sale_payments
  add column if not exists external_ref text not null default '';

-- One payment per (sale, external reference). A blank ref is the ordinary
-- store-counter case and is not constrained, so this only binds collections
-- that name an outside document.
create unique index if not exists inv_sale_payments_external_ref_uidx
  on public.inv_sale_payments (tenant_id, sale_id, external_ref)
  where external_ref <> '';

/**
 * Collect against a sale's balance, safely repeatable.
 *
 * With `external_ref` set — a fee receipt number, say — a replay returns the
 * first result instead of taking the money again. Without it, behaviour is
 * exactly as before for the store's own counter.
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
  v_ref text := coalesce(p_payload->>'external_ref', '');
  v_existing record;
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

  -- Already collected under this reference: report the settled position
  -- rather than taking the money a second time.
  if v_ref <> '' then
    select * into v_existing from public.inv_sale_payments
     where tenant_id = p_tenant_id and sale_id = v_sale.id and external_ref = v_ref;
    if found then
      return jsonb_build_object(
        'payment_id', v_existing.id,
        'paid_paise', v_sale.paid_paise,
        'balance_paise', v_sale.balance_paise,
        'status', v_sale.status,
        'already_applied', true,
        'ledger_voucher_no', ''
      );
    end if;
  end if;

  if v_amount > v_sale.balance_paise then
    raise exception 'Only % is outstanding on this sale',
      to_char(v_sale.balance_paise / 100.0, 'FM999999990.00');
  end if;

  insert into public.inv_sale_payments (
    tenant_id, sale_id, paid_on, amount_paise, mode, reference,
    external_ref, note, created_by
  ) values (
    p_tenant_id, v_sale.id, v_paid_on, v_amount, v_mode,
    coalesce(p_payload->>'reference', ''), v_ref,
    coalesce(p_payload->>'note', ''), p_actor
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
    'already_applied', false,
    'ledger_voucher_no', coalesce(v_voucher, '')
  );
end;
$$;

/**
 * What a household still owes the store.
 *
 * Returned per student so the fee counter can put each line on the right
 * child's card, beside their fee dues. Cancelled sales are excluded; a sale
 * with nothing left owing is not a due.
 */
create or replace function public.inv_store_dues_for_students(
  p_tenant_id uuid,
  p_student_ids text[]
) returns table (
  sale_id uuid,
  sale_no text,
  student_id text,
  buyer_name text,
  sale_date date,
  academic_year_code text,
  total_paise bigint,
  paid_paise bigint,
  balance_paise bigint,
  item_summary text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    s.sale_no,
    s.student_id,
    s.buyer_name,
    s.sale_date,
    s.academic_year_code,
    s.total_paise,
    s.paid_paise,
    s.balance_paise,
    coalesce((
      select string_agg(
               l.item_name ||
               case when l.qty = 1 then '' else ' x' || trim(to_char(l.qty, 'FM999999990.###')) end,
               ', ' order by l.sort_order)
        from public.inv_sale_lines l
       where l.sale_id = s.id and l.tenant_id = p_tenant_id
    ), '')
  from public.inv_sales s
 where s.tenant_id = p_tenant_id
   and s.student_id = any(p_student_ids)
   and s.status in ('open', 'part_paid')
   and s.balance_paise > 0
 order by s.sale_date, s.sale_no;
$$;

grant execute on function public.inv_store_dues_for_students(uuid, text[]) to service_role;

notify pgrst, 'reload schema';
