-- Cheque / DD instrument tracking for Fee Take

create table if not exists public.fee_cheque_instruments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  voucher_id uuid not null references public.fee_collection_vouchers(id) on delete cascade,
  tender_id uuid references public.fee_voucher_tenders(id) on delete set null,
  receipt_no text not null,
  household_id uuid references public.households(id),
  cheque_no text not null,
  bank_name text,
  cheque_date date,
  amount_paise bigint not null check (amount_paise > 0),
  favouring text,
  status text not null default 'received'
    check (status in ('received', 'deposited', 'cleared', 'bounced')),
  received_at timestamptz not null default now(),
  deposited_at timestamptz,
  deposit_slip_no text,
  cleared_at timestamptz,
  bounced_at timestamptz,
  bounce_reason text,
  created_at timestamptz not null default now()
);

create index if not exists fee_cheques_tenant_status_idx
  on public.fee_cheque_instruments (tenant_id, status, received_at desc);

create index if not exists fee_cheques_voucher_idx
  on public.fee_cheque_instruments (voucher_id);

comment on table public.fee_cheque_instruments is
  'Cheque lifecycle: received → deposited → cleared | bounced (bounce voids linked voucher)';
