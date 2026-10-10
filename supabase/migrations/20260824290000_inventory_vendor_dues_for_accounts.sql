-- Make store vendors and their dues visible to Accounts.
--
-- The money was never lost: a store vendor bill posts Dr Inventory / Cr
-- Accounts Payable against a vendor party, and the ledger has held it
-- correctly since phase 7. What was missing was any way for the Accounts
-- screens to see it, and one flag that actively said the opposite of the
-- truth.
--
-- Three things here:
--
--   1. `posted_to_accounts` / `accounts_ref` are finally claimed. They were
--      written for the LEGACY accounts module and phase 7 never set them, so
--      a posted bill still read as unposted — an invitation to post it twice.
--      Same defect family as the rest of this module's history: a stored fact
--      that disagrees with the event that actually happened.
--
--   2. Existing bills are backfilled from the vouchers that already exist,
--      keyed on the ledger's own (source_type, source_id), not on a guess.
--
--   3. `inv_vendor_dues()` gives Accounts the vendor detail the ledger does
--      not carry — GSTIN, phone, payment terms — beside the balance the
--      ledger IS authoritative for. The join is
--      `ledger_parties.external_id = inv_vendors.id`, which the posting
--      function has always set; matching on vendor NAME would merge two
--      suppliers who happen to share one.

/* ─── 1. Claim the flag when a bill posts ──────────────────── */

create or replace function public.inv_ledger_post_vendor_bill(
  p_tenant_id uuid,
  p_bill_id uuid,
  p_actor text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bill record;
  v_vendor record;
  v_party jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_gst_credit boolean;
  v_goods bigint;
  v_input_gst bigint;
  v_result jsonb;
  v_voucher_no text;
begin
  if not public.inv_ledger_active(p_tenant_id) then
    return null;
  end if;

  select * into v_bill from public.inv_vendor_bills
   where id = p_bill_id and tenant_id = p_tenant_id;
  if not found or v_bill.total_paise <= 0 or v_bill.status = 'cancelled' then
    return null;
  end if;

  select * into v_vendor from public.inv_vendors
   where id = v_bill.vendor_id and tenant_id = p_tenant_id;

  v_party := jsonb_build_object(
    'kind', 'vendor',
    'external_id', v_bill.vendor_id::text,
    'name', coalesce(v_vendor.name, '')
  );

  select coalesce(gst_credit_eligible, false) into v_gst_credit
    from public.inv_settings where tenant_id = p_tenant_id;
  v_gst_credit := coalesce(v_gst_credit, false);

  -- Everything that is part of what the goods cost goes into inventory:
  -- freight, other charges, and GST the school cannot reclaim. That is the
  -- same landed cost the stock ledger records, so the asset balance and the
  -- valuation report agree.
  v_input_gst := case when v_gst_credit then v_bill.tax_paise else 0 end;
  v_goods := v_bill.total_paise - v_input_gst;

  if v_goods > 0 then
    v_lines := v_lines || jsonb_build_object(
      'account_code', '1090',
      'debit_paise', v_goods,
      'credit_paise', 0,
      'narration', 'Goods received on ' || v_bill.bill_no
    );
  end if;

  if v_input_gst > 0 then
    v_lines := v_lines || jsonb_build_object(
      'account_code', '1080',
      'debit_paise', v_input_gst,
      'credit_paise', 0,
      'narration', 'Input GST on ' || v_bill.bill_no
    );
  end if;

  v_lines := v_lines || jsonb_build_object(
    'account_code', '2000',
    'debit_paise', 0,
    'credit_paise', v_bill.total_paise,
    'narration', 'Payable to ' || coalesce(v_vendor.name, 'vendor'),
    'party', v_party
  );

  v_result := public.ledger_post(p_tenant_id, jsonb_build_object(
    'voucher_type', 'purchase',
    'date', v_bill.bill_date,
    'narration', 'Vendor bill ' || v_bill.bill_no ||
                 case when coalesce(v_bill.supplier_invoice_no, '') = '' then ''
                      else ' (inv ' || v_bill.supplier_invoice_no || ')' end,
    'source_type', 'inv_vendor_bill',
    'source_id', p_bill_id::text,
    'created_by', p_actor,
    'lines', v_lines
  ));

  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'The books refused this vendor bill: %',
      coalesce(v_result->>'error', 'unknown ledger error');
  end if;

  v_voucher_no := v_result->>'voucher_no';

  -- The bill now records that it reached the books. Same transaction as the
  -- posting, so the flag cannot outlive a voucher that was rolled back.
  update public.inv_vendor_bills
     set posted_to_accounts = true,
         accounts_ref = coalesce(v_voucher_no, ''),
         updated_at = now()
   where id = p_bill_id and tenant_id = p_tenant_id;

  return v_voucher_no;
end;
$$;

/* ─── 2. Backfill bills already posted ─────────────────────── */

update public.inv_vendor_bills b
   set posted_to_accounts = true,
       accounts_ref = v.voucher_no
  from public.ledger_vouchers v
 where v.tenant_id = b.tenant_id
   and v.source_type = 'inv_vendor_bill'
   and v.source_id = b.id::text
   and b.posted_to_accounts = false;

/* ─── 3. Vendor dues for the Accounts screens ──────────────── */

/**
 * Every store vendor, with what the books say we owe them.
 *
 * `ledger_due_paise` is the authority — it is the vendor's balance on account
 * 2000, the same figure the ageing report and the trial balance use.
 * `bills_open_paise` is what the store's own bill records still show open, and
 * the two are reported separately on purpose: when they disagree, something
 * posted on one side and not the other, and hiding that behind a single number
 * is how a discrepancy survives.
 */
create or replace function public.inv_vendor_dues(p_tenant_id uuid)
returns table (
  vendor_id uuid,
  name text,
  gstin text,
  phone text,
  email text,
  contact_person text,
  payment_terms_days int,
  is_active boolean,
  ledger_due_paise bigint,
  bills_open_paise bigint,
  open_bill_count int,
  oldest_bill_date date,
  last_bill_date date
)
language sql
stable
security definer
set search_path = public
as $$
  select
    v.id,
    v.name,
    v.gstin,
    v.phone,
    v.email,
    v.contact_person,
    v.payment_terms_days,
    v.is_active,
    coalesce((
      select sum(l.credit_paise) - sum(l.debit_paise)
        from public.ledger_lines l
        join public.ledger_accounts a on a.id = l.account_id
        join public.ledger_parties p on p.id = l.party_id
       where a.tenant_id = p_tenant_id
         and a.code = '2000'
         and p.external_id = v.id::text
    ), 0)::bigint as ledger_due_paise,
    coalesce((
      select sum(b.total_paise - b.paid_paise)
        from public.inv_vendor_bills b
       where b.tenant_id = p_tenant_id
         and b.vendor_id = v.id
         and b.status in ('open', 'part_paid')
    ), 0)::bigint as bills_open_paise,
    coalesce((
      select count(*)
        from public.inv_vendor_bills b
       where b.tenant_id = p_tenant_id
         and b.vendor_id = v.id
         and b.status in ('open', 'part_paid')
    ), 0)::int as open_bill_count,
    (select min(b.bill_date) from public.inv_vendor_bills b
      where b.tenant_id = p_tenant_id and b.vendor_id = v.id
        and b.status in ('open', 'part_paid')),
    (select max(b.bill_date) from public.inv_vendor_bills b
      where b.tenant_id = p_tenant_id and b.vendor_id = v.id)
  from public.inv_vendors v
 where v.tenant_id = p_tenant_id
 order by v.name;
$$;

grant execute on function public.inv_vendor_dues(uuid) to service_role;

notify pgrst, 'reload schema';
