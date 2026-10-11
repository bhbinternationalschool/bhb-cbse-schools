-- Visiting staff paid by the period, hour or day (director, 11 Oct 2026: "We
-- pay some people hourly or daily; they are not on payroll — AI teacher,
-- Music, Dance, Survey members").
--
-- 1. sis_staff.category learns 'visiting'. The basis (per_period | per_hour |
--    per_day), the rate and the 194J TDS tick live in sis_staff.profile
--    (profile.visitingPay) like every other staff field.
--
-- 2. A month work sheet per person: visiting_work_sheets (one per staff per
--    month), its lines (visiting_work_lines — each dated, qty × rate, with the
--    source it came from), and an audit trail (visiting_work_audit) of every
--    build, office change, approval, reopen and payment.
--      draft → approved (locked) → paid
--    A sheet is paid once: payment_key is unique, and the ledger voucher is
--    keyed (visiting_fee, sheet id).
--
-- 3. Account 5075 "Visiting Faculty / Professional Fees". Payment voucher:
--    Dr 5075 gross / Cr 2310 TDS Payable / Cr the money (1110 wallet for
--    Cashfree, 1000 cash box, or the chosen bank).
--
-- 4. payout_requests learns kind 'visiting_fee' (the sheet id in bill_id,
--    the person in staff_id), one open request per sheet.

-- 1 ─────────────────────────────────────────────────────────────────────────
alter table public.sis_staff drop constraint if exists sis_staff_category_check;
alter table public.sis_staff
  add constraint sis_staff_category_check
  check (category in ('permanent', 'contract', 'part_time', 'visiting'));

-- 2 ─────────────────────────────────────────────────────────────────────────
create table if not exists public.visiting_work_sheets (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  staff_id text not null,
  staff_name text not null default '',
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  basis text not null check (basis in ('per_period', 'per_hour', 'per_day')),
  rate_paise bigint not null check (rate_paise > 0),
  tds_applies boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'approved', 'paid')),
  gross_paise bigint not null default 0 check (gross_paise >= 0),
  tds_paise bigint not null default 0 check (tds_paise >= 0),
  net_paise bigint not null default 0 check (net_paise >= 0),
  -- computeTds194J's result as shown on the sheet (frozen at approval).
  tds_detail jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  built_by text not null default '',
  built_at timestamptz,
  -- Everyone who built or changed it: maker ≠ checker at approval.
  makers jsonb not null default '[]'::jsonb,
  approved_by text not null default '',
  approved_at timestamptz,
  -- How it was paid: 'cashfree' (payout request), 'cash' (cash box), 'bank'.
  pay_mode text not null default '' check (pay_mode in ('', 'cashfree', 'cash', 'bank')),
  -- Claimed before any money moves: a second payment finds it taken.
  payment_key text,
  payout_request_id text not null default '',
  paid_at timestamptz,
  paid_by text not null default '',
  paid_ref text not null default '',
  ledger_voucher_no text not null default '',
  last_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, staff_id, month),
  check (gross_paise = tds_paise + net_paise)
);
create unique index if not exists visiting_work_sheets_payment_key
  on public.visiting_work_sheets (tenant_id, payment_key) where payment_key is not null;
create index if not exists visiting_work_sheets_month_idx
  on public.visiting_work_sheets (tenant_id, month);

create table if not exists public.visiting_work_lines (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sheet_id text not null references public.visiting_work_sheets(id) on delete cascade,
  -- The source fact ('p|date|class|section|period', 'h|date', 'd|date'); ''
  -- for a line the office added.
  line_key text not null default '',
  work_date date not null,
  unit text not null check (unit in ('period', 'hour', 'day')),
  qty numeric(6, 2) not null default 0 check (qty >= 0),
  rate_paise bigint not null check (rate_paise >= 0),
  amount_paise bigint not null default 0 check (amount_paise >= 0),
  source text not null check (source in ('timetable', 'punch', 'survey', 'office')),
  status text not null check (status in ('counted', 'unconfirmed', 'flagged', 'removed')),
  note text not null default '',
  -- Set when the office changed or added it: a rebuild leaves it alone.
  adjusted_by text not null default '',
  adjusted_at timestamptz,
  adjust_reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists visiting_work_lines_sheet_idx on public.visiting_work_lines (tenant_id, sheet_id, work_date);
create unique index if not exists visiting_work_lines_key
  on public.visiting_work_lines (sheet_id, line_key) where line_key <> '';

create table if not exists public.visiting_work_audit (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sheet_id text not null references public.visiting_work_sheets(id) on delete cascade,
  at timestamptz not null default now(),
  by_name text not null default '',
  action text not null,
  reason text not null default '',
  detail jsonb not null default '{}'::jsonb
);
create index if not exists visiting_work_audit_sheet_idx on public.visiting_work_audit (tenant_id, sheet_id, at);

alter table public.visiting_work_sheets enable row level security;
alter table public.visiting_work_lines enable row level security;
alter table public.visiting_work_audit enable row level security;
grant select, insert, update, delete on public.visiting_work_sheets to service_role;
grant select, insert, update, delete on public.visiting_work_lines to service_role;
grant select, insert, update, delete on public.visiting_work_audit to service_role;
revoke all on public.visiting_work_sheets from anon, authenticated;
revoke all on public.visiting_work_lines from anon, authenticated;
revoke all on public.visiting_work_audit from anon, authenticated;

-- 3 ─────────────────────────────────────────────────────────────────────────
insert into public.ledger_accounts (tenant_id, code, name, parent_code, kind, schedule_group, is_cash, is_bank, is_control)
select distinct a.tenant_id, '5075', 'Visiting Faculty / Professional Fees', '5', 'expense', s.schedule_group, false, false, false
  from public.ledger_accounts a
  join public.ledger_accounts s on s.tenant_id = a.tenant_id and s.code = '5070'
 where a.code = '1000'
   and not exists (
     select 1 from public.ledger_accounts b where b.tenant_id = a.tenant_id and b.code = '5075'
   );

-- 4 ─────────────────────────────────────────────────────────────────────────
alter table public.payout_requests add column if not exists staff_id text not null default '';
alter table public.payout_requests drop constraint if exists payout_requests_kind_check;
alter table public.payout_requests
  add constraint payout_requests_kind_check check (kind in ('vendor_bill', 'voucher', 'visiting_fee'));
alter table public.payout_requests drop constraint if exists payout_requests_visiting_fee_check;
alter table public.payout_requests
  add constraint payout_requests_visiting_fee_check
  check (kind <> 'visiting_fee' or (bill_id <> '' and staff_id <> ''));
-- One request in flight per sheet: a second would pay the month twice.
create unique index if not exists payout_requests_one_open_per_sheet
  on public.payout_requests (tenant_id, bill_id)
  where kind = 'visiting_fee' and status in ('PENDING_APPROVAL', 'SENT');

notify pgrst, 'reload schema';
