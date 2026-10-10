-- Staff salary by Cashgram link (director, 10 Oct 2026: "now build staff
-- payouts by cashgram").
--
-- cashgram_refunds (20261010190000) becomes the one table for every Cashgram
-- the school sends, so the wallet check — the sum of every open link — and
-- the webhook see them all. The name stays: it is referenced by deployed code.
--
--   purpose      'fee_refund' (the rows so far) | 'staff_pay'
--   target_*     for staff_pay: what it pays, the same keys as
--                upi_payment_proofs (payroll_line "<runId>|<staffId>")
--   fee_effect   'none' for staff_pay
--
-- One live link per paid item: a partial unique index refuses a second open
-- or collected link for the same salary line, whatever the screen thinks.

alter table public.cashgram_refunds add column if not exists purpose text not null default 'fee_refund';
alter table public.cashgram_refunds add column if not exists target_kind text not null default '';
alter table public.cashgram_refunds add column if not exists target_id text not null default '';
alter table public.cashgram_refunds add column if not exists target_label text not null default '';
alter table public.cashgram_refunds add column if not exists staff_id text not null default '';

alter table public.cashgram_refunds drop constraint if exists cashgram_refunds_purpose_check;
alter table public.cashgram_refunds
  add constraint cashgram_refunds_purpose_check check (purpose in ('fee_refund', 'staff_pay'));

alter table public.cashgram_refunds drop constraint if exists cashgram_refunds_fee_effect_check;
alter table public.cashgram_refunds
  add constraint cashgram_refunds_fee_effect_check check (
    (purpose = 'fee_refund' and fee_effect in ('excess', 'void'))
    or (purpose = 'staff_pay' and fee_effect = 'none' and target_kind <> '' and target_id <> '')
  );

create index if not exists cashgram_refunds_target_idx
  on public.cashgram_refunds (tenant_id, target_kind, target_id);

create unique index if not exists cashgram_refunds_one_live_per_target
  on public.cashgram_refunds (tenant_id, target_kind, target_id)
  where purpose = 'staff_pay'
    and status in ('PENDING_APPROVAL', 'SENDING', 'UNKNOWN', 'ACTIVE', 'REDEEMING', 'REDEEMED');

-- A collected staff link records its UTR here like any payout.
alter table public.upi_payment_proofs drop constraint if exists upi_payment_proofs_source_check;
alter table public.upi_payment_proofs
  add constraint upi_payment_proofs_source_check check (source in ('whatsapp', 'erp', 'payout', 'cashgram'));

notify pgrst, 'reload schema';
