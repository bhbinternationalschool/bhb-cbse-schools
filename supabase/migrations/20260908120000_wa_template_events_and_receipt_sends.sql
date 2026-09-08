-- Two things WhatsApp needs to survive a deploy.
--
-- 1. TEMPLATE STATUS EVENTS
--
-- Meta tells us a template was approved by webhook. That event was being
-- appended to a JSON file under `process.cwd()/.data`, which on Cloud Run is
-- a container-local disk: wiped on every deploy, every new instance and every
-- scale to zero. So the notification that `bhb_fee_receipt` had been approved
-- was written to a machine that no longer exists.
--
-- The visible symptom was a fee receipt that would not send. The ERP still had
-- the template as `pending`, so it refused to use it, fell back to plain text,
-- and Meta rejected plain text outside the 24-hour window. The template had
-- been approved in BOTH languages for days.
--
-- 2. RECEIPT SENDS
--
-- Receipts now message the family on their own, so there has to be a durable
-- record of which receipt has already been sent. Kept in the database rather
-- than in the receipt row because a send is not a property of the money — the
-- receipt must stand whether or not WhatsApp was reachable — and because the
-- browser's copy of the fee book is not a safe place to remember it.

create table if not exists public.wa_template_events (
  id bigserial primary key,
  tenant_id uuid not null,
  kind text not null check (kind in ('status', 'quality')),
  payload jsonb not null,
  received_at timestamptz not null default now(),
  applied_at timestamptz
);

comment on table public.wa_template_events is
  'Meta template webhook events awaiting application to wa_templates_state. '
  'Previously a JSON file on the container disk, so every deploy lost them.';

create index if not exists wa_template_events_pending_idx
  on public.wa_template_events (tenant_id, kind, received_at)
  where applied_at is null;

create table if not exists public.wa_receipt_sends (
  tenant_id uuid not null,
  voucher_id text not null,
  receipt_no text not null default '',
  mobile text not null default '',
  status text not null default 'sent',
  template_name text not null default '',
  language text not null default '',
  error text not null default '',
  wa_message_id text not null default '',
  sent_at timestamptz not null default now(),
  primary key (tenant_id, voucher_id)
);

comment on table public.wa_receipt_sends is
  'One row per receipt the school has auto-messaged. The primary key IS the '
  'idempotency: a retried or replayed push cannot message a family twice '
  'about the same receipt.';

create index if not exists wa_receipt_sends_sent_at_idx
  on public.wa_receipt_sends (tenant_id, sent_at desc);

-- Without this the service role writes fail with 42501 and the failure is
-- silent at the call site. Every new table in this project needs it.
grant select, insert, update, delete on public.wa_template_events to service_role;
grant usage, select on sequence public.wa_template_events_id_seq to service_role;
grant select, insert, update, delete on public.wa_receipt_sends to service_role;
