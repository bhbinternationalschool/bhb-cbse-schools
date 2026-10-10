-- Give the Counsellor and the Computer Operator a working desk.
--
-- Applied by hand against production on 2026-09-08 (migrations here are run
-- from the SQL editor, not by the deploy pipeline); committed so the change
-- is in version control and reproducible on any other environment.
--
-- Both were resolving to `support`, which carries exactly ONE of the 24 desk
-- commands (`school_snapshot`, home.view). Every other command answered
-- "your role doesn't include …", which reads as the desk being broken
-- rather than as a permission they lack. `rbac.inferRoleCodes` has no
-- designation pattern for "counsellor" or "operator", and adding one would
-- repeat the mistake that got the "director" pattern removed — routine HR
-- text silently deciding access. So: explicit assignments, decided by a
-- human.
--
-- `office` is the front-desk role: 22 of 24 commands. It cannot run
-- `staff_broadcast` (needs notifications.edit; office holds view) or
-- `post_homework` (needs homework.edit, and that command is app-only
-- anyway, because the class channel owns teacher homework posts).
--
-- Note what `office` reaches that a counselling role would not obviously
-- need: the fee commands — pay_link, fee_reminder, collection_today,
-- student_fees. Narrow either person later by replacing their assignment,
-- not by adding a second one: one active assignment already switches off
-- designation inference for that person entirely.
--
-- Idempotent: the NOT EXISTS guard means re-running adds nothing. Written
-- read-modify-write against the existing state so nothing else in the row
-- is clobbered.
with newrows as (
  select '[
    {"id":"ura_7pq2vd41","staffId":"stf_ot5fh2x","roleId":"role_office","isPrimary":true,
     "scope":{"campusIds":[],"classIds":[],"departmentIds":[]},"expiresOn":"",
     "note":"Rashmi Yadav (STF-021), Counsellor — office access, granted 2026-09-08"},
    {"id":"ura_3ne6ky85","staffId":"stf_crbnoz8","roleId":"role_office","isPrimary":true,
     "scope":{"campusIds":[],"classIds":[],"departmentIds":[]},"expiresOn":"",
     "note":"Shreya Sharma (STF-033), Computer Operator — office access, granted 2026-09-08"}
  ]'::jsonb as a,
  '[
    {"id":"aud_offc4rashm","at":"2026-09-08T00:00:00.000Z","by":"director@bhbinternational.school",
     "action":"assign_role",
     "detail":"Office assigned to Rashmi Yadav (STF-021, stf_ot5fh2x), Counsellor — 22 of 24 desk commands, no expiry"},
    {"id":"aud_offc4shrey","at":"2026-09-08T00:00:00.000Z","by":"director@bhbinternational.school",
     "action":"assign_role",
     "detail":"Office assigned to Shreya Sharma (STF-033, stf_crbnoz8), Computer Operator — 22 of 24 desk commands, no expiry"}
  ]'::jsonb as e
)
update rbac_state r
set state = jsonb_set(
      jsonb_set(r.state, '{assignments}',
                coalesce(r.state->'assignments', '[]'::jsonb) || n.a),
      '{audit}', n.e || coalesce(r.state->'audit', '[]'::jsonb)
    ),
    updated_at = now()
from newrows n
where not exists (
  select 1
  from jsonb_array_elements(coalesce(r.state->'assignments', '[]'::jsonb)) x
  where x->>'roleId' = 'role_office'
    and x->>'staffId' in ('stf_ot5fh2x', 'stf_crbnoz8')
);
