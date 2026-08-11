
create table if not exists wa_contact_state (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  mobile_e164 text not null,
  last_inbound_at timestamptz,
  opted_out_at timestamptz,
  opted_out_reason text,
  updated_at timestamptz not null default now(),
  unique (tenant_id, mobile_e164)
);

alter table wa_contact_state enable row level security;

create policy wa_contact_state_tenant_all
  on wa_contact_state
  for all
  using (is_tenant_member(tenant_id));

create table if not exists wa_message_delivery (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  wa_message_id text not null,
  client_message_id text,
  mobile_e164 text,
  status text not null,
  error_message text,
  event_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table wa_message_delivery enable row level security;

create policy wa_message_delivery_tenant_all
  on wa_message_delivery
  for all
  using (is_tenant_member(tenant_id));

create index if not exists wa_message_delivery_tenant_msg_idx
  on wa_message_delivery (tenant_id, wa_message_id);

