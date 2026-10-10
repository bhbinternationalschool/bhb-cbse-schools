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
  -- 100 MB: a one- to two-minute phone video. Photos land far below.
  104857600,
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
