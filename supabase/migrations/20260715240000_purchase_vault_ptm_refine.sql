-- Refine Purchase / Vault / PTM — WhatsApp, OCR stubs, expiry digests

alter table if exists public.purchase_grns
  add column if not exists bill_image_url text,
  add column if not exists ocr_bill_no text;

alter table if exists public.vault_documents
  add column if not exists reminder_days int not null default 30;

-- Vault school-level digest settings (demo: one row per tenant)
create table if not exists public.vault_settings (
  tenant_id text primary key default 'default',
  digest_mobiles text not null default '',
  last_expiry_digest_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table if exists public.ptm_bookings
  add column if not exists whatsapp_confirmed_at timestamptz,
  add column if not exists whatsapp_reminded_at timestamptz;
