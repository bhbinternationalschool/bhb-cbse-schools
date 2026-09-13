-- The office relay: messages the WhatsApp bot could not answer go to office
-- phones by category, the office replies from those phones, and the reply
-- goes back to the sender from the school number.
--
-- WHY TABLES AND NOT THE BOT BLOB
-- Bot conversations live in wa_desk_bot_slices, where every save rewrites the
-- whole bundle and the last writer wins. That is survivable for a transcript.
-- It is not survivable for "which forward did the office just reply to": two
-- parents escalating in the same second would each overwrite the other's
-- relay row, and an office reply would be routed to the wrong family. So the
-- relay is rows, with the Meta message id of every forward indexed.
--
-- The director asked that messages be kept for future reference. Nothing here
-- is deleted by the application.

/* ─── which office phone takes which kind of message ───────────── */

create table if not exists public.wa_relay_routes (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null default '',
  mobile10 text not null check (mobile10 ~ '^[6-9][0-9]{9}$'),
  /** parent, fee_enquiry, complaint, transport, admission_enquiry,
   *  job_enquiry, vendor_enquiry, meeting, staff, general */
  categories text[] not null default '{}',
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);

create index if not exists wa_relay_routes_tenant_idx
  on public.wa_relay_routes (tenant_id, active);

/* ─── a message the bot handed over ───────────────────────────── */

create table if not exists public.wa_relay_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  /** Four characters, typed by the office as "#K7Q2". */
  code text not null,
  category text not null,
  /** Why the bot gave up, in words the office reads. */
  reason text not null default '',
  sender_mobile10 text not null,
  sender_name text not null default '',
  sender_context text not null default '',
  household_id text,
  /** The sender's own message id; one relay per inbound message. */
  inbound_wa_message_id text,
  inbound_text text not null default '',
  media_note text not null default '',
  media_id text,
  media_mime text,
  /**
   * forwarded  at least one office phone got it
   * no_route   no office number is set for this category or the catch-all
   * failed     every forward failed (reasons on the forward rows)
   * replied    an office phone answered and the answer was delivered to Meta
   */
  status text not null default 'forwarded'
    check (status in ('forwarded','no_route','failed','replied')),
  created_at timestamptz not null default now(),
  replied_at timestamptz
);

create unique index if not exists wa_relay_messages_inbound_uidx
  on public.wa_relay_messages (tenant_id, inbound_wa_message_id)
  where inbound_wa_message_id is not null;
create index if not exists wa_relay_messages_code_idx
  on public.wa_relay_messages (tenant_id, code);
create index if not exists wa_relay_messages_recent_idx
  on public.wa_relay_messages (tenant_id, created_at desc);

/* ─── each copy sent to an office phone ───────────────────────── */

create table if not exists public.wa_relay_forwards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  relay_id uuid not null references public.wa_relay_messages(id) on delete cascade,
  route_id text,
  office_name text not null default '',
  office_mobile10 text not null,
  /** Meta's id for the forward — what a swipe-reply points back at. */
  forward_wa_message_id text,
  via text not null default 'text' check (via in ('text','template','none')),
  status text not null default 'sent' check (status in ('sent','failed')),
  error text not null default '',
  sent_at timestamptz not null default now()
);

create index if not exists wa_relay_forwards_wamid_idx
  on public.wa_relay_forwards (tenant_id, forward_wa_message_id)
  where forward_wa_message_id is not null;
create index if not exists wa_relay_forwards_relay_idx
  on public.wa_relay_forwards (tenant_id, relay_id);

/* ─── each answer the office sent back ────────────────────────── */

create table if not exists public.wa_relay_replies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  relay_id uuid not null references public.wa_relay_messages(id) on delete cascade,
  office_mobile10 text not null,
  office_name text not null default '',
  /** The office phone's own message id, so a retried webhook is not re-sent. */
  office_wa_message_id text,
  matched_by text not null default 'swipe' check (matched_by in ('swipe','code')),
  body text not null default '',
  /** Meta's id for the copy sent to the original sender. */
  delivered_wa_message_id text,
  status text not null default 'sent' check (status in ('sent','failed')),
  error text not null default '',
  created_at timestamptz not null default now()
);

create unique index if not exists wa_relay_replies_office_msg_uidx
  on public.wa_relay_replies (tenant_id, office_wa_message_id)
  where office_wa_message_id is not null;
create index if not exists wa_relay_replies_relay_idx
  on public.wa_relay_replies (tenant_id, relay_id);

/* ─── RLS + grants ─────────────────────────────────────────────── */
-- Spelled out per table: a missing service_role grant fails as a bare 42501
-- that reads like a bug in the caller.

alter table public.wa_relay_routes enable row level security;
alter table public.wa_relay_messages enable row level security;
alter table public.wa_relay_forwards enable row level security;
alter table public.wa_relay_replies enable row level security;

grant select, insert, update, delete on public.wa_relay_routes to service_role;
grant select, insert, update, delete on public.wa_relay_messages to service_role;
grant select, insert, update, delete on public.wa_relay_forwards to service_role;
grant select, insert, update, delete on public.wa_relay_replies to service_role;

notify pgrst, 'reload schema';
