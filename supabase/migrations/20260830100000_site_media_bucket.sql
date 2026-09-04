-- Public object storage for anything the website and printed documents show.
--
-- Until now every "upload" in the app was a lie: `school-files` is private,
-- `/api/upload` handed back getPublicUrl() (which 403s on a private bucket),
-- and the image pickers quietly fell back to writing an 800 KB base64 data URL
-- into the database instead. The bucket has 0 objects to prove it, while
-- masters_desk_slices.schoolProfile carries a 45 kB favicon as text.
--
-- Two buckets, because two different questions:
--   school-files  private  — student photos, staff signatures, payroll challans.
--                            Served through /api/file with a staff session.
--   site-media    public   — the crest, the favicon, website photographs and
--                            video. Anyone may fetch these; that is the point.
--
-- Keeping them apart matters more than the convenience of one bucket: a
-- signature image and a gallery photo must never be one policy change away
-- from each other.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'site-media',
  'site-media',
  true,
  -- 50 MB. Images land far below this; the headroom is for a short clip of a
  -- function or a sports day, which is the only video we intend to self-host.
  52428800,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/avif',
    'video/mp4',
    'video/webm',
    'application/pdf'
  ]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- A public bucket is already readable through the public object endpoint
-- without an RLS check, but say it explicitly: someone reading the policies
-- to answer "can a parent load this photo?" should find the answer here and
-- not have to know that rule.
drop policy if exists "site-media is world readable" on storage.objects;
create policy "site-media is world readable"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'site-media');

-- Writes stay closed. Uploads go through /api/upload, which checks a staff
-- session and then uses the service role; no browser writes here directly.

-- `school-files` predates this and allows too little for the documents it
-- actually holds. Widen the image types only — no video, nothing executable.
update storage.buckets
set allowed_mime_types = array[
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/avif',
      'application/pdf'
    ]
where id = 'school-files';
