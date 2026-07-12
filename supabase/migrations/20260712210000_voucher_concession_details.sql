-- Freeze concession / discount break-up onto fee collection voucher lines
-- so printed receipts and WhatsApp messages show policy name, rate, sibling tier.

alter table if exists public.fee_voucher_lines
  add column if not exists billed_paise bigint,
  add column if not exists concession_paise bigint not null default 0;

create table if not exists public.fee_voucher_line_concessions (
  id uuid primary key default gen_random_uuid(),
  voucher_line_id uuid not null references public.fee_voucher_lines (id) on delete cascade,
  grant_id text,
  concession_id text,
  code text not null default '',
  name text not null,
  kind text not null default '',
  rate_label text not null default '',
  sibling_label text not null default '',
  amount_paise bigint not null check (amount_paise >= 0),
  created_at timestamptz not null default now()
);

create index if not exists fee_voucher_line_concessions_line_idx
  on public.fee_voucher_line_concessions (voucher_line_id);

comment on table public.fee_voucher_line_concessions is
  'Snapshot of approved concessions applied to a collected due line (receipt / WhatsApp).';
