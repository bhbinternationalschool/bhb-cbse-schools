-- School comms desk — notices, news, gallery (school_comms_state blob retained)

create table if not exists public.school_comms_desk_notices (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null default '',
  body text not null default '',
  audience text not null default 'all',
  status text not null default 'draft',
  pinned boolean not null default false,
  academic_year_code text not null default '',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  created_by text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.school_comms_desk_news (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null default '',
  summary text not null default '',
  body text not null default '',
  cover_url text not null default '',
  status text not null default 'draft',
  academic_year_code text not null default '',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  created_by text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.school_comms_desk_albums (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null default '',
  description text not null default '',
  cover_url text not null default '',
  status text not null default 'draft',
  academic_year_code text not null default '',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  created_by text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.school_comms_desk_photos (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  album_id text not null default '',
  url text not null default '',
  caption text not null default '',
  uploaded_at timestamptz not null default now(),
  uploaded_by text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.school_comms_desk_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  notice_count int not null default 0,
  news_count int not null default 0,
  album_count int not null default 0,
  photo_count int not null default 0,
  last_published_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists school_comms_desk_notices_status_idx
  on public.school_comms_desk_notices (tenant_id, status, published_at desc);

comment on table public.school_comms_desk_notices is
  'School notices/circulars — system of record (text ids match desk localStorage)';
