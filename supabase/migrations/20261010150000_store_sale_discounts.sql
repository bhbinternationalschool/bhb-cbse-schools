/*
 * A discount given on a store due after the sale (director, 10 Oct 2026).
 *
 * The fee counter gave Shaurya and Pratiksha Shrivastava 10% on their book
 * kits. The discount was saved as a FEE waiver; the store, which owns the
 * due, never heard of it — so even a successful collection would have left
 * ₹365 owing on each sale. A store due is reduced in the store: the sale's
 * discount goes up, its total and balance come down, and the books carry
 * it — Dr Store income (4200) / Cr Student receivable (1040), the reverse
 * of the credit sale's own posting.
 *
 * One row per discount; `external_ref` (the fee receipt number) makes it
 * safely repeatable and lets a voided receipt take it back, exactly as
 * inv_reverse_collection does for the cash.
 */

create table if not exists public.inv_sale_discounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sale_id uuid not null references public.inv_sales(id) on delete cascade,
  amount_paise bigint not null check (amount_paise > 0),
  reason text not null default '',
  external_ref text not null default '',
  reversed_at timestamptz,
  reversed_reason text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now()
);

create unique index if not exists inv_sale_discounts_ref_uidx
  on public.inv_sale_discounts (tenant_id, sale_id, external_ref)
  where external_ref <> '' and reversed_at is null;
create index if not exists inv_sale_discounts_extref_idx
  on public.inv_sale_discounts (tenant_id, external_ref)
  where external_ref <> '';

alter table public.inv_sale_discounts enable row level security;
drop policy if exists inv_sale_discounts_tenant_read on public.inv_sale_discounts;
create policy inv_sale_discounts_tenant_read on public.inv_sale_discounts
  for select to authenticated using (public.is_tenant_member(tenant_id));
grant select on public.inv_sale_discounts to authenticated;
grant select, insert, update, delete on public.inv_sale_discounts to service_role;

create or replace function public.inv_discount_on_sale(
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
  v_ref text := coalesce(p_payload->>'external_ref', '');
  v_reason text := coalesce(nullif(btrim(p_payload->>'reason'), ''), 'Counter discount');
  v_existing record;
  v_id uuid;
  v_total bigint;
  v_balance bigint;
  v_status text;
  v_party jsonb;
  v_res jsonb;
  v_voucher text := '';
begin
  if v_amount <= 0 then
    raise exception 'Discount must be more than zero';
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

  -- Already given under this receipt: report, do not discount twice.
  if v_ref <> '' then
    select * into v_existing from public.inv_sale_discounts
     where tenant_id = p_tenant_id and sale_id = v_sale.id
       and external_ref = v_ref and reversed_at is null;
    if found then
      return jsonb_build_object(
        'discount_id', v_existing.id,
        'balance_paise', v_sale.balance_paise,
        'status', v_sale.status,
        'already_applied', true
      );
    end if;
  end if;

  if v_amount > v_sale.balance_paise then
    raise exception 'Only % is outstanding on this sale',
      to_char(v_sale.balance_paise / 100.0, 'FM999999990.00');
  end if;

  insert into public.inv_sale_discounts (tenant_id, sale_id, amount_paise, reason, external_ref, created_by)
  values (p_tenant_id, v_sale.id, v_amount, v_reason, v_ref, p_actor)
  returning id into v_id;

  v_total := v_sale.total_paise - v_amount;
  v_balance := greatest(0, v_sale.balance_paise - v_amount);
  v_status := case
    when v_balance <= 0 then 'paid'
    when v_sale.paid_paise > 0 then 'part_paid'
    else 'open'
  end;

  update public.inv_sales
     set discount_paise = discount_paise + v_amount,
         total_paise = v_total,
         balance_paise = v_balance,
         status = v_status,
         updated_at = now()
   where id = v_sale.id and tenant_id = p_tenant_id;

  if public.inv_ledger_active(p_tenant_id) then
    v_party := case
      when v_sale.buyer_kind = 'student' and coalesce(v_sale.student_id, '') <> ''
        then jsonb_build_object('kind', 'student', 'external_id', v_sale.student_id,
                                'name', coalesce(v_sale.buyer_name, ''))
      when v_sale.buyer_kind = 'staff' and coalesce(v_sale.staff_id, '') <> ''
        then jsonb_build_object('kind', 'staff', 'external_id', v_sale.staff_id,
                                'name', coalesce(v_sale.buyer_name, ''))
      else null
    end;
    v_res := public.ledger_post(p_tenant_id, jsonb_build_object(
      'voucher_type', 'journal',
      'date', current_date,
      'narration', 'Store discount — ' || v_sale.sale_no || ' — ' || v_reason,
      'source_type', 'inv_sale_discount',
      'source_id', v_id::text,
      'created_by', p_actor,
      'lines', jsonb_build_array(
        jsonb_build_object('account_code', '4200', 'debit_paise', v_amount, 'credit_paise', 0,
                           'narration', 'Discount on store sale'),
        jsonb_build_object('account_code', '1040', 'debit_paise', 0, 'credit_paise', v_amount,
                           'narration', 'Store due reduced by discount', 'party', v_party)
      )
    ));
    if not coalesce((v_res->>'ok')::boolean, false) then
      raise exception 'The books refused this discount: %', coalesce(v_res->>'error', 'unknown ledger error');
    end if;
    v_voucher := coalesce(v_res->>'voucher_no', '');
  end if;

  return jsonb_build_object(
    'discount_id', v_id,
    'balance_paise', v_balance,
    'status', v_status,
    'already_applied', false,
    'ledger_voucher_no', v_voucher
  );
end;
$$;

grant execute on function public.inv_discount_on_sale(uuid, text, jsonb) to service_role;

/* A voided fee receipt takes back the store discounts given with it. */
create or replace function public.inv_reverse_sale_discounts(
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
  v_disc record;
  v_sale record;
  v_total bigint;
  v_balance bigint;
  v_status text;
  v_voucher_id uuid;
  v_res jsonb;
  v_count int := 0;
  v_amount bigint := 0;
begin
  if coalesce(btrim(p_external_ref), '') = '' then
    raise exception 'A receipt reference is required to reverse a discount';
  end if;

  for v_disc in
    select * from public.inv_sale_discounts
     where tenant_id = p_tenant_id and external_ref = p_external_ref and reversed_at is null
  loop
    update public.inv_sale_discounts
       set reversed_at = now(), reversed_reason = coalesce(p_reason, 'Fee receipt voided')
     where id = v_disc.id;

    select * into v_sale from public.inv_sales
     where id = v_disc.sale_id and tenant_id = p_tenant_id
     for update;
    if found then
      v_total := v_sale.total_paise + v_disc.amount_paise;
      v_balance := greatest(0, v_total - v_sale.paid_paise);
      v_status := case
        when v_sale.status = 'void' then 'void'
        when v_balance <= 0 then 'paid'
        when v_sale.paid_paise > 0 then 'part_paid'
        else 'open'
      end;
      update public.inv_sales
         set discount_paise = greatest(0, discount_paise - v_disc.amount_paise),
             total_paise = v_total,
             balance_paise = v_balance,
             status = v_status,
             updated_at = now()
       where id = v_sale.id and tenant_id = p_tenant_id;
    end if;

    select id into v_voucher_id from public.ledger_vouchers
     where tenant_id = p_tenant_id and source_type = 'inv_sale_discount' and source_id = v_disc.id::text;
    if v_voucher_id is not null then
      v_res := public.ledger_reverse(
        p_tenant_id, v_voucher_id,
        coalesce(p_reason, 'Fee receipt voided') || ' — store discount returned',
        null, p_actor);
      if not coalesce((v_res->>'ok')::boolean, false) then
        raise exception 'The books refused the store discount reversal: %', coalesce(v_res->>'error', 'unknown ledger error');
      end if;
    end if;

    v_count := v_count + 1;
    v_amount := v_amount + v_disc.amount_paise;
  end loop;

  return jsonb_build_object('reversed', v_count, 'amount_paise', v_amount);
end;
$$;

grant execute on function public.inv_reverse_sale_discounts(uuid, text, text, text) to service_role;

notify pgrst, 'reload schema';
