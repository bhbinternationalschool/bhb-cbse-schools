-- Canva for Education → birthday cards.
--
-- The school designs its card in Canva with data fields ({name}, {class},
-- {photo} …); the ERP fills that design for each birthday through Canva's
-- Connect API (autofill), exports a PNG and sends it the way the built-in
-- cards go today. One school-wide connection, made once by an admin.

-- The tenant's Canva integration and its OAuth grant. The client id/secret
-- are the school's own integration from the Canva Developer Portal, entered
-- in the ERP rather than in Secret Manager so turning this on needs no
-- deploy. Server-only: RLS on and no policies, so only service_role reads it.
create table if not exists public.canva_connection (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  client_id text not null default '',
  client_secret text not null default '',
  access_token text not null default '',
  -- Canva refresh tokens are SINGLE-USE: every refresh returns a new one and
  -- the old one dies. Refreshes therefore compare-and-swap on this column so
  -- two processes refreshing at once cannot strand the connection.
  refresh_token text not null default '',
  expires_at timestamptz not null default now(),
  scopes text not null default '',
  connected_by text not null default '',
  connected_at timestamptz,
  updated_at timestamptz not null default now()
);

-- One rendered card per person per day. A WhatsApp image link is fetched by
-- Meta (and sometimes again by the phone), so the card is made once and the
-- PNG kept in the private bucket; the signed card URL streams it.
create table if not exists public.birthday_canva_cards (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- 'student:<id>' or 'staff:<id>' — the same split the HMAC uses.
  subject_key text not null,
  date text not null,
  canva_source_design_id text not null,
  canva_design_id text not null default '',
  storage_path text not null default '',
  created_at timestamptz not null default now(),
  primary key (tenant_id, subject_key, date, canva_source_design_id)
);

alter table public.canva_connection enable row level security;
alter table public.birthday_canva_cards enable row level security;
revoke all on public.canva_connection from anon, authenticated;
revoke all on public.birthday_canva_cards from anon, authenticated;

-- Every new table needs an explicit service_role grant, or the server's
-- writes fail 42501 and the request "succeeds" while storing nothing.
grant all on public.canva_connection to service_role;
grant all on public.birthday_canva_cards to service_role;

notify pgrst, 'reload schema';
