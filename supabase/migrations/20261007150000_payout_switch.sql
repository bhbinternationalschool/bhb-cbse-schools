-- Cashfree Payouts with an on/off switch (director, 7 Oct 2026: "make this
-- also with toggle off/on for when we want … because sometime wallet may be
-- low").
--
-- payout_settings: one row per school. `enabled` is the owner's switch; it
-- can only be turned on after a real ₹1 test transfer to the owner's own
-- account has come back SUCCESS (test_passed_at) — the evidence the old
-- CASHFREE_PAYOUTS_ARMED gate waited for, now gathered from the screen.
--
-- payout_transfers gains what each transfer pays (target_kind/id/label, the
-- same keys as upi_payment_proofs) and how it was sent, so a SUCCESS records
-- its UTR against the right salary line, advance or voucher by itself.
--
-- upi_payment_proofs accepts source 'payout' for those.

create table if not exists public.payout_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  enabled boolean not null default false,
  test_transfer_id text not null default '',
  test_passed_at timestamptz,
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.payout_settings enable row level security;
grant all on public.payout_settings to service_role;

alter table public.payout_transfers add column if not exists target_kind text not null default '';
alter table public.payout_transfers add column if not exists target_id text not null default '';
alter table public.payout_transfers add column if not exists target_label text not null default '';
alter table public.payout_transfers add column if not exists payee_name text not null default '';
alter table public.payout_transfers add column if not exists transfer_mode text not null default '';
create index if not exists payout_transfers_target_idx
  on public.payout_transfers (tenant_id, target_kind, target_id);

alter table public.upi_payment_proofs drop constraint if exists upi_payment_proofs_source_check;
alter table public.upi_payment_proofs
  add constraint upi_payment_proofs_source_check check (source in ('whatsapp', 'erp', 'payout'));

notify pgrst, 'reload schema';
