-- Homework submitted on WhatsApp, and the teacher's remark coming back.
--
-- WHY: a parent photographs the finished work and sends it to the school's
-- number; the subject teacher gets the photo with a four-character code and
-- replies "#A7K2 well done", which reaches the family. Nobody installs
-- anything and nobody opens a portal.
--
-- The second reason is Meta's 24-hour window. Free-form text only reaches a
-- family that has messaged the school within the day; a family that sends
-- their child's homework has just done so. A loop the parents themselves
-- start keeps the window open, and the school stops depending on approved
-- templates for the ordinary business of a school day.

alter table public.homework_desk_submissions
  -- 'app' (the parent app's own upload) or 'whatsapp'. The app is the
  -- default because every row written before this migration came from it.
  add column if not exists channel text not null default 'app'
    check (channel in ('app', 'whatsapp')),
  -- The code the teacher replies with. Four characters, unambiguous
  -- alphabet, unique among submissions still open for a remark.
  add column if not exists reply_code text not null default '',
  -- What the teacher wrote back, and when. Separate from teacher_ack_at,
  -- which only ever meant "seen".
  add column if not exists teacher_remark text not null default '',
  add column if not exists remark_at text not null default '',
  -- Where the photograph was filed, so the office can find it later.
  add column if not exists drive_note text not null default '';

-- A code is looked up on every teacher reply, so it is worth an index; the
-- partial predicate keeps it to the handful of submissions still awaiting
-- one rather than every submission the school has ever received.
create index if not exists homework_desk_submissions_reply_code_idx
  on public.homework_desk_submissions (tenant_id, reply_code)
  where reply_code <> '';
