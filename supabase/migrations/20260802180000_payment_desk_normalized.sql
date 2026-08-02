-- Payment desk ledger — normalized SoR (text ids, gateway-agnostic)

create table if not exists public.payment_desk_links (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  household_id text not null default '',
  student_id text not null default '',
  student_name text not null default '',
  class_label text not null default '',
  academic_year_code text not null,
  amount_paise bigint not null check (amount_paise >= 0),
  status text not null default 'open'
    check (status in ('open', 'paid', 'cancelled', 'expired')),
  created_at timestamptz not null default now(),
  created_by text not null default '',
  expires_on date not null,
  upi_ref text not null default '',
  paid_at timestamptz,
  voucher_id text,
  receipt_no text,
  note text not null default '',
  gateway_mode text not null default 'demo'
    check (gateway_mode in ('demo', 'razorpay', 'cashfree', 'manual')),
  gateway_checkout_url text not null default '',
  gateway_external_id text not null default '',
  link_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create table if not exists public.payment_desk_link_lines (
  id text primary key,
  payment_link_id text not null references public.payment_desk_links(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  due_key text not null,
  student_id text not null default '',
  student_name text not null default '',
  label text not null default '',
  kind text not null default 'academic',
  amount_paise bigint not null check (amount_paise >= 0),
  unique (payment_link_id, due_key)
);

create table if not exists public.payment_desk_gateway_events (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  payment_link_id text references public.payment_desk_links(id) on delete set null,
  provider text not null default 'razorpay'
    check (provider in ('razorpay', 'cashfree', 'demo', 'manual')),
  event_type text not null default '',
  external_payment_id text not null default '',
  external_order_id text not null default '',
  amount_paise bigint,
  settlement_status text not null default 'received'
    check (settlement_status in ('received', 'settled', 'failed', 'ignored')),
  voucher_id text,
  receipt_no text,
  event_json jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);

create table if not exists public.payment_desk_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  link_count int not null default 0,
  open_link_count int not null default 0,
  paid_link_count int not null default 0,
  gateway_event_count int not null default 0,
  last_paid_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists payment_desk_links_tenant_status_idx
  on public.payment_desk_links (tenant_id, status);

create index if not exists payment_desk_links_household_idx
  on public.payment_desk_links (tenant_id, household_id, status);

create index if not exists payment_desk_gateway_events_link_idx
  on public.payment_desk_gateway_events (tenant_id, payment_link_id, received_at desc);

create index if not exists payment_desk_gateway_events_external_idx
  on public.payment_desk_gateway_events (tenant_id, external_payment_id)
  where external_payment_id <> '';

comment on table public.payment_desk_links is
  'Parent UPI / gateway payment links — system of record (Razorpay, Cashfree, demo)';
comment on table public.payment_desk_gateway_events is
  'Gateway webhook + settlement audit ledger';
