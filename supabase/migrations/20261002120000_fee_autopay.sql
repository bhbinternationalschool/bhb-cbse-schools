-- Fee auto-pay: a family's standing mandate with Cashfree (UPI Autopay or
-- e-NACH), and every monthly debit raised against it.
--
-- WHY TWO TABLES. A mandate is the parent's permission; a debit is one use of
-- it. A mandate lives for years and changes state (approved, held, paused,
-- stopped by the parent from their UPI app); each debit is pending for a day
-- or two and then succeeds or fails. Folding debits into the mandate row would
-- lose the history the office needs to answer "was I charged in September?".
--
-- payment_id is OURS and deterministic (<subscription>_<yyyymm>): Cashfree
-- refuses a duplicate, and our primary key refuses it first. That is the guard
-- against a tick that runs twice debiting a family twice in one month. The
-- partial unique index below says the same thing in the database's own words:
-- one live debit per family per month; a failed or cancelled one may be retried.
--
-- The settings (on/off, charge day, default limit) live on accounts_desk_settings
-- beside the gateway fee policy. They ship OFF: mandates can be set up while it
-- is off, and nothing is ever debited until a person turns it on.

create table if not exists public.fee_autopay_mandates (
  subscription_id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  household_id text not null,
  guardian_name text not null default '',
  customer_phone text not null default '',
  plan_id text not null,
  max_paise integer not null check (max_paise > 0),
  -- Cashfree's subscription_status, as last read FROM Cashfree (never from a
  -- webhook payload alone).
  status text not null default 'INITIALIZED',
  -- upi / enach / card, once the parent has chosen.
  payment_group text not null default '',
  -- subscription_session_id, for the school's own approval page.
  session_id text not null default '',
  cf_subscription_id text not null default '',
  created_by text not null default '',
  invite_sent_at timestamptz,
  activated_at timestamptz,
  ended_at timestamptz,
  last_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.fee_autopay_mandates is
  'Fee auto-pay mandates (Cashfree Subscriptions, on-demand). Debited only while status = ACTIVE and the school setting is on.';

create index if not exists fee_autopay_mandates_tenant_household_idx
  on public.fee_autopay_mandates (tenant_id, household_id);

create index if not exists fee_autopay_mandates_tenant_status_idx
  on public.fee_autopay_mandates (tenant_id, status);

create table if not exists public.fee_autopay_charges (
  payment_id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  subscription_id text not null references public.fee_autopay_mandates(subscription_id) on delete cascade,
  household_id text not null,
  -- YYYY-MM: one live debit per family per month.
  cycle text not null,
  amount_paise integer not null check (amount_paise > 0),
  -- One fee pay-link per child; the debit settles each into its own receipt.
  link_ids text[] not null default '{}',
  debit_date date,
  -- Cashfree's payment_status, as last read from Cashfree.
  status text not null default 'INITIALIZED',
  cf_payment_id text not null default '',
  receipt_nos text[] not null default '{}',
  -- Set once every child's receipt is booked. Distinct from status = SUCCESS:
  -- the money arriving and the book being written are two events, and the
  -- second can fail on its own (it is then retried by the next tick).
  settled_at timestamptz,
  parent_notified_at timestamptz,
  last_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.fee_autopay_charges is
  'Monthly auto-pay debits. Receipts are booked only after Cashfree confirms SUCCESS; settled_at marks the book written.';

create unique index if not exists fee_autopay_charges_one_live_per_cycle
  on public.fee_autopay_charges (tenant_id, subscription_id, cycle)
  where status not in ('FAILED', 'CANCELLED');

create index if not exists fee_autopay_charges_tenant_status_idx
  on public.fee_autopay_charges (tenant_id, status);

-- Debits that succeeded but whose receipts are not all booked yet — the
-- sweep's work list. Partial, so it stays the handful that matter.
create index if not exists fee_autopay_charges_unsettled_idx
  on public.fee_autopay_charges (tenant_id, status)
  where settled_at is null;

alter table public.accounts_desk_settings
  add column if not exists fee_autopay jsonb not null default '{}'::jsonb;

-- Every new table needs an explicit service_role grant, or the server's
-- writes fail 42501 and a request "succeeds" while storing nothing (see the
-- cashfree_checkouts migration). For a debit that would mean money taken with
-- no row to show for it.
grant all on public.fee_autopay_mandates to service_role;
grant all on public.fee_autopay_charges to service_role;

-- Parents' phone numbers and bank debits: never readable from the browser
-- keys. Row security on with no policy, so only service_role (which bypasses
-- it) can touch these rows.
revoke all on public.fee_autopay_mandates from anon, authenticated;
revoke all on public.fee_autopay_charges from anon, authenticated;
alter table public.fee_autopay_mandates enable row level security;
alter table public.fee_autopay_charges enable row level security;

notify pgrst, 'reload schema';
