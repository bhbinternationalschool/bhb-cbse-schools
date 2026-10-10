-- AI tutor for parents: a free daily allowance of hints per household, and
-- time-based passes (a day, a week, a month) for the full tutor — teaching,
-- worked examples, practice, checking answers, homework help, exam prep.
-- Parents buy time, not credits: "valid till 12 Sep" is something a family
-- understands without arithmetic.
--
-- tutor_pass_orders: one row per pass a parent started buying. Its id is
-- the Cashfree link_id (tutp_<id>), so the webhook can find it and the
-- settle step can re-verify the link with the gateway before activating.
-- starts_at / ends_at are set on activation; a pass bought while another
-- is running starts when that one ends, so no paid day is wasted.
--
-- tutor_usage: one row per answered message, for the free daily cap and
-- the fair-use ceiling on a pass. Never a balance — nothing to explain.

create table if not exists public.tutor_pass_orders (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  household_id text not null,
  plan_code text not null,
  days integer not null check (days > 0),
  amount_paise integer not null check (amount_paise > 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled')),
  payment_ref text not null default '',
  checkout_url text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz
);

create index if not exists tutor_pass_orders_household_idx
  on public.tutor_pass_orders (tenant_id, household_id, created_at desc);
create index if not exists tutor_pass_orders_active_idx
  on public.tutor_pass_orders (tenant_id, household_id, ends_at desc)
  where status = 'paid';

create table if not exists public.tutor_usage (
  id bigserial primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  household_id text not null,
  student_id text not null default '',
  kind text not null check (kind in ('free', 'pass')),
  mode text not null default '',
  ref text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists tutor_usage_household_day_idx
  on public.tutor_usage (tenant_id, household_id, created_at desc);

-- Every new table needs an explicit service_role grant, or the server's
-- writes fail 42501 and the request "succeeds" while storing nothing.
grant all on public.tutor_pass_orders to service_role;
grant all on public.tutor_usage to service_role;
grant usage, select on sequence public.tutor_usage_id_seq to service_role;

notify pgrst, 'reload schema';
