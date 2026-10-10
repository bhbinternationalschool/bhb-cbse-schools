-- FCM device tokens for the Flutter app (Phase 7 — native push). Sits next
-- to push_subscriptions (Web Push for the PWA): same subject_type/subject_id
-- lookup-key pair ('parent' → householdId, 'staff' → staffId or email), one
-- row per installed device. sendPushToSubject() fans out to both tables.

create table if not exists public.push_device_tokens (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  subject_type text not null,
  subject_id text not null,
  token text not null unique,
  platform text not null default '',
  app_version text not null default '',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.push_device_tokens enable row level security;

create policy push_device_tokens_tenant_all
  on public.push_device_tokens
  for all
  using (is_tenant_member(tenant_id));

create index if not exists push_device_tokens_subject_idx
  on public.push_device_tokens (tenant_id, subject_type, subject_id);

grant select, insert, update, delete on public.push_device_tokens to service_role;

notify pgrst, 'reload schema';
