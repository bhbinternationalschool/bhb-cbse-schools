-- Cross-post log — idempotency for Facebook / Instagram / Telegram publishes

create table if not exists public.school_comms_cross_posts (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null,
  content_kind text not null,
  content_id text not null,
  platform text not null,
  status text not null default 'posted',
  external_post_id text not null default '',
  post_url text not null default '',
  error text not null default '',
  title text not null default '',
  posted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_slug, content_kind, content_id, platform)
);

create index if not exists school_comms_cross_posts_tenant_posted_idx
  on public.school_comms_cross_posts (tenant_slug, posted_at desc);

alter table public.school_comms_cross_posts enable row level security;

grant select, insert, update, delete on public.school_comms_cross_posts to authenticated;
grant all on public.school_comms_cross_posts to service_role;

comment on table public.school_comms_cross_posts is
  'Social cross-post audit — Facebook Page, Instagram Business, Telegram channel';
