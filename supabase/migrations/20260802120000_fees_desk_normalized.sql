-- Fee desk vouchers — normalized SoR (text ids aligned with sis_households / sis_students)

create table if not exists public.fee_desk_vouchers (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  household_id text references public.sis_households(id) on delete set null,
  academic_year_code text not null,
  receipt_no text not null,
  school_receipt_no text not null default '',
  source text not null default 'counter',
  manual_book_series text not null default '',
  manual_book_leaf text not null default '',
  collection_date date not null,
  transaction_date date not null,
  transaction_id text not null default '',
  collected_at timestamptz not null default now(),
  cashier_name text not null default '',
  total_paise bigint not null check (total_paise >= 0),
  note text not null default '',
  voided_at timestamptz,
  whatsapp_sent_at timestamptz,
  voucher_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (tenant_id, receipt_no)
);

create table if not exists public.fee_desk_voucher_lines (
  id text primary key,
  voucher_id text not null references public.fee_desk_vouchers(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id text not null,
  due_key text not null,
  kind text not null default 'academic',
  label text not null default '',
  amount_paise bigint not null check (amount_paise > 0),
  line_json jsonb not null default '{}'::jsonb,
  unique (voucher_id, due_key)
);

create table if not exists public.fee_desk_voucher_tenders (
  id text primary key,
  voucher_id text not null references public.fee_desk_vouchers(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  tender_index int not null default 0,
  mode text not null,
  amount_paise bigint not null check (amount_paise > 0),
  ref text not null default '',
  instrument_date date,
  bank_name text not null default '',
  realisation text not null default 'cleared',
  tender_json jsonb not null default '{}'::jsonb,
  unique (voucher_id, tender_index)
);

create table if not exists public.fee_desk_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  voucher_count int not null default 0,
  last_collected_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists fee_desk_vouchers_tenant_date_idx
  on public.fee_desk_vouchers (tenant_id, collection_date desc);

create index if not exists fee_desk_vouchers_tenant_ay_idx
  on public.fee_desk_vouchers (tenant_id, academic_year_code);

create index if not exists fee_desk_lines_student_idx
  on public.fee_desk_voucher_lines (tenant_id, student_id);

comment on table public.fee_desk_vouchers is
  'Fee Take receipts — system of record (text ids match desk localStorage)';
