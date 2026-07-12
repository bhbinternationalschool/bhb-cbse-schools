-- WhatsApp fee receipt delivery tracking (Phase 1: wa.me deep link; Phase 2: Business API)

alter table public.fee_collection_vouchers
  add column if not exists whatsapp_sent_at timestamptz,
  add column if not exists whatsapp_mobile text;

comment on column public.fee_collection_vouchers.whatsapp_sent_at is
  'When cashier opened WhatsApp send for this receipt (or API delivered)';
comment on column public.fee_collection_vouchers.whatsapp_mobile is
  'Optional snapshot of number used for send';
