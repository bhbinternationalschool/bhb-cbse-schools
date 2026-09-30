-- WhatsApp template autopilot (director, 30 Sep 2026): a message whose
-- template is not approved is held and sent automatically once Meta approves
-- it; a rejected template is rewritten and resubmitted without anyone
-- having to open the ERP.
--
-- wa_held_sends — one row per held message.
--   recipients — mobiles per template language still waiting:
--                {"hi": ["98…"], "en": ["97…"]}. A language group is removed
--                as soon as it is sent, so a partial release never repeats.
--   vars       — the template variables, by name.
--   status     — held → sending (claimed by one server) → held | sent;
--                expired when the day it talks about came first; failed when
--                a send broke midway and was not retried (never re-sent
--                blindly: a family may already have it).
create table if not exists public.wa_held_sends (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  family_key text not null,
  module text not null default 'notices',
  label text not null default '',
  recipients jsonb not null default '{}'::jsonb,
  vars jsonb not null default '{}'::jsonb,
  status text not null default 'held'
    check (status in ('held', 'sending', 'sent', 'expired', 'failed')),
  requested_by_name text not null default '',
  requested_by_mobile text not null default '',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  released_at timestamptz,
  result jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists wa_held_sends_open_idx
  on public.wa_held_sends (tenant_id, status, expires_at);

-- wa_template_repairs — the automatic rewrites of one template, so there are
-- at most two before a person is asked, and the director is told once.
create table if not exists public.wa_template_repairs (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  family_key text not null,
  language text not null,
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  last_reason text not null default '',
  last_body text not null default '',
  last_error text not null default '',
  notified_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, family_key, language)
);

comment on table public.wa_held_sends is
  'WhatsApp messages held because their template was not approved; sent automatically on approval, dropped when the day they are about comes first.';
comment on table public.wa_template_repairs is
  'Automatic AI rewrites of rejected WhatsApp templates: attempts, Meta''s last reason, and when the director was told.';

-- Server-only tables.
alter table public.wa_held_sends enable row level security;
alter table public.wa_template_repairs enable row level security;

-- Every new table needs an explicit service_role grant, or the server's
-- writes fail 42501 while the request "succeeds".
grant all on public.wa_held_sends to service_role;
grant all on public.wa_template_repairs to service_role;

notify pgrst, 'reload schema';
