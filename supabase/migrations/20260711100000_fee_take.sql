-- Fee Take: collection vouchers, lines, tenders, receipts

create table if not exists public.fee_collection_vouchers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  household_id uuid references public.households(id),
  academic_year_code text not null,
  receipt_no text not null,
  school_receipt_no text,
  collection_date date not null,
  transaction_date date not null,
  transaction_id text,
  collected_at timestamptz not null default now(),
  cashier_name text,
  total_paise bigint not null check (total_paise >= 0),
  note text,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, receipt_no)
);

create table if not exists public.fee_voucher_lines (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references public.fee_collection_vouchers(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id uuid not null references public.students(id),
  due_key text not null,
  kind text not null check (kind in ('academic', 'special', 'transport', 'store_sale')),
  label text not null,
  amount_paise bigint not null check (amount_paise > 0),
  fee_head_id uuid,
  installment_id uuid,
  special_fee_id uuid
);

create table if not exists public.fee_voucher_tenders (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references public.fee_collection_vouchers(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  mode text not null check (mode in ('cash', 'upi', 'card', 'cheque', 'rtgs', 'neft', 'imps', 'bank', 'wallet')),
  amount_paise bigint not null check (amount_paise > 0),
  ref text,
  instrument_date date,
  bank_name text,
  realisation text not null default 'cleared'
    check (realisation in ('cleared', 'subject_to_clearance'))
);

create index if not exists fee_vouchers_tenant_collected_idx
  on public.fee_collection_vouchers (tenant_id, collected_at desc);

create index if not exists fee_voucher_lines_student_idx
  on public.fee_voucher_lines (student_id);

create index if not exists fee_voucher_lines_due_key_idx
  on public.fee_voucher_lines (due_key);

comment on table public.fee_collection_vouchers is
  'Fee Take collection voucher — one receipt may cover multi-sibling lines';
comment on column public.fee_voucher_lines.due_key is
  'Stable due identity e.g. acad:{student}:{structureLine} or spec:{student}:{specialFee}';

insert into public.tenant_modules (tenant_id, module_code, enabled)
select id, 'fees.take', true
from public.tenants where slug = 'bhb-international'
on conflict (tenant_id, module_code) do update set enabled = true;
