-- sis_push_guarded was timing out, and the timeout was silently disabling
-- optimistic locking across the whole SIS module.
--
-- The `authenticator` role carries statement_timeout=8s. The function loops
-- row-by-row in plpgsql over 904 records and measured ~17s in production, so
-- it never completed. pushSisGuarded() treated ANY rpc error as "guarded push
-- unavailable" and fell back to a legacy last-write-wins upsert — the exact
-- behaviour the function exists to replace — logging a console.warn and
-- returning success. Nothing upstream could tell the protection had not
-- applied.
--
-- The visible symptoms, all one cause: the legacy upsert rewrote all 904 rows
-- on every push, so updated_at churned, every other device's revision tokens
-- were invalidated, and the next push reported 903 conflicts. Staff saw
-- "903 records were changed by someone else" on a roster nobody had touched.
--
-- A function-scoped timeout is the right lever: it applies wherever the
-- function is called from, regardless of the caller's role, and it does not
-- loosen the 8s limit that usefully protects every other query. 120s matches
-- the database default. ALTER FUNCTION ... SET adds to proconfig rather than
-- replacing it, so the existing search_path=public setting survives — verified
-- after applying, since losing it on a security-sensitive function would be a
-- quiet regression.
--
-- This buys headroom, it does not make the function fast — the row-by-row
-- loop is still O(n) statements inside plpgsql, and at several thousand
-- students it will approach this limit too. Making it set-based is the
-- durable fix and belongs with the Stage 4 SIS migration. Recorded in
-- docs/TODO.md rather than left as a surprise for whoever hits it.
--
-- The companion change is in apps/web/src/lib/sisNormalized.server.ts: a
-- guard that is present but failing now REFUSES the push instead of quietly
-- resuming last-write-wins. Pinned by test:sis-guard-fallback.

alter function public.sis_push_guarded(uuid, jsonb, jsonb)
  set statement_timeout = '120s';

comment on function public.sis_push_guarded(uuid, jsonb, jsonb) is
  'Per-record guarded SIS push. statement_timeout is pinned to 120s because '
  'the authenticator role sets 8s, which this function exceeded at 904 '
  'records — and the caller silently fell back to a last-write-wins upsert '
  'when it did. Still row-by-row; make it set-based before the roster grows '
  'much further.';
