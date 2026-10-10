-- Record which section a sale was made to.
--
-- `inv_sales` already carries `class_id`. Section was missing, so "sold to
-- Class 5" could not be narrowed to "Class 5-B" — which is exactly the cut a
-- class teacher needs when checking who in their own section still has not
-- collected their books.
--
-- The value is written in `inv_post_sale`, the thin wrapper, rather than in
-- `inv_post_sale_core`. The core is 7.6KB of stock, pricing, discount-cap and
-- payment logic; reproducing it to add one column is how a guard gets dropped
-- by accident. The wrapper already exists to attach the ledger posting, it
-- runs in the same transaction, and a failure here rolls the sale back with
-- everything else.

alter table public.inv_sales
  add column if not exists section_id text not null default '';

create index if not exists inv_sales_class_section_idx
  on public.inv_sales (tenant_id, class_id, section_id);

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
  v_section text;
begin
  v_inner := public.inv_post_sale_core(p_tenant_id, p_actor, p_payload);
  v_sale_id := (v_inner->>'sale_id')::uuid;

  -- Section is an attribute of who was served, not of the money, so it is
  -- recorded beside the sale rather than threaded through the costing core.
  v_section := coalesce(p_payload->>'section_id', '');
  if v_section <> '' then
    update public.inv_sales
       set section_id = v_section
     where id = v_sale_id and tenant_id = p_tenant_id;
  end if;

  -- Raises on refusal, which rolls the whole sale back. Stock must never move
  -- without the entry that explains it.
  v_voucher := public.inv_ledger_post_sale(p_tenant_id, v_sale_id, p_actor);

  return v_inner || jsonb_build_object('ledger_voucher_no', coalesce(v_voucher, ''));
end;
$$;

notify pgrst, 'reload schema';
