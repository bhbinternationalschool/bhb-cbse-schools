-- One row per Cashfree checkout started through the Orders API, whatever
-- it is for: a fee pay-link, an admissions registration fee, an
-- inter-school event entry, an AI tutor pass. The order_id is ours, so
-- the webhook and the return page can find what a payment was for
-- without trusting order_tags, and the hosted pay page can read the
-- payment session it needs to launch Cashfree's checkout.

create table if not exists public.cashfree_checkouts (
  order_id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('fee_link', 'registration', 'event_fee', 'tutor_pass')),
  ref text not null,
  amount_paise integer not null check (amount_paise > 0),
  customer_phone text not null default '',
  payment_session_id text not null default '',
  cf_order_id text not null default '',
  after_url text not null default '',
  status text not null default 'active' check (status in ('active', 'paid', 'expired', 'failed')),
  payment_ref text not null default '',
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists cashfree_checkouts_ref_idx
  on public.cashfree_checkouts (tenant_id, kind, ref);

-- Every new table needs an explicit service_role grant, or the server's
-- writes fail 42501 and the request "succeeds" while storing nothing.
grant all on public.cashfree_checkouts to service_role;

notify pgrst, 'reload schema';
