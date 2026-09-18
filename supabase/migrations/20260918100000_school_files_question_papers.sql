-- Question papers arrive as Word files, and `school-files` would not take them.
--
-- The school downloads a term's papers from its content publisher as a tree of
-- .docx files — 88 of them for Unit Test 1 and the Half Yearly alone. The
-- Question Papers tab now imports that folder: it parses each paper into
-- sections and questions, and keeps the original file beside it so a teacher
-- can still print the publisher's own layout. Keeping the original is the
-- point of this migration; the bucket allowed images and PDF only, and Storage
-- enforces its own list, so an upload of a .docx failed with a message about
-- mime types that said nothing about question papers.
--
-- Two changes, both narrow:
--
--   * `.docx` and the older `.doc` are allowed. Not `.docm` — a macro-enabled
--     document is a program, and nothing here needs one.
--   * The size limit rises from 10 MB to 20 MB. One paper in the school's own
--     download is 9.86 MB (a Nursery paper is almost entirely pictures), close
--     enough to the old ceiling that the next one would have failed. The public
--     `site-media` bucket is unchanged: a question paper is not public.

update storage.buckets
set allowed_mime_types = array[
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/avif',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword'
    ],
    file_size_limit = 20971520
where id = 'school-files';
