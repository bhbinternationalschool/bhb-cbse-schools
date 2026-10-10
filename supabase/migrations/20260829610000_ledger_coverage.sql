-- What the server book does and does not know about.
--
-- Fees and store post to the SQL ledger. Expense vouchers, transport payables
-- and owner/trust loans do NOT — they live in the accounts desk alone, which
-- is exactly how fees drifted until they were wired up. All three are unused
-- today, so nothing is wrong yet; the point is that the day someone starts
-- using them, the gap is a number on a report rather than a balance nobody
-- can explain months later.
--
--   select * from ledger_coverage('<tenant uuid>');
--
-- gap > 0 on a bridged area means postings are genuinely missing — run
-- fee_ledger_sync for fees. A row with bridged = false and desk_records > 0
-- means that feature has started being used and still needs a bridge built.
--
-- Two comparisons had to be corrected before this was trustworthy, and both
-- are worth remembering:
--
--  * Store payments taken AT the sale are posted inside the sale voucher;
--    only later collections get their own. Comparing all payments against
--    collection vouchers reported a gap of 172 that did not exist.
--  * accounts_desk_journal_entries are the DESK'S own double entry for the
--    same fee receipts the ledger now posts. Reporting them as an unbridged
--    gap invites someone to bridge them and book every fee twice, so that row
--    was removed rather than left to tempt.
--
-- Superseded by 20260829660000, which adds the expense / transport / trust
-- rows once those bridges exist. This file is kept as written so the sequence
-- reads in order.
--
-- A drift report that cries wolf is worse than none: the one real gap gets
-- ignored among the false ones.

create or replace function public.ledger_coverage(p_tenant_id uuid)
returns table (
  area text,
  desk_records bigint,
  posted_vouchers bigint,
  gap bigint,
  bridged boolean
)
language sql
stable
as $function$
  with counts as (
    select 'Fee receipts'::text as area,
           (select count(*) from public.fee_desk_vouchers
             where tenant_id = p_tenant_id and voided_at is null) as desk_records,
           (select count(*) from public.ledger_vouchers
             where tenant_id = p_tenant_id and source_type = 'fee_voucher') as posted,
           true as bridged
    union all
    select 'Store sales',
           (select count(*) from public.inv_sales
             where tenant_id = p_tenant_id and status <> 'void'),
           (select count(*) from public.ledger_vouchers
             where tenant_id = p_tenant_id and source_type = 'inv_sale'),
           true
    union all
    select 'Store later collections',
           (select count(*) from public.inv_sale_payments p
              join public.inv_sales s on s.id = p.sale_id
             where p.tenant_id = p_tenant_id and p.reversed_at is null
               and p.paid_on <> s.sale_date),
           (select count(*) from public.ledger_vouchers
             where tenant_id = p_tenant_id and source_type = 'inv_sale_payment'),
           true
    union all
    select 'Expense vouchers',
           (select count(*) from public.accounts_desk_expense_vouchers
             where tenant_id = p_tenant_id),
           (select count(*) from public.ledger_vouchers
             where tenant_id = p_tenant_id and source_type = 'expense_voucher'),
           false
    union all
    select 'Transport payables',
           (select count(*) from public.transport_payables
             where tenant_id = p_tenant_id),
           (select count(*) from public.ledger_vouchers
             where tenant_id = p_tenant_id and source_type = 'transport_payable'),
           false
    union all
    select 'Owner / trust loans',
           (select count(*) from public.accounts_desk_owner_loans
             where tenant_id = p_tenant_id),
           (select count(*) from public.ledger_vouchers
             where tenant_id = p_tenant_id and source_type = 'owner_loan'),
           false
  )
  select area, desk_records, posted,
         greatest(desk_records - posted, 0) as gap,
         bridged
  from counts
  order by (case when bridged then 1 else 0 end),
           greatest(desk_records - posted, 0) desc, area;
$function$;

notify pgrst, 'reload schema';
