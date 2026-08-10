# TODO — observed findings and pending work

Living tracker seeded from the 2026-08-09/10 incident-response and review
session. Big-picture roadmap lives in
[ENTERPRISE_UPGRADE_PLAN.md](./ENTERPRISE_UPGRADE_PLAN.md); this file tracks
the concrete items. Check things off in the PR that fixes them.

## Blocking / owner actions

- [x] **GitHub account was locked over billing** — resolved 2026-08-10 by
  moving the repo, not by fixing the billing. Updating the card, verifying
  it with the bank and downgrading the plan all left the account locked
  (*"The job was not started because your account is locked due to a billing
  issue."*), so all 14 branches were pushed to
  `bhbinternationalschool/bhb-cbse-schools`, where Actions runs normally.
  `ashishsingh80-web` still holds the old PRs and remains locked.
- [ ] **Point the remaining tooling at the new origin.** The worktree's
  `origin` was re-pointed; anything else that names `ashishsingh80-web`
  (other clones, bookmarks, the old PRs #1–#11) still refers to the locked
  account. Deploys are unaffected — `scripts/deploy-online.sh` goes through
  `gcloud builds submit` and never touches GitHub.

## Review findings (PR #5) — confirmed, unfixed

- [ ] **Silent prune refusal.** `deleteStale` in
  `apps/web/src/lib/sisNormalized.server.ts` refuses >20% prunes with only a
  `console.error`; no caller surfaces `refused` to the UI. A legitimate
  year-end bulk deletion (graduating cohort ≈15% + leavers) will be refused
  and staff will believe it succeeded. Surface the refusal in the sync
  result and as a toast.
- [ ] **Audit `capState` discards instead of shrinking.** In
  `apps/web/src/app/api/audit/route.ts`, before/after payloads >20KB become
  `{truncated:true}` — no field detail for large student records. Diff to
  changed fields first, then cap.
- [ ] **Duplicate migration versions.** `20260809110000` / `20260809120000`
  exist in prod history as `20260809052332` / `20260809052638`. Idempotent,
  so harmless today; reconcile the bookkeeping before it meets a
  non-idempotent migration.

## Known debt (from the incident work)

- [ ] **8-second unconditional chat sync.** `StaffInternalChatButton` POSTs
  full `erp_chat` state every 8s whether or not anything changed (noted in
  PR #6). Remove as part of the Phase 1 data-layer sweep — naive
  "skip when merged==local" is wrong when local has unsynced messages.
- [ ] **`mastersDeskPushPending()` client path** (`mastersNormalizedClient.ts`)
  can still push whole masters state; server guards now cover it, but the
  client behaviour is unexamined.
- [ ] **The database holds two schemas, and one of them is abandoned.**
  Found during the Stage 2 audit (2026-08-10). Roughly 25 tables —
  `classes`, `sections`, `students`, `households`, `concession_rules`,
  `fee_installments` and friends — form a complete relational design with
  `uuid` ids and full foreign keys. Every one is **empty**, and `grep` finds
  **zero references** to any of them in `apps/web`. The app runs on a
  different scheme entirely: text ids like `cls_p7bw8cpc`, in `sis_*` and
  `*_desk_*` tables. The two have coexisted since the foundation migration.
  It is not harmless: it cost a day of Stage 2 on the assumption the typed
  tables were usable, and it will do the same to Stage 4 (`students` vs
  `sis_students`) and Stage 5 (`fee_installments` vs the fee desk) unless
  it is settled first. Decide deliberately whether the abandoned schema is
  dropped or adopted — do not let a third stage discover it.
- [ ] **Migration `20260810020000` altered the abandoned schema for nothing.**
  It added `tenant_id`/`updated_at`/columns to those 20 tables on the premise
  they would receive the masters data, which turned out to be impossible
  (their `id` is `uuid`; every masters id is text). It also created three
  bare-named tables (`concessions`, `installments`, `fee_head_categories`)
  superseded by the `masters_desk_*` set in `20260810030000`. All harmless:
  empty, unreferenced, additive. Director's call was to leave them and
  record it rather than churn another migration. Clean up together with the
  two-schema decision above.
- [ ] **Rehome `fix/public-form-class-ids` (old-repo PR #1) + close.**
  Numbering now collides: PR #1 on the *new* repo is the revision guard;
  this is the old `ashishsingh80-web` PR #1. Its branch holds two migrations
  not on `main`: `20260809125000_repair_ids_from_mirror_snapshot.sql`
  (applied to prod manually, should be committed for the record) and
  `20260809130000_reconcile_mirror_blob_to_desk.sql` (written, guarded,
  never applied). Move both onto `main` in the new repo; the old PR closes
  itself when that account is abandoned.
- [ ] **Linux native-binary pins are duplicated in three places.**
  `package-lock.json` is generated on macOS, and npm prunes every non-darwin
  platform binary out of it (npm/cli#4828) — the tree carries
  `lightningcss-darwin-arm64` and no `linux-x64-gnu` entry at all. Any Linux
  build therefore dies in Tailwind v4 with *"Cannot find module
  '../lightningcss.linux-x64-gnu.node'"*; this is why the CI production-build
  job had never passed (masked until 2026-08-10 by the billing lock).
  Both CI jobs now install the Linux binaries explicitly after `npm ci`,
  the way `apps/web/Dockerfile` already did — so `lightningcss@1.32.0` and
  `@tailwindcss/oxide@4.3.2` are each pinned in **three** spots
  (Dockerfile + two CI jobs) on top of the lockfile. Bump one and miss
  another and CI or the deploy breaks in a way that looks unrelated to the
  change. Collapse to one source: either a composite action / shared step,
  or regenerate the lockfile with all platforms
  (`npm install --os=linux --cpu=x64`) so `npm ci` alone is enough.
- [x] **`allowMissingClass` defeats its own check at 6 call sites.**
  Fixed 2026-08-10 (`d8b1ef5`). Five were deliberate capture-first flows —
  behaviour unchanged, now spelled as a literal `true` with the reason;
  making them strict would have started rejecting field-collected leads.
  The sixth, `createRegistrationFromDesk`, passes `false`: its only caller
  already refuses a family with no class, so the flag was dead code.
  Original finding below for the record.
  `createEnquiry` (`admissions.ts:1518`) refuses a lead with no
  `classSoughtId` — *unless* `opts.allowMissingClass`. Six of the thirteen
  callers pass `allowMissingClass: !draft.classSoughtId`, i.e. "if the class
  is missing, permit it to be missing", so the check can never fire there:
  `fieldSurvey.ts:414`, `fieldSurvey.ts:505`, `admissions.ts:2975`,
  `admissions.ts:3005`, `admissions.ts:3900`,
  `StaffRegistrationCollectApp.tsx:98`. (The public form and
  `admissionsLeadIngest.server.ts` pass a bare `true` — deliberate, so a
  parent enquiry is never lost, and they compensate by writing the class
  *name* into `campaignNote`. Those two are fine; the six are not.)
  Decide per call site whether the class is genuinely optional; where it is,
  capture the class as text the way the public form does, so it stays
  recoverable.
- [ ] **30 leads carry a blank `class_sought_id`.** Found while verifying the
  post-deploy baseline on 2026-08-10. *Not* incident damage: re-seed orphans
  hold a stale-but-non-empty id from an old generation, these hold `''`.
  All 30 arrived on **2026-07-18** from two spreadsheet imports
  (`BHB_School_Enquiry_Survey.xlsx` ×28, `Field_Leads.xlsx` ×2),
  `source=field_survey`, all still at stage `enquiry`, none converted to a
  student. No `classAdmittedId`, no `sectionId` and no `dob` to infer from —
  and **only 1 of the 30 is recoverable**: `adm_6aipg2wf`, whose note reads
  `Classes noted: Eleventh` → class `XI` (`cls_azz0fhyx`). An earlier pass
  claimed 23 were recoverable; that was a bad regex matching the word
  "Classes" inside `Classes noted: No`, which records the *opposite*. The
  true split is 22 × `Classes noted: No`, 2 × a current-school name only
  (`Primary`, `Gyandeep` — not a class sought), 2 × `Interest:` only, 3 ×
  `Imported from …` only. The source spreadsheets recorded no class, so
  for 29 of them there is nothing in the system to repair from — only
  re-contacting the family recovers it.
  **Decided 2026-08-10 (director): leave all 30 as they are.** Including
  `adm_6aipg2wf` — "Eleventh" is an inference from a survey note, not a
  parent's confirmed answer, and a wrong class on a real child is worse
  than a blank one. They stay at stage `enquiry` and surface whenever
  someone opens them; staff record the class when they next speak to the
  family. No script should backfill these.
- [ ] **Baseline query should count blanks.** The "zero unresolved
  references" baseline below was measured in a way that ignored empty-string
  ids, which is why these 30 never showed. Any future check should treat
  `''` and a stale id as two distinct failures, not fold both into "null".
- [ ] **Snapshot-table cleanup.** Drop
  `sis_students_pre_snapshotrepair_20260809`,
  `admission_desk_leads_pre_snapshotrepair_20260809`,
  `rte_desk_seats_pre_snapshotrepair_20260809` after a quiet week
  (earliest 2026-08-16) — they hold the pre-repair state and are RLS-locked.

## Ops watchlist

- [ ] Watch prod logs for **409s on `/api/school-data/masters-desk`** — a
  409 means a device is pushing stale/regenerated masters; the fix is
  clearing that device's site data (proven 2026-08-09).
- [ ] Current known-good baseline, re-measured post-deploy 2026-08-10 on
  revision `school-erp-web-00202-sb4`: 15 classes, generation
  `cls_p7bw8cpc…` (Nursery), masters revision `2026-08-09 19:06:35+00`,
  711 students / 919 leads / 10 RTE seats. **Zero stale-id references** —
  no student, lead or RTE seat points at a class id from a dead generation.
  The only blanks are the 30 July-import leads noted above (`''`, not a
  stale id). Any *stale-id* deviation without a deliberate masters edit is
  an incident; a moved masters revision without a deliberate edit is a
  re-seed.

## Phase 1 — server-authoritative data layer (in progress)

- [x] Masters overwrite guard: server rejects a regenerated class-id set
  (shipped 2026-08-09, `mastersWriteGuard.ts`, 409 + selftest).
- [x] **Masters revision guard** — shipped, then rolled back the same night
  because it 409'd *every* save: the client sent `readMeta().updatedAt` as
  its base, and `touchMastersDeskLocalMeta` overwrote that key with
  `new Date()` on each local save, so a local clock was being submitted as
  "the revision I hydrated at". Fixed in Stage 0 (`e57015a`) and live again.
  The lesson is in `mastersRevisionLifecycle.selftest.ts`: the original
  shipped with tests proving it *refused* bad writes and none proving a
  client could *recover* from a refusal.
- [x] **Stage 0 — a save reaches the database or says so** (`e57015a`,
  deployed `00208-bds`): the 409 loop, every rejection surfaced with its real
  reason, and student deletes actually deleting.
- [x] **Stage 1 — the data layer** (`3e1461d`, deployed `00211-jvw`):
  `desk_write_guarded` + allowlist, typed contract, `/api/data/[collection]`,
  the client write path, and the ratchets in `scripts/ratchets.txt`. Inert —
  nothing is wired to a screen.
- [ ] **Stage 1 leftovers:** TanStack Query and the read hooks (deferred
  until Stage 2 gives them a consumer), and
  `@typescript-eslint/no-floating-promises` (needs `parserOptions.project`;
  the `void_writes` ratchet covers the same ground meanwhile).
- [ ] **Stage 2 — masters (in progress):** audit, schema and the 594-record
  copy into `masters_desk_*` are done (`d514eee`) and verified id-identical.
  Remaining: register the collections, point `MastersWorkspace` at the layer
  with explicit-Save, then flip the read path.
- [ ] Extend the revision contract to the ~20 desk-slice modules
  (`createDeskSlicePersistence` family) — one shared implementation, not 20
  copies.
- [ ] Delta pushes: client sends changed records (the `sis_push_guarded`
  payload shape), never whole state.
- [ ] Unified data-access layer replacing the `*Persistence.ts` variants
  (loading/error/refetch for free; TanStack Query or equivalent thin layer).
- [ ] Delete the 8s chat sync (see Known debt).
- [ ] Exit tests from the plan: two-device convergence, kill-network
  mid-edit, regression selftest proving whole-state push is rejected.

## Done this session (for the record)

- Public `/register`+`/apply` fabricating class ids — fixed, deployed.
- Cold-server `loadMasters()` minting random ids — fixed, deployed.
- Tier 0 (signed sessions, guarded SIS push, hydration `ok` flag) — merged
  (PR #4/#5), migrations applied, deployed.
- RLS bypass closed: `authenticated`/`anon` grants revoked on 45 tables.
- `/api/chat` 503 loop (~15k failed req/day) — fixed, deployed (PR #6).
- Wholesale client desk overwrite — hydration no longer pushes (12 modules),
  masters overwrite guard live (PR #7).
- 711 students / 889 leads / 10 RTE seats repaired after three re-seeds;
  final state converged on `cls_p7bw8cpc` after clearing the stale device.
- `npm run verify` local gate with CI-drift check (PR #8/#9).
- Enterprise upgrade plan with director's decisions (PR #10).
