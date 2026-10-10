/* ───────────────────────────────────────────────────────────────
   Website Phase 2 — keep the name the office gave the file.

   Storage keys are generated (`site/2026-08-30-a1b2c3.png`) so that a
   re-upload can never be masked by a year-long cache header. The side
   effect is that the name the file arrived with is thrown away, and two
   things depended on it:

     - The alt-text guard that refuses a file name as a description. It
       compared against the storage key, which never matches what anyone
       types, so the guard silently passed everything. It was verified only
       by a unit test that supplied the file name directly — testing a path
       the application itself could not reach.

     - The office recognising its own files. "2026-08-30-a1b2c3.png" means
       nothing to the person who uploaded "prize day 2026.jpg".

   Kept as a plain label. It is never used to address storage, so a file
   arriving with an awkward name cannot affect where anything is written.
   ─────────────────────────────────────────────────────────────── */

alter table public.site_media
  add column if not exists original_filename text not null default '';

comment on column public.site_media.original_filename is
  'The name the file arrived with. A label for humans and the alt-text guard; never used as a storage key.';

notify pgrst, 'reload schema';
