-- Class gallery (director, 10 Oct 2026): class teachers take photos and videos
-- in the staff app; only the parents of THAT class see them in the parent app.
--
-- A bucket of its own, private: pictures of children belong to their class's
-- families, not to anyone holding a link (site-media is public), and video is
-- not allowed in school-files. Nobody reads it directly — the ERP checks who
-- is asking (staff, or a parent whose child is in that class) and hands back a
-- signed link that lasts minutes (/api/v1/gallery/media/<photoId>).
--
-- Uploads go phone → storage with a signed upload URL issued after the
-- class-teacher check: a phone video does not fit Cloud Run's 32 MB request.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'class-gallery',
  'class-gallery',
  false,
  -- 500 MB: a five-minute phone video (director: storage is not the limit).
  -- Photos land far below. The project-wide upload cap (Storage settings)
  -- must be at least this, or big videos are refused before this applies.
  524288000,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/3gpp'
  ]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- No storage policies: anon and authenticated keys read and write nothing
-- here. The service role (the ERP's server) does both, after its own checks.

-- Which class an album belongs to, and what each item is. An album with no
-- sections is school-wide (every album before this); one with sections is
-- seen only by those sections' families. A class-gallery item keeps its path
-- in the private bucket; its url is the ERP route that checks the viewer.
alter table public.school_comms_desk_albums
  add column if not exists section_ids text[] not null default '{}',
  add column if not exists class_label text not null default '';
alter table public.school_comms_desk_photos
  add column if not exists media_kind text not null default 'photo',
  add column if not exists storage_path text not null default '';

-- Nothing reaches parents unchecked (director, 10 Oct 2026). A class-gallery
-- item starts 'pending'; an AI check makes it 'ok' or 'held' (with a reason);
-- the principal approves a held item ('ok') or removes it ('removed' — the
-- row stays so a stale browser copy cannot bring it back; the file goes).
-- Everything before this, and office uploads, are 'ok'.
alter table public.school_comms_desk_photos
  add column if not exists review_status text not null default 'ok',
  add column if not exists review_note text not null default '',
  add column if not exists review_attempts integer not null default 0;
create index if not exists school_comms_desk_photos_review_pending
  on public.school_comms_desk_photos (tenant_id, review_status)
  where review_status = 'pending';

-- The bucket is the fast, private place parents' phones play from — for 30
-- days (director, 10 Oct 2026). After that, once the Drive copy is confirmed,
-- the bucket copy is deleted and the ERP serves the item from Drive. The only
-- copy is never deleted.
alter table public.school_comms_desk_photos
  add column if not exists storage_evicted_at timestamptz;
