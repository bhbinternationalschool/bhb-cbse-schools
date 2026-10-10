-- Money in and money out, month by month, aggregated IN THE DATABASE.
--
-- WHY (2026-09-16): the Accounts dashboard read this by pulling every cash
-- movement of the year through `ledger_cash_movements` and grouping them in
-- Node. That call returns one row per voucher PER HEAD — 3,147 rows for
-- 2026-27 — and PostgREST caps a reply at 1,000. All 1,000 fell inside
-- April, so the dashboard showed April and nothing else, with no error.
--
-- Paging the call would have worked, but the rows tie on (date, voucher_no)
-- and a tie shuffled across a page boundary can drop a voucher. Summing
-- where the rows already are removes both the cap and that risk, and sends
-- six rows instead of three thousand.
--
-- The two rules this must get right, both found the hard way:
--   1. ONE VOUCHER, COUNTED ONCE. The cash side is summed per voucher before
--      anything else; a payment split over three expense heads is one
--      movement of money, not three.
--   2. CORRECTIONS ARE NOT MOVEMENTS. A reversal and the voucher it reverses
--      cancel each other, and a `void_redate` journal re-dates a reversal
--      that landed in the wrong month. Counted gross, April 2026 read
--      ₹22.29 lakh in / ₹22.99 lakh out; what moved was ₹10.59 lakh and
--      ₹11.52 lakh. September read ₹7.73 lakh when the school took ₹5.40
--      lakh — 53 void_redate journals posted on one day.
--
-- Cash view, deliberately: a fee billed but not collected is not money in.

create or replace function public.ledger_monthly_cash(
  p_tenant_id uuid,
  p_from date,
  p_to date
)
returns table(month text, in_paise bigint, out_paise bigint)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with cash_accounts as (
    select id from public.ledger_accounts
    where tenant_id = p_tenant_id and (is_cash or is_bank)
  ),
  -- A reversal, and whatever it reverses. Not scoped to the window: an
  -- April receipt reversed in July was never April's money.
  corrections as (
    select id from public.ledger_vouchers
     where tenant_id = p_tenant_id and reverses_voucher_id is not null
    union
    select reverses_voucher_id from public.ledger_vouchers
     where tenant_id = p_tenant_id and reverses_voucher_id is not null
    union
    select id from public.ledger_vouchers
     where tenant_id = p_tenant_id and source_type = 'void_redate'
  ),
  per_voucher as (
    select
      v.id,
      v.voucher_date,
      sum(case when l.account_id in (select id from cash_accounts)
               then l.debit_paise - l.credit_paise else 0 end) as cash_signed
    from public.ledger_vouchers v
    join public.ledger_lines l on l.voucher_id = v.id
    where v.tenant_id = p_tenant_id
      and v.voucher_date between p_from and p_to
      and v.id not in (select id from corrections)
    group by v.id, v.voucher_date
    having sum(case when l.account_id in (select id from cash_accounts) then 1 else 0 end) > 0
       and count(*) filter (where l.account_id not in (select id from cash_accounts)) > 0
  )
  select
    to_char(voucher_date, 'YYYY-MM') as month,
    sum(case when cash_signed > 0 then cash_signed else 0 end)::bigint as in_paise,
    sum(case when cash_signed < 0 then -cash_signed else 0 end)::bigint as out_paise
  from per_voucher
  group by 1
  order by 1;
$function$;

grant execute on function public.ledger_monthly_cash(uuid, date, date) to service_role;
