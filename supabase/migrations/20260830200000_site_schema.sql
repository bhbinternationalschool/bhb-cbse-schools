-- Website Phase 1 — the five tables the public site is built from.
--
-- Server-authoritative, deliberately. Most desks here are localStorage-first:
-- the browser holds the truth and pushes a copy. A website cannot work that
-- way. A parent, a search engine and an admissions enquiry all read the
-- public page and none of them has a localStorage — and on 2026-08-21 a
-- stale browser pushing an empty state hard-deleted the whole Transport desk.
-- A site that one forgotten tab can blank is not a site.
--
-- So these ride the generic write path (desk_write_guarded, migration
-- 20260810010000): every change is a stated per-record op with the revision
-- the client believed it was editing. Nothing here ever accepts a whole-module
-- state object, which is the mechanism that emptied Transport.
--
-- Conventions kept from inv_* and masters_desk_*: `id text` (the guard
-- compares ids as text), tenant_id FK + RLS via is_tenant_member(), explicit
-- service_role grants — a new table without them fails writes with 42501 —
-- and a pgrst reload at the end.

/* ─── Pages ────────────────────────────────────────────────────
   A page is a slug, some furniture, and an ordered list of blocks. */

create table if not exists public.site_pages (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- 'about', 'academics/curriculum'. No leading slash; the router adds it.
  slug text not null,
  title text not null default '',
  -- Where it appears in navigation. '' = reachable by URL but not listed,
  -- which is how a page is drafted in the open without announcing itself.
  nav_group text not null default ''
    check (nav_group in ('', 'header', 'footer')),
  nav_order int not null default 0,
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'published', 'archived')),
  -- Reuses the vocabulary the Comms desk already publishes with, so the
  -- existing scheduled-publish tick can drive both.
  scheduled_publish_at timestamptz,
  published_at timestamptz,
  -- Search and social. Left blank the page falls back to title and the first
  -- paragraph, rather than publishing an empty <meta>.
  seo_title text not null default '',
  seo_description text not null default '',
  og_media_id text not null default '',
  created_by text not null default '',
  updated_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Soft delete: "someone deleted the About page" has to be answerable.
  deleted_at timestamptz
);

-- Two live pages cannot share a URL. Archived and deleted ones may keep
-- theirs, so a slug can be reused after a page is retired.
create unique index if not exists site_pages_tenant_slug_uidx
  on public.site_pages (tenant_id, lower(slug))
  where deleted_at is null;

create index if not exists site_pages_tenant_status_idx
  on public.site_pages (tenant_id, status, nav_group, nav_order);

/* ─── Blocks ───────────────────────────────────────────────────
   Pages are assembled from typed blocks rather than a free-HTML editor: the
   office picks a block and fills its fields, so every page inherits the
   site's typography and no one can paste in broken markup or a tracking
   pixel. `kind` is checked here as well as in TypeScript because the check
   that matters is the one the database enforces. */

create table if not exists public.site_blocks (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  page_id text not null,
  ord int not null default 0,
  kind text not null
    check (kind in (
      'prose', 'image', 'gallery', 'video', 'cards', 'stats',
      'people', 'downloads', 'feed', 'calendar', 'faq', 'enquiry'
    )),
  -- Shape depends on kind; the renderer narrows it. Never raw HTML.
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists site_blocks_page_idx
  on public.site_blocks (tenant_id, page_id, ord)
  where deleted_at is null;

/* ─── Media ────────────────────────────────────────────────────
   One row per file in the site-media bucket. The row is what makes a file
   answerable later: what it shows, who may appear in it, and whether a parent
   has agreed to it being published. */

create table if not exists public.site_media (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  bucket text not null default 'site-media',
  storage_path text not null,
  url text not null,
  mime text not null default '',
  bytes bigint not null default 0,
  width int not null default 0,
  height int not null default 0,
  -- What a blind visitor hears and what a search engine reads. Phase 2 makes
  -- this mandatory before an image can be placed on a page.
  alt text not null default '',
  caption text not null default '',
  credit text not null default '',
  -- Photographs of identifiable children are that child's personal data.
  -- 'not_required' is for a building or a certificate; anything showing a
  -- student needs 'granted' before it may be rendered publicly.
  consent_status text not null default 'not_required'
    check (consent_status in ('not_required', 'pending', 'granted', 'withdrawn')),
  -- Household the consent was given by, when there is one.
  consent_household_id text not null default '',
  consent_note text not null default '',
  -- Same bytes uploaded twice should reuse one row rather than two files.
  content_hash text not null default '',
  uploaded_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists site_media_tenant_created_idx
  on public.site_media (tenant_id, created_at desc)
  where deleted_at is null;

create unique index if not exists site_media_tenant_hash_uidx
  on public.site_media (tenant_id, content_hash)
  where content_hash <> '' and deleted_at is null;

/* ─── Menu ─────────────────────────────────────────────────────
   The header and footer, so the office can reorder navigation without a
   developer. Separate from site_pages because a menu entry may point at
   something that is not a page — the fee schedule, an external form. */

create table if not exists public.site_menu (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  label text not null default '',
  href text not null default '',
  nav_group text not null default 'header'
    check (nav_group in ('header', 'footer')),
  ord int not null default 0,
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists site_menu_tenant_group_idx
  on public.site_menu (tenant_id, nav_group, ord);

/* ─── Publications ─────────────────────────────────────────────
   The "show on website" bridge.

   Notices, news, albums and events already exist in the Comms and Events
   desks with their own draft/published lifecycle — an internal one. Being
   visible to parents in the portal and being visible to the whole internet
   are different decisions, and conflating them is how a school accidentally
   publishes something. So public visibility is a separate row, with its own
   window, referencing the source by id.

   Not a foreign key, on purpose: the sources live in four different tables
   and one of them (gallery) is still local-first. Same lookup-only pattern
   Accounts uses for sourceType/sourceId. */

create table if not exists public.site_publications (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_kind text not null
    check (source_kind in ('notice', 'news', 'album', 'event')),
  source_id text not null,
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'published', 'archived')),
  scheduled_publish_at timestamptz,
  published_at timestamptz,
  unpublished_at timestamptz,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One publication decision per source. Ticking "show on website" twice is
-- the same decision, not two.
create unique index if not exists site_publications_source_uidx
  on public.site_publications (tenant_id, source_kind, source_id);

create index if not exists site_publications_live_idx
  on public.site_publications (tenant_id, status, published_at desc);

/* ─── RLS + grants ─────────────────────────────────────────────
   A new table without the service_role grant accepts reads and fails writes
   with 42501, silently as far as the UI is concerned. That has already cost
   this project a day. */

do $$
declare
  t text;
begin
  foreach t in array array[
    'site_pages', 'site_blocks', 'site_media', 'site_menu', 'site_publications'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_tenant_all', t);
    execute format(
      'create policy %I on public.%I for all using (public.is_tenant_member(tenant_id))',
      t || '_tenant_all', t
    );
    execute format(
      'grant select, insert, update, delete on public.%I to service_role', t
    );
  end loop;
end
$$;

/* ─── Write allowlist ──────────────────────────────────────────
   Registering a table here is what actually grants write access through the
   generic data API. It is a separate, deliberate step from adding the
   collection in TypeScript, so neither can be done absent-mindedly. */

insert into public.desk_writable_tables (table_name, soft_delete, note) values
  ('site_pages',        true,  'Website Phase 1. Soft delete — a removed page must be restorable'),
  ('site_blocks',       true,  'Website Phase 1. Soft delete follows the page'),
  ('site_media',        true,  'Website Phase 1. Soft delete — a row may still be referenced by a block'),
  ('site_menu',         false, 'Website Phase 1. Hard delete; a menu entry carries nothing'),
  ('site_publications', false, 'Website Phase 1. Hard delete; unpublishing is a status, not a deletion')
on conflict (table_name) do nothing;

notify pgrst, 'reload schema';
