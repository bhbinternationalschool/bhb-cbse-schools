-- A total order for the two statement functions, so they can be paged.
--
-- The application reads both a thousand rows at a time (PostgREST stops at
-- 1,000 and calls the cut success; Cash in Hand carried 1,831 statement lines
-- and Receipts & Payments 4,092 movement rows for 2026-27 on 13 Oct 2026).
-- LIMIT/OFFSET paging is only sound over a total order, and neither had one:
--
--   ledger_account_statement ordered by date, created_at, voucher_no — a
--     voucher with two lines on the same account tied, so a page edge between
--     them could repeat one line and drop the other, and the running balance
--     between the two was in either order;
--   ledger_cash_movements ordered by date, voucher_no — one row per head, so
--     every voucher with several heads (561 in 2026-27) tied.
--
-- Each now ends on the line id, unique per row. Nothing else changes: these
-- are the live definitions from 20260824100000_ledger_v2_reporting.sql
-- (prosrc md5 02837db6… and 859521956… on prod, 13 Oct 2026, identical to the
-- repo), same signatures, same SQL/STABLE/invoker, and CREATE OR REPLACE
-- keeps the grants; they are restated below exactly as the original set them.

create or replace function public.ledger_account_statement(
  p_tenant_id uuid,
  p_code text,
  p_from date,
  p_to date
) returns table (
  voucher_date date,
  voucher_no text,
  voucher_type text,
  narration text,
  party_name text,
  instrument_ref text,
  debit_paise bigint,
  credit_paise bigint,
  running_paise bigint
)
language sql
stable
as $$
  with acct as (
    select id, kind from public.ledger_accounts
    where tenant_id = p_tenant_id and code = p_code
  ),
  opening as (
    select coalesce(sum(
      case when (select kind from acct) in ('asset', 'expense')
           then l.debit_paise - l.credit_paise
           else l.credit_paise - l.debit_paise end), 0) as bal
    from public.ledger_lines l
    join public.ledger_vouchers v on v.id = l.voucher_id
    where l.tenant_id = p_tenant_id
      and l.account_id = (select id from acct)
      and v.voucher_date < p_from
  ),
  rows as (
    select
      v.voucher_date,
      v.voucher_no,
      v.voucher_type,
      coalesce(nullif(l.narration, ''), v.narration) as narration,
      coalesce(p.name, '') as party_name,
      l.instrument_ref,
      l.debit_paise,
      l.credit_paise,
      case when (select kind from acct) in ('asset', 'expense')
           then l.debit_paise - l.credit_paise
           else l.credit_paise - l.debit_paise end as delta,
      v.created_at,
      l.id as line_id
    from public.ledger_lines l
    join public.ledger_vouchers v on v.id = l.voucher_id
    left join public.ledger_parties p on p.id = l.party_id
    where l.tenant_id = p_tenant_id
      and l.account_id = (select id from acct)
      and v.voucher_date between p_from and p_to
  )
  select
    r.voucher_date,
    r.voucher_no,
    r.voucher_type,
    r.narration,
    r.party_name,
    r.instrument_ref,
    r.debit_paise,
    r.credit_paise,
    ((select bal from opening)
      + sum(r.delta) over (order by r.voucher_date, r.created_at, r.voucher_no, r.line_id
                           rows between unbounded preceding and current row))::bigint
  from rows r
  order by r.voucher_date, r.created_at, r.voucher_no, r.line_id;
$$;

create or replace function public.ledger_cash_movements(
  p_tenant_id uuid,
  p_from date,
  p_to date
) returns table (
  voucher_id uuid,
  voucher_date date,
  voucher_no text,
  narration text,
  cash_signed_paise bigint,
  head_code text,
  head_name text,
  head_schedule_group text,
  head_kind text,
  head_signed_paise bigint
)
language sql
stable
as $$
  with cash_accounts as (
    select id from public.ledger_accounts
    where tenant_id = p_tenant_id and (is_cash or is_bank)
  ),
  touched as (
    select
      v.id,
      v.voucher_date,
      v.voucher_no,
      v.narration,
      sum(case when l.account_id in (select id from cash_accounts)
               then l.debit_paise - l.credit_paise else 0 end) as cash_signed,
      count(*) filter (where l.account_id not in (select id from cash_accounts)) as head_lines
    from public.ledger_vouchers v
    join public.ledger_lines l on l.voucher_id = v.id
    where v.tenant_id = p_tenant_id
      and v.voucher_date between p_from and p_to
    group by v.id, v.voucher_date, v.voucher_no, v.narration
    having sum(case when l.account_id in (select id from cash_accounts) then 1 else 0 end) > 0
       and count(*) filter (where l.account_id not in (select id from cash_accounts)) > 0
  )
  select
    t.id,
    t.voucher_date,
    t.voucher_no,
    t.narration,
    t.cash_signed::bigint,
    a.code,
    a.name,
    a.schedule_group,
    a.kind,
    (l.credit_paise - l.debit_paise)::bigint
  from touched t
  join public.ledger_lines l on l.voucher_id = t.id
  join public.ledger_accounts a on a.id = l.account_id
  where l.account_id not in (select id from cash_accounts)
  order by t.voucher_date, t.voucher_no, l.id;
$$;

revoke all on function public.ledger_account_statement(uuid, text, date, date) from public;
revoke all on function public.ledger_account_statement(uuid, text, date, date) from anon, authenticated;
revoke all on function public.ledger_cash_movements(uuid, date, date) from public;
revoke all on function public.ledger_cash_movements(uuid, date, date) from anon, authenticated;

grant execute on function public.ledger_account_statement(uuid, text, date, date) to service_role;
grant execute on function public.ledger_cash_movements(uuid, date, date) to service_role;
