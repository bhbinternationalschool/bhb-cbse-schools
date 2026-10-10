-- Web Push subscriptions (Round 14 — minimal slice). One row per
-- browser/device that opted in, not per user — a parent can have several
-- devices, each with its own subscription. subject_type/subject_id is a
-- lookup-key pair (not a hard FK), matching the precedent SchoolEvent.albumId
-- established for cross-entity references — subject_type='parent' today,
-- room for 'staff' later with no schema change.

create table if not exists public.push_subscriptions (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  subject_type text not null,
  subject_id text not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

create policy push_subscriptions_tenant_all
  on public.push_subscriptions
  for all
  using (is_tenant_member(tenant_id));

create index if not exists push_subscriptions_subject_idx
  on public.push_subscriptions (tenant_id, subject_type, subject_id);

grant select, insert, update, delete on public.push_subscriptions to service_role;

notify pgrst, 'reload schema';
