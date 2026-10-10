-- sis_households: the family's photo-consent answer, and the guardian's photo.
--
-- Two more fields that existed in the type, were set by real code paths, and
-- had nowhere to be stored — the same defect as the geocode columns
-- (20260911100000) and sis_students.profile (20260906120000). Found while
-- auditing every SIS field on 2026-09-12.
--
--  * photo_consent — the family's answer to "may we publish a photograph of
--    your child". It is asked as a separate optional tick on the public
--    registration form, carried onto the admission household, and
--    `enrolLeadToSis` deliberately copies it onto the SIS household with the
--    comment "losing it here would silently downgrade a yes to never-asked the
--    moment the child enrolled — and the website reads the SIS household".
--    It was then dropped twice over: `normalizeHousehold` did not return the
--    field at all, and there was no column. So the website's media library
--    read "not asked" for every family, whatever they had ticked. Under the
--    DPDP-Act model the school adopted (silence is NOT consent) that failure
--    is safe in the publish direction — nothing gets published on a consent
--    that was lost — but it silently discards an answer the family gave, and
--    the school cannot act on a "yes" it cannot see.
--
--  * guardian_photo_url — set by the office's photo capture and by the bulk
--    photo import (lib/studentUpdate.ts), printed on ID cards, and returned to
--    the parent app by /api/v1/parent/summary. Kept by the normalizer, then
--    dropped by householdToRow on every push.
--
-- Text, nullable, no default: "" is a real answer for consent (not-asked) and
-- must not be confused with "no column".
alter table public.sis_households
  add column if not exists photo_consent text,
  add column if not exists guardian_photo_url text;

comment on column public.sis_households.photo_consent is
  'May the school publish a photograph of this family''s child: granted | refused | empty = never asked. Silence is not consent — see lib/photoConsent.ts.';
comment on column public.sis_households.guardian_photo_url is
  'Guardian photograph (bucket URL, or a small data URL from the office capture). Printed on ID cards, shown in the parent app.';
