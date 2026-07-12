-- UPI / online payment links (demo → Razorpay later)

create table if not exists public.payment_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  household_id uuid not null references public.households(id),
  student_id uuid not null references public.students(id),
  academic_year_code text not null,
  amount_paise bigint not null check (amount_paise > 0),
  status text not null default 'open'
    check (status in ('open', 'paid', 'cancelled', 'expired')),
  expires_on date not null,
  upi_ref text not null default '',
  paid_at timestamptz,
  voucher_id uuid,
  note text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create table if not exists public.payment_link_lines (
  id uuid primary key default gen_random_uuid(),
  payment_link_id uuid not null references public.payment_links(id) on delete cascade,
  due_key text not null,
  student_id uuid not null references public.students(id),
  label text not null,
  kind text not null,
  amount_paise bigint not null check (amount_paise >= 0),
  unique (payment_link_id, due_key)
);

create index if not exists payment_links_household_idx
  on public.payment_links (tenant_id, household_id, status);

comment on table public.payment_links is
  'Parent UPI / gateway payment request; apply creates fee voucher with mode=upi';
