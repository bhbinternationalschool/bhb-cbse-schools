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
- [ ] **Snapshot-table cleanup.** Drop
  `sis_students_pre_snapshotrepair_20260809`,
  `admission_desk_leads_pre_snapshotrepair_20260809`,
  `rte_desk_seats_pre_snapshotrepair_20260809` after a quiet week
  (earliest 2026-08-16) — they hold the pre-repair state and are RLS-locked.

## Ops watchlist

- [ ] Watch prod logs for **409s on `/api/school-data/masters-desk`** — a
  409 means a device is pushing stale/regenerated masters; the fix is
  clearing that device's site data (proven 2026-08-09).
- [ ] Current known-good baseline (2026-08-10): class-id generation
  `cls_p7bw8cpc…`, 711 students / 919 leads / 10 RTE seats, **zero
  unresolved references**. Any deviation without a deliberate masters edit
  is an incident.

## Phase 1 — server-authoritative data layer (in progress)

- [x] Masters overwrite guard: server rejects a regenerated class-id set
  (shipped 2026-08-09, `mastersWriteGuard.ts`, 409 + selftest).
- [ ] **Masters revision guard (pilot, this PR):** optimistic locking on the
  masters push — client sends `baseUpdatedAt` it hydrated at; server 409s
  a stale base instead of last-write-wins.
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
