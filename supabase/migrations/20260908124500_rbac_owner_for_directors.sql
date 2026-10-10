-- Grant `owner` to the two Directors who are not the super-admin email.
--
-- Applied by hand against production on 2026-09-08 (migrations here are run
-- from the SQL editor, not by the deploy pipeline); committed so the change
-- is in version control and reproducible on any other environment.
--
-- Why this is needed at all: rbac.inferRoleCodes has designation patterns
-- for principal, admin, office, accounts, driver, teacher and gate, but
-- deliberately none for "director" — a designation containing "Director"
-- used to grant owner by accident, so it was removed. The only inferred
-- path to owner is now isProtectedSuperAdminEmail(); everyone else needs an
-- explicit assignment, which is what this is.
--
-- `owner` = every module, every action, including billing, policy override
-- and audited impersonation. Asked for explicitly by the director on
-- 2026-09-08; `principal` would have covered all 24 desk commands without
-- impersonation.
--
-- Idempotent: the NOT EXISTS guard means re-running adds nothing. Written
-- read-modify-write against the existing state so nothing else in the row
-- is clobbered.
with newrows as (
  select '[
    {"id":"ura_9k3m2wq7","staffId":"stf_4oxhsjc","roleId":"role_owner","isPrimary":true,
     "scope":{"campusIds":[],"classIds":[],"departmentIds":[]},"expiresOn":"",
     "note":"Beena Singh (STF-012), Director — full owner access, granted 2026-09-08"},
    {"id":"ura_5b8xr1td","staffId":"stf_n95e15t","roleId":"role_owner","isPrimary":true,
     "scope":{"campusIds":[],"classIds":[],"departmentIds":[]},"expiresOn":"",
     "note":"Kanchan Singh (STF-010), Director — full owner access, granted 2026-09-08"}
  ]'::jsonb as a,
  '[
    {"id":"aud_ownr4beena","at":"2026-09-08T00:00:00.000Z","by":"director@bhbinternational.school",
     "action":"assign_role",
     "detail":"Owner assigned to Beena Singh (STF-012, stf_4oxhsjc), Director — all modules, all actions, no expiry"},
    {"id":"aud_ownr4kanch","at":"2026-09-08T00:00:00.000Z","by":"director@bhbinternational.school",
     "action":"assign_role",
     "detail":"Owner assigned to Kanchan Singh (STF-010, stf_n95e15t), Director — all modules, all actions, no expiry"}
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
  where x->>'roleId' = 'role_owner'
    and x->>'staffId' in ('stf_4oxhsjc', 'stf_n95e15t')
);
