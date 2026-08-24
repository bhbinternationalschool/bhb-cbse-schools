-- Ledger v2 — period-aware balances, the foundation of every statement.
--
-- The views built so far answer "what is the balance now". Every statement a
-- trust is audited on asks a different question: what was it at the start of
-- the year, what moved during it, and what was it at the end. Deriving that
-- in the application would mean pulling every line for every report; deriving
-- it here means one pass over an indexed range.
--
-- Two conventions worth stating, because both are easy to get subtly wrong.
--
--   `opening` is strictly before p_from and `closing` is inclusive of p_to,
--   so consecutive periods abut without double-counting the boundary day.
--
--   `opening_paise` and `closing_paise` are signed by the account's natural
--   side — positive means a debit balance on an asset, a credit balance on a
--   liability — so a statement can print them without knowing the sign rules.
--   The movement columns stay as raw debits and credits, because a trial
--   balance has to show both sides rather than a net.
--
-- Nominal accounts get a real opening figure here rather than a forced zero.
-- Whether an Income & Expenditure account should ignore it is a presentation
-- decision, and it belongs in the report that knows the year was closed, not
-- in the arithmetic underneath it.

create or replace function public.ledger_period_balances(
  p_tenant_id uuid,
  p_from date,
  p_to date
) returns table (
  account_id uuid,
  code text,
  name text,
  kind text,
  schedule_group text,
  parent_code text,
  opening_paise bigint,
  debit_paise bigint,
  credit_paise bigint,
  closing_paise bigint
)
language sql
stable
as $$
  with movement as (
    select
      l.account_id,
      sum(case when v.voucher_date < p_from then l.debit_paise else 0 end) as open_dr,
      sum(case when v.voucher_date < p_from then l.credit_paise else 0 end) as open_cr,
      sum(case when v.voucher_date between p_from and p_to then l.debit_paise else 0 end) as period_dr,
      sum(case when v.voucher_date between p_from and p_to then l.credit_paise else 0 end) as period_cr
    from public.ledger_lines l
    join public.ledger_vouchers v on v.id = l.voucher_id
    where l.tenant_id = p_tenant_id
      and v.voucher_date <= p_to
    group by l.account_id
  )
  select
    a.id,
    a.code,
    a.name,
    a.kind,
    a.schedule_group,
    a.parent_code,
    (case when a.kind in ('asset', 'expense')
          then coalesce(m.open_dr, 0) - coalesce(m.open_cr, 0)
          else coalesce(m.open_cr, 0) - coalesce(m.open_dr, 0) end)::bigint,
    coalesce(m.period_dr, 0)::bigint,
    coalesce(m.period_cr, 0)::bigint,
    (case when a.kind in ('asset', 'expense')
          then coalesce(m.open_dr, 0) - coalesce(m.open_cr, 0)
             + coalesce(m.period_dr, 0) - coalesce(m.period_cr, 0)
          else coalesce(m.open_cr, 0) - coalesce(m.open_dr, 0)
             + coalesce(m.period_cr, 0) - coalesce(m.period_dr, 0) end)::bigint
  from public.ledger_accounts a
  left join movement m on m.account_id = a.id
  where a.tenant_id = p_tenant_id
  order by a.code;
$$;

-- One account's transactions for a period, with a running balance. The
-- workhorse behind "show me the Fee Income ledger" and behind every query a
-- CA asks about a single figure.
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
      v.created_at
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
      + sum(r.delta) over (order by r.voucher_date, r.created_at, r.voucher_no
                           rows between unbounded preceding and current row))::bigint
  from rows r
  order by r.voucher_date, r.created_at, r.voucher_no;
$$;

/* ─── Receipts & Payments source ────────────────────────────── */

-- Every voucher that moved cash or a bank account, with the money movement and
-- the heads it was against, so the application can allocate one against the
-- other. A voucher whose every line is cash or bank is a contra — moving the
-- school's own money between its own pockets — and is excluded: it is neither
-- a receipt nor a payment, and including it would inflate both sides of the
-- statement by the same amount.
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
  order by t.voucher_date, t.voucher_no;
$$;

/* ─── Access ────────────────────────────────────────────────── */

revoke all on function public.ledger_period_balances(uuid, date, date) from public;
revoke all on function public.ledger_period_balances(uuid, date, date) from anon, authenticated;
revoke all on function public.ledger_account_statement(uuid, text, date, date) from public;
revoke all on function public.ledger_account_statement(uuid, text, date, date) from anon, authenticated;
revoke all on function public.ledger_cash_movements(uuid, date, date) from public;
revoke all on function public.ledger_cash_movements(uuid, date, date) from anon, authenticated;

grant execute on function public.ledger_period_balances(uuid, date, date) to service_role;
grant execute on function public.ledger_account_statement(uuid, text, date, date) to service_role;
grant execute on function public.ledger_cash_movements(uuid, date, date) to service_role;
