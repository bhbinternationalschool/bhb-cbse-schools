-- Fee Take day-close + cashier → Accounts cash handover (§6e)

create table if not exists public.fee_day_closes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  close_date date not null,
  counter_id text not null default 'front_office',
  cashier_user_id uuid,
  cashier_name text not null,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'approved', 'rejected')),
  receipt_count integer not null default 0,
  total_paise bigint not null default 0,
  system_cash_paise bigint not null default 0,
  physical_cash_paise bigint not null default 0,
  variance_paise bigint not null default 0,
  cashier_remarks text not null default '',
  receiver_user_id uuid,
  receiver_name text not null default '',
  receiver_remarks text not null default '',
  submitted_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, close_date, counter_id)
);

create table if not exists public.fee_day_close_denominations (
  id uuid primary key default gen_random_uuid(),
  day_close_id uuid not null references public.fee_day_closes(id) on delete cascade,
  denom_paise integer not null,
  qty integer not null default 0 check (qty >= 0),
  unique (day_close_id, denom_paise)
);

create table if not exists public.fee_day_close_mode_totals (
  id uuid primary key default gen_random_uuid(),
  day_close_id uuid not null references public.fee_day_closes(id) on delete cascade,
  mode text not null,
  paise bigint not null default 0,
  tender_count integer not null default 0,
  unique (day_close_id, mode)
);

create table if not exists public.fee_day_close_vouchers (
  day_close_id uuid not null references public.fee_day_closes(id) on delete cascade,
  voucher_id uuid not null references public.fee_collection_vouchers(id),
  primary key (day_close_id, voucher_id)
);

comment on table public.fee_day_closes is
  'Cashier day-close + cash handover; submitted/approved locks new collections for that date';
comment on column public.fee_day_closes.system_cash_paise is
  'Sum of cash tenders on live vouchers at submit time';
comment on column public.fee_day_closes.physical_cash_paise is
  'Sum of denomination qty × face value counted by cashier';
