/*
 * Every WhatsApp message to and from the school's numbers, one row each
 * (director, 9 Oct 2026: "show all communication like the actual WhatsApp
 * app"). Until now each feature kept its own partial log — bot threads,
 * household_message_log (some automation), relay tables — and the send
 * functions themselves logged nothing, so a family's chat in the ERP missed
 * homework, receipts, reminders and broadcasts.
 *
 * Written at the two places every message passes: the send functions in
 * lib/waSend.ts (outbound) and the webhook right after de-duplication
 * (inbound). Delivery ticks come from wa_message_delivery by wa_message_id.
 * Append-only.
 */

create table if not exists public.wa_messages (
  id bigserial primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  /** The family's or staff member's number, last 10 digits. */
  mobile10 text not null,
  direction text not null check (direction in ('in', 'out')),
  /** text | template | document | location | flow | interactive | image | audio | video | media */
  kind text not null default 'text',
  body text not null default '',
  template_name text not null default '',
  /** Template variables, in order — so the message can be shown as the family read it. */
  template_params jsonb not null default '[]'::jsonb,
  wa_message_id text not null default '',
  /** For an inbound reply: the school message it answered (Meta's context.id). */
  reply_to_wa_message_id text not null default '',
  ok boolean not null default true,
  error text not null default '',
  /** The school number it went from / came to (Meta phone_number_id), when known. */
  phone_number_id text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists wa_messages_mobile_idx on public.wa_messages (tenant_id, mobile10, created_at desc);
create index if not exists wa_messages_wamid_idx on public.wa_messages (tenant_id, wa_message_id);
create index if not exists wa_messages_created_idx on public.wa_messages (tenant_id, created_at desc);

comment on table public.wa_messages is
  'Every WhatsApp message in and out, one row each, written by lib/waSend.ts and the webhook. Append-only.';

/* ─── RLS + grants ─────────────────────────────────────────── */
-- Every new table needs the service_role grant spelled out, or the server's
-- writes fail with a bare 42501 that reads like a bug in the caller.

alter table public.wa_messages enable row level security;

drop policy if exists wa_messages_tenant_read on public.wa_messages;
create policy wa_messages_tenant_read
  on public.wa_messages
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

grant select on public.wa_messages to authenticated;
grant select, insert, update, delete on public.wa_messages to service_role;
grant usage, select on sequence public.wa_messages_id_seq to service_role;

notify pgrst, 'reload schema';
