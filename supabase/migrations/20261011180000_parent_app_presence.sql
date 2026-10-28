-- When a family last opened the parent app (Comms → Parents on app; the old
-- ERP's "Parent Mobile Usage Report").
--
-- The only "last opened" the server had was push_device_tokens.last_seen_at,
-- which the app refreshes on launch ONLY when notifications are allowed (and
-- on iOS only with an APNs token). A family that said no to notifications
-- used the app invisibly. This is one row per household, stamped by the app's
-- home-screen call (GET /api/v1/parent/summary) at most once an hour per
-- server instance. No device ids, IP addresses or user agents are kept — just
-- when, and which app build.

create table if not exists public.parent_app_presence (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  household_id text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  app_build integer,
  primary key (tenant_id, household_id)
);

alter table public.parent_app_presence enable row level security;

drop policy if exists parent_app_presence_tenant_all on public.parent_app_presence;
create policy parent_app_presence_tenant_all
  on public.parent_app_presence
  for all
  using (is_tenant_member(tenant_id));

grant select, insert, update, delete on public.parent_app_presence to service_role;

-- The last app invite sent to each family from that screen (one row per
-- household, latest wins), written as each WhatsApp send succeeds. Families
-- invited in the last 7 days are left out of the next invite, so a partial
-- failure followed by a second press does not message the same parents
-- twice. Kept apart from parent_app_presence on purpose: a presence row
-- means "opened the app", an invite does not.
create table if not exists public.parent_app_invites (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  household_id text not null,
  invited_at timestamptz not null default now(),
  invited_by text not null default '',
  primary key (tenant_id, household_id)
);

alter table public.parent_app_invites enable row level security;

drop policy if exists parent_app_invites_tenant_all on public.parent_app_invites;
create policy parent_app_invites_tenant_all
  on public.parent_app_invites
  for all
  using (is_tenant_member(tenant_id));

grant select, insert, update, delete on public.parent_app_invites to service_role;

notify pgrst, 'reload schema';
