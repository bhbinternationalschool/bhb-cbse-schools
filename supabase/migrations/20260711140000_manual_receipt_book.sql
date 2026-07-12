-- Manual / paper receipt book postings linked to Fee Take vouchers

alter table public.fee_collection_vouchers
  add column if not exists source text not null default 'counter'
    check (source in ('counter', 'manual_book')),
  add column if not exists manual_book_series text,
  add column if not exists manual_book_leaf text;

create table if not exists public.fee_manual_books (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  series_code text not null,
  label text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, series_code)
);

create unique index if not exists fee_manual_leaf_uniq
  on public.fee_collection_vouchers (tenant_id, manual_book_series, manual_book_leaf)
  where source = 'manual_book'
    and voided_at is null
    and manual_book_series is not null
    and manual_book_leaf is not null;

comment on column public.fee_collection_vouchers.source is
  'counter = ERP Fee Take; manual_book = posted from paper carbon book';
comment on table public.fee_manual_books is
  'Paper receipt book series (Phase 1 post; Phase 2 full register + gap audit)';
