# The data-layer rebuild — the command

**Status:** approved plan, v2, 13 Oct 2026. Written after an eight-lens investigation of
origin/main `2f0eb3d4` and the live revision `school-erp-web-00856-bdn`, production
measurement (Cloud Run logs, Supabase edge logs, `pg_stat_statements`), and an adversarial
review of v1 by three independent critics (feasibility for small executors, live-data
safety, completeness). Evidence with file:line citations is in [`evidence/`](./evidence/);
production numbers in [`evidence/production-measurements.md`](./evidence/production-measurements.md).

**Who this is for.** The director reads §1, §2, §5 and §6. A model executing a step reads
§0, §3, its own step in §4 and §7; every step embeds what it needs (file lists, commands,
acceptance), so no step depends on a memory note or another session's context.

---

## 0. How to use this document

For the director:

- Give an executor **one step** at a time, by number ("do step 2.1b of
  docs/data-layer-rebuild/COMMAND.md"). Steps inside a phase are ordered unless a step says
  otherwise; phases are ordered except where §4 marks parallel work.
- Merge a step only when the **acceptance test named in the step is green in CI**. Not "the
  model says it works".
- A step that adds a database migration says so in its PR title. You apply it to production
  (Supabase MCP `apply_migration` or the CLI) and confirm **before** merging; the code fails
  closed (`ok:false`, logged) when its RPC or table is missing — it never falls back to an
  old whole-desk path.
- Any "still not showing" report is answered first with the build check in §7.1, before anyone
  reads code.
- Until Phase 6 is done, the files in §7.3 are **frozen**: a PR may touch them only to
  (a) delete code, (b) turn a path into a no-op, or (c) stop a verified production data
  loss — (c) with your written OK in the PR and a Playwright regression spec in the same PR.
  Symptom patches on the replica are over.

For an executor (a Claude session of any size), paste this verbatim:

```
You are executing step <N.M> of docs/data-layer-rebuild/COMMAND.md in this repo.
Read §0, §3, step <N.M> and §7 of that file first. Do only that step.
Work in a fresh git worktree branched from origin/main (never the shared main checkout,
never on top of another unmerged branch). One PR per step, titled
"data-layer <N.M>: <goal>". The acceptance test named in the step must exist and pass in
CI before you report done. Report: what changed, the test output, the before/after numbers
the step asks for, and anything you could not do.
Never run apps/web/scripts/*.ts or `npm run bootstrap:go-live` (they write production).
apps/web/.env.local IS production: a read-only dev server is fine; any test that saves
runs against the local stack from step 1.0 only.
```

---

## 1. The verdict

**The ERP is built as a replica system, and every one of the six complaints is a replica
failure.** Each browser tab holds a hand-merged copy of every module (in page memory since
10 Oct, in localStorage before that). Each Cloud Run instance holds another copy (the
"school mirror" plus `ensure*HydratedServer`). Screens read their copy; saves push the
copy; the server merges copies; nothing tells a copy that another copy changed. The six
symptoms are the six ways copies go wrong:

| # | Director's words | Mechanism (verified in code) | Where | Lens |
|---|---|---|---|---|
| S1 | "sometimes staff is not showing" | The Masters hydrate snapshots the page copy, awaits the network, and writes the snapshot back — erasing the staff roster the parallel staff hydrate just wrote. Fixed as PR #578 (the third time: 18 Aug, 19 Sep, 12 Oct) and **not deployed**: live rev 00856 is PR #577. Also: `CoreDataGate` releases the page after 5 s without staff; screens read Masters once on mount and never again. | `lib/mastersPersistence.ts:150-171` (live :163), `components/shell/CoreDataGate.tsx:31-55` | hydration, history, harness |
| S2 | "students are not loading" | The roster hydrate never announces itself (`bhb-sis-updated` fires only on an edit); screens that read `loadSis()` in a mount effect keep the empty copy. An empty-but-200 roster is accepted as fact on every fresh page. For teachers the server computes scope from a timetable copy that is **always empty on the server**, so timetable-only teachers get zero students. | `lib/sisPersistence.ts:261-358`, `lib/sis.ts:1680-1708`, `lib/api/v1/staffScope.ts:77-96` + `lib/timetable.ts:471` | read-path, hydration, server-cost |
| S3 | "changes in Masters do not reach modules" | There is no server→client change signal of any kind (no realtime, no versions poll, no ETag round trip, no refetch on focus). Route hydration runs **once per tab** (`AppShell.tsx:220 if (bootReady) return`). After that a desk is re-read only when one of 13 screens calls `ensureMastersHydrated` after a 15 s TTL. 10 component files contain a `bhb-masters-updated` listener. Other tabs and other devices hold the morning's Masters until a full reload. | `components/shell/AppShell.tsx:205-270`, `lib/deskHydrateGuard.ts:6-27`, `lib/deskHydrationSchedule.ts:361-368` | propagation, write-path |
| S4 | "slow loading" | Every page downloads whole modules (sis-roster 1.9 MB, fees 1.5 MB, attendance 0.7 MB, masters 235 KB — never a 304). Every `loadMasters()` JSON-parses and re-normalises the whole desk; every `loadSis()` calls `loadMasters()`, parses 1.9 MB, normalises 713 students, **re-serialises the whole roster to compare strings**, and may write Masters and dispatch events — on every read, from 476 `loadMasters(` and 426 `loadSis(` occurrences (109 and 77 component files), including per keystroke in the search bar and 713× per home-dashboard tick (`computeStudentDues` re-parses transport per student). Any row conflict re-downloads **every** desk. p99 of desk GETs is 11.9 s on a 1-vCPU, min-instances-0 service that started 63 fresh instances in 24 h. | `lib/sis.ts:1578-1660`, `lib/masters.ts:2015-2060`, `lib/sliceRevClient.ts:180-195`, `lib/fees.ts:2358`, `components/shell/UniversalSearchBar.tsx:101-244` | read-path, hydration, server-cost |
| S5 | "classes and subjects vanish" | Same as S3 plus: a failed Masters read is served as `ok:true` with zero classes and marked hydrated (latent: no occurrence in 7 days of logs); the mobile API caches a failed Masters read as "no classes" for 30 s and, on a throw, answers with demo Masters carrying random ids; until the 11 Oct deploy teacher phones pushed the class-subject slice from a snapshot ~20×/day and ~25 unversioned pushes/day were accepted (none since #483 went live). | `app/api/school-data/masters-desk/route.ts:176-188`, `lib/api/v1/auth.ts:189-224`, Cloud Run app logs | hydration, propagation, write-path |
| S6 | "the app slows down" | The Flutter app has no cache and paints a spinner until the server answers; the server answers one person's question by rebuilding whole modules per request with no TTL: `principal/snapshot` runs seven whole-desk hydrates (5.03 s avg), `staff/approvals` re-pages the roster + timetable + leave + complaints on every return to the home screen (1.70 s), parents' `app/popups` loads all 717 students to find one household. Supabase sees ~1,260 whole-tenant `sis_students` selects a day (3,525 GETs on that path) and 7,904 attendance-mark page reads against 205 browser roster downloads. | `lib/principalSnapshot.server.ts:77-85`, `lib/sisPersistence.ts:361-374`, `lib/schoolMirrorRemote.server.ts:84-247`, `cbse_school_mobile/lib/core/api/api_client.dart:3243-3311` | server-cost, mobile-app |

Three facts make this a system problem rather than six bugs:

1. **98 data-layer fixes since 1 Aug (119 PRs), 66 % of them follow-ups to an earlier fix of
   the same class on another desk.** Prune-by-absence was fixed on seven desks over nine weeks
   before the 18-desk series of 9 Oct; browser quota eight times before PR #526 moved copies to
   memory — which created the read-once / placeholder / lost-update wave of 10–12 Oct (#569,
   #570, #571, #578) within 72 hours. See `evidence/history.md`.
2. **12,682 lines of replica-consistency code** (47 persistence files, 77 hydrate functions,
   a dozen guards, revisions, stamps, CAS, named deletes, serial saves) and 6,052 lines of
   their tests — 66 of those tests assert on **source text** with `readFileSync`, including
   the only test of the #578 race. Zero tests render a screen, run two clients or measure a
   payload. A PR can be entirely green while the screen behaviour is unchanged. See
   `evidence/harness.md`.
3. **The project diagnosed this on 10 Aug** (`docs/ENTERPRISE_UPGRADE_PLAN.md:43-47`,
   `docs/TODO.md` Phase 1: unified data-access layer, delta pushes, two-device convergence
   exit test) and built only the first bricks (`lib/data/*`, `/api/data/[collection]`,
   `desk_write_guarded`) — then left them unwired while every week went to the replica.

The old ERP the director compares against (SStudy: server-truth, ~5 KB per screen call,
160 ms) does not have these problems because it does not have copies.

### Which phase removes which complaint

| Complaint | Removed on the web by | Removed in the app by | You will see it as |
|---|---|---|---|
| S1 staff not showing | 0.1 (deploy #578) mostly; 2.1a + 2.3a completely | 4.1 | `counts.spec.ts` staff row; Staff page = `sis_staff` active count on every reload |
| S2 students not loading | 1.7 (teacher scope) + 3.1–3.3 | 4.1 | `counts.spec.ts` + `teacher.spec.ts` |
| S3 Masters edits not reaching modules | 1.3 + 1.4 + 2.1 (all batches) | 4.4 (refetch on resume ≤ 2 min) | `propagation.spec.ts` ≤ 30 s, no reload |
| S4 slow pages | 0.2 + 0.5 relieve; 3.1–3.5 and Phase 5 remove | — | `budget.spec.ts`; §5 bytes/requests rows |
| S5 classes/subjects vanish | 0.5 (503 on failed read, no demo Masters) + 2.1 + 2.2 | 1.3 (reference cache) | `error.spec.ts` + `propagation.spec.ts` |
| S6 app slow | — | 0.2 + 4.1a–i + 4.3 + 4.4 | §5 mobile rows from Cloud Run logs |

---

## 2. Why another round of guards cannot end it

A guard checks one write against one copy. It cannot know that another copy exists, that a
screen already read the old copy, or that a copy was built from a failed read.

Copies are not forbidden by this plan — they are confined. A copy may exist only if it is
**read-only, server-wins, invalidated by one shared signal, and never pushed back**. That is
what the reference hooks (R2) and the server reference cache (R5) are. Phases 1–2 are exactly
the "fix the replica properly" path the evidence's own fix hints describe (one change
signal, one subscription hook, no snapshot-before-await, no failed-read-as-empty), and they
remove S1, S3 and S5.

What that cheaper path cannot remove is S4 and S6: multi-MB whole-module downloads, parse-per-
read, and whole-desk rebuilds per server request are intrinsic to holding modules whole.
No invalidation scheme makes a 1.9 MB roster small. That is why Phases 3–6 replace whole-desk
reads and writes with per-screen queries and single-row writes — the shape of the old ERP.

Assumption, stated: the school's 35 staff and the office do not need offline editing. Under
R6 a flaky network shows "could not load / retry", never stale data presented as current.

---

## 3. The target architecture — seven rules

These are the law for every PR from now on, enforced by ratchets (§4 step 1.6).

**R1 — The server is the only truth.** No module copy lives in the browser or in a Cloud Run
process as a writable thing. The only client state is React Query's cache (short `staleTime`,
invalidated by R3) and form state.

**R2 — Screens read through one hook, scoped to what they show.** `useErpQuery(key, path)` →
`GET /api/data/views/<name>?…` (reference views) or `GET /api/data/<collection>?…` (row
collections, keyset-paged ≤ 200 rows, server-filtered). Reference data — masters, staff list,
rbac, module registry — are the only whole-desk reads (`useMasters()`, `useStaffList()`,
`useRbac()`, `useModuleRegistry()`), and they are read-only on the client.

**R3 — One change signal.** `GET /api/data/views/versions` returns one JSON object built by one
SQL function `erp_versions(tenant)`: `updated_at` + counts from every `*_sync_meta` table
(35 in production, 37 in migrations — see 0.6), plus `max(updated_at)` of `sis_staff`,
`sis_departments`, `sis_designations`, `masters_desk_settings`, each `module_local_state`
module key and each `*_state` blob table. The client polls it every 20 s and on tab focus; a
moved value invalidates that desk's query keys. **Every write path the kernel owns bumps its
desk's signal in the same transaction** (1.5 makes this true for `desk_write_guarded`; today
only `sis_push_guarded`, `masters_write_slices` and the `*Normalized.server.ts` pushes do).

**R4 — Writes are stated per-record changes with a base revision.** The existing contract:
`POST /api/data/<collection>` body `{ ops: WriteOp[] }`, `WriteOp = {op:'upsert'|'delete', id,
base: Revision|null, row: Partial<T>}` (`lib/data/types.ts:95-125`), executed by
`desk_write_guarded` through `lib/data/server/repo.ts`. 1.5 tightens it: a `null` base on an
existing row is refused (409 `unversioned`), deletes of people need an approval rule or a soft
delete, and every applied op bumps the desk's version. Data stored inside a `*_desk_slices`
jsonb array is written by one RPC per element (`desk_slice_row_write`) or per object slice
(`desk_slice_object_write`). No whole-desk or whole-slice POST leaves the browser, ever.

**R5 — The server answers from SQL, not from a copy.** Row desks are filtered in the `WHERE`
clause with the request's scope (`household_id`, `student_id`, `section_id`, the session-year
rule of 3.1). Slice desks (masters, rbac, timetable, transport, trust, the 13 desk-slice
modules — jsonb arrays, 60 KB and smaller) are read whole on the server through
`referenceCache(name)`, which is per-process, in-flight-deduped and keyed on that desk's value
in `erp_versions`, and filtered in Node. `ensureSchoolMirrorHydrated`, the disk mirror and
every `ensure*HydratedServer` are deleted by Phase 6.

**R6 — Unknown is never empty.** A read failure is `{ok:false}` → the query is in `error` state
→ the screen shows "could not load / retry". A `200` with zero rows for a desk whose
`erp_versions` count is non-zero is treated by the client as a failed read. `defaultMasters()`
on a configured tenant and every `seed*IfEmpty` are deleted. Server caches keep their previous
value on a failed refresh and report it; they never cache an empty result of a failed read.

**R7 — Nothing ships without a behavioural gate.** The Playwright suite (1.1) runs on every PR
against the local stack (1.0): counts equal the database, a Masters change made in context A
appears in context B within 30 s, a stale old-build writer cannot revert a kernel write, every
page stays under its byte and request budget. Text-grep self-tests are lint, not proof.

---

## 4. Phases and steps

Order is mandatory inside a phase unless marked. Each step is one PR unless marked. The
"executor brief" is extra instruction for that step, handed over together with the §0 header.

### Phase 0 — This week, director-run (0.1–0.4, 0.6) plus one small executor session (0.5)

**0.1 Deploy main, and fix the upload that drops a route.**
`.gcloudignore:13` says `assets/`, which excludes `apps/web/src/app/api/inventory/assets/`
from every `gcloud builds submit` upload — the live site answers 404 on `/api/inventory/assets`
today. Change line 13 to `/assets/` and verify with
`gcloud meta list-files-for-upload | grep api/inventory/assets` (must print the route) before
submitting. Then deploy from a clean export, with the production-writing scripts disabled:

```bash
SKIP_BOOTSTRAP=1 SKIP_WA_SUBSCRIBE=1 DEPLOY_SA_KEY=/nonexistent bash scripts/deploy-online.sh
```

Verify: `curl https://bhbinternational.school/api/app-version` changes; the Staff page shows
the `sis_staff` active count (34 of 35 rows today) on a hard-reloaded browser;
`/api/inventory/assets` returns 401, not 404.

**0.2 Keep one instance warm.** `gcloud run services update school-erp-web --region asia-southeast1 --min-instances=1`,
then change `--min-instances=0` to `1` in `cloudbuild.yaml:152` (every deploy re-applies the
file). Read the comment at `cloudbuild.yaml:142-150` first: it records why 0 was chosen when
the service was 2 vCPU and un-throttled. Today it is 1 vCPU, 2 GiB, cpu-throttled; a warm idle
instance in asia-southeast1 costs roughly US$10–27 a month depending on the idle rates applied.
What it buys: no cold instance for the first office request of each idle gap (63 fresh
instances served traffic in 24 h). What it does not buy: bursts still scale new instances. Pair
it with 0.5(c)/(d) so a warm instance cannot hold a poisoned copy all day.

**0.3 Create the deploy-on-merge trigger the docs claim exists (director-only: it needs the
director's Google identity and one browser step to authorise Cloud Build's GitHub app).**
Before running `scripts/setup-deploy-on-merge.sh`, edit it so the trigger is created with
`--included-files='apps/web/**,packages/**,cloudbuild*.yaml,deploy/**,supabase/**,scripts/deploy-online.sh'`
(a docs-only merge must not redeploy during school hours) and check `REPO_URL` matches
`bhbinternationalschool/bhb-cbse-schools`. Make a revision name its commit: `$COMMIT_SHA` is
empty on tarball builds, so add a substitution `_COMMIT_SHA: ""` to `cloudbuild.yaml`, have
`scripts/deploy-online.sh` pass `_COMMIT_SHA=${COMMIT_SHA:-$(git rev-parse HEAD)}`, label the
deploy with `--labels=commit=${_COMMIT_SHA}`, write the same value to a `COMMIT` file the
image serves from `/api/app-version`, and in `cloudbuild.deploy-on-merge.yaml`'s deploy step
`export COMMIT_SHA=$COMMIT_SHA` so the nested build inherits it. Fold the two post-deploy
`gcloud run services update --update-env-vars` calls (`deploy-online.sh:324-354`) into the single
`run deploy` so a deploy is one revision, not four. In the same PR correct the three documents
that describe a pipeline that does not exist (`docs/DEPLOY_ON_MERGE.md`,
`docs/DEPLOY_CLOUD_BUILD_TRIGGER.md`, the header of `scripts/verify.sh`), and write in §7.1 that
manual `deploy-online.sh` runs are no longer allowed once the trigger exists (a manual deploy
racing the trigger on `update-traffic` is a coin toss). Verify:
`gcloud builds triggers list` shows the trigger; the next merge produces a revision whose
`gcloud run revisions describe <rev> --format='value(metadata.labels.commit)'` equals the merge
commit.

**0.4 Freeze the replica.** Tell every session: the files in §7.3 are delete / no-op only,
with the single exception stated in §0.

**0.5 Surgical interim relief (one executor PR; files are either unfrozen or the change is
delete-shaped). Each item independently, same PR, with a self-test that runs the code:**
- (a) `lib/sliceRevClient.ts:180-195`, `lib/rowStampClient.ts:124-135`,
  `lib/sisNormalizedClient.ts:250-257`: on a conflict call `resetDeskHydrated(module)` and that
  module's own `ensure<Module>Hydrated` only — delete the `ensureAllDeskHydrated()` call. (A
  deletion in a frozen file: allowed.)
- (b) `app/api/school-data/masters-desk/route.ts:176-188`: when `readFailed` is true return 503
  `{ok:false}`, exactly as the teaching branch at :79-85 does.
- (c) `lib/api/v1/auth.ts:189-224` (`loadServerMasters`): on `readFailed` keep the previous cache
  entry and log; if there is none, throw 503; delete the `catch → defaultMasters()` branch.
- (d) `lib/schoolDataMirror.server.ts`: in production make the per-call `fs.readFile` of
  `.data/school_mirror.json` and the per-write `fs.writeFile` no-ops (keep the in-memory path).
  (A no-op in a frozen file: allowed.)
- (e) `components/dashboard/PrincipalCockpit.tsx:128-154`: one in-flight `fetchSnapshot` at a
  time, and at most one per 10 s.
- (f) `app/api/school-data/fees-vouchers/route.ts:60-75`, `attendance-registers/route.ts:127-139`,
  `sis-roster/route.ts:66-68`: add the ancillary tables each body reads to its probe list
  (`evidence/write-path.md` §5 lists them), so a day-close or an attendance policy is not served
  stale for five seconds to a minute.
- (g) `components/pwa/UpdateBar.tsx`: when `/api/app-version` differs from the running build,
  reload on the next client navigation (never mid-form).
Acceptance: `npm run verify` green; a self-test per item that **executes** the changed code
(not a `readFileSync` grep); post-deploy, Cloud Run `/api/v1/principal/snapshot` calls per hour
fall and no `ensureAllDeskHydrated` storm follows a conflict (beacon from 1.2 once it exists).

**0.6 Migration drift — DONE 13 Oct 2026, nothing to apply.** The two `*_sync_meta` tables
defined in migrations but absent in production (`purchase_desk_sync_meta`,
`store_desk_sync_meta`) were dropped on purpose by `20260823220000_inventory_phase5_drop_legacy.sql`
(the store rebuild). 47 repo migration files have no same-named entry in `list_migrations`
because they were applied under other names; the objects they create were checked and all exist
(`fee_ledger_post_collection`, `inv_collect_on_sale`, `ledger_fiscal_years`,
`sis_student_transport_point`, `village_lead_coverage`, …). The `fleet_edge_events` index from
`20261011120000_db_cleanup_stage2.sql:42` exists; `seq_scan` was 71,072 at 13 Oct 00:26 IST —
re-check that it stops rising. A version-aligned comparison (repo file name ↔ applied name) is
worth automating in the trigger smoke step later.

### Phase 1 — The kernel (one executor; nothing user-visible yet)

**1.0 The local API stack for tests.** *(Built 13 Oct 2026 without Docker or the Supabase CLI.)*
The app only reaches the database through supabase-js over PostgREST
(`lib/supabase/server.ts`, `lib/serverTenant.ts`), so the stack is exactly that and nothing
more: `bash scripts/e2e-stack.sh up` starts a throwaway **Postgres 17** (Homebrew on a Mac,
the PostgreSQL apt package in CI; `PGBIN` overrides), applies the Supabase shim
(`scripts/supabase-shim.sql`, shared with `scripts/rehearse-migrations.sh`: roles
`anon`/`authenticated`/`service_role`(bypassrls)/`authenticator`, `auth.uid/role/jwt`,
`storage.buckets/objects/foldername`, Supabase's role statement timeouts, and deliberately
**no** default grants — production has none), then every migration in version order with
`ON_ERROR_STOP`, one transaction each: `supabase/migrations/*.sql` plus
`supabase/migrations/adhoc-export/*.sql` (378 files; the export's seven `*_zzz_*` files are
data-only edits of production rows and are skipped). Without the export the replay stops at
`20260910090000_wa_number_verdict`: it alters `wa_contact_state`, which only the ad-hoc export
creates. It then starts **PostgREST 16.4** (pinned; CI downloads the release tarball and checks
its sha256) with `db-schemas=public`, `db-anon-role=anon`, `db-max-rows=1000` and a JWT secret
generated per run, mints HS256 anon and service_role keys with `node:crypto`
(`scripts/e2e/mint-keys.mjs`), and puts `scripts/e2e/proxy.mjs` on `127.0.0.1:54321`: it strips
`/rest/v1` and passes headers through, refuses a request with no key (401, as Kong does), and
answers `/auth/v1`, `/storage/v1`, `/functions/v1`, `/realtime/v1`, `/graphql/v1` with **501**
and a JSON reason, so a test that needs them fails at once. It writes `apps/web/.env.e2e`
(git-ignored): the 127.0.0.1 URL, the minted keys, `APP_SESSION_SECRET=e2e-secret`, `E2E=1`,
`E2E_APP_URL`, `NEXT_PUBLIC_DEMO_AUTH=false`, `NEXT_PUBLIC_TENANT_SLUG=bhb-international` and
every `*_READ_FROM_DB` / `*_DUAL_WRITE_DB` flag in `deploy/desk-cutover-runtime.env`; then seeds.
Everything that reads that file goes through `scripts/e2e/with-env.mjs` (no dotenv-cli
dependency): the child process gets the file plus PATH/HOME/locale only, it refuses a URL that is
not `http://127.0.0.1:<port>` or names a hosted project, and it **refuses to run in a directory
holding `.env.local`** (Next.js would load it, and it is production) — so the stack runs from a
git worktree, never the shared checkout. Then `build` (`next build` with the e2e env —
`NEXT_PUBLIC_*` are baked in, so rebuild after every `up`), `app` (`next start` on
`127.0.0.1:3700`), `check`, `status`, `down` (stops everything, deletes the cluster and
`.env.e2e`).
Seed (`scripts/e2e-seed.ts` → `apps/web/e2e/seed.ts`, fixture in `apps/web/e2e/fixture.ts`, both
typechecked and linted with the app): refuses unless pointed at 127.0.0.1 and refuses a database
that already holds a school. The `tenants` row comes from migration
`20260711000000_phase0_foundation`. Writes go through the app's own server functions:
`pushMastersDeskToDb` (masters slices, `masters_desk_sync_meta`, row tables),
`pushStaffRemoteServer`, `pushDeskSliceToDb('rbac' | 'module_registry')` from
`defaultRbacState()` and the registry catalog defaults, `pushTimetableDeskToDb`, and
`pushSisToDb` (asserted to have used `sis_push_guarded`, not the legacy fallback); then it reads
every desk back through the app's readers and checks the counts. Fixture: 15 classes, 13
sections, 44 subjects, 127 class–subject links, 35 staff (34 active), 250 active children in
2026-27, 75 of them (30 %) with 2–4 per-year rows, 24 rows with a blank `academic_year_code`,
two different children under one admission number (different years — the unique index allows
nothing else), an all-inactive household, `0000000000` mobiles, an office member whose role is
a Masters → Roles assignment, and a teacher whose only tie to any section is the published
timetable — 401 student rows, 169 households. Logins: `apps/web/e2e/session.ts` mints
`bhb_demo_session` with `signSession()` for the fixture's office, class-teacher and
timetable-only-teacher `DemoSession`s, and refuses unless the process is on the e2e stack.
Acceptance (`bash scripts/e2e-stack.sh check`, `apps/web/e2e/acceptance.ts`): through the proxy
the service key reads the tenant and 15 classes, no key gets 401, the anon key reads no student,
Auth/Storage answer 501; `/api/app-version` 200; `/home` without a session redirects to `/login`
and with the office cookie renders 200; with the office cookie masters-desk returns 15
classes, staff-roster 35 staff, sis-roster 401 rows / 169 households; with the class teacher's
cookie sis-roster returns exactly her section's 51 rows and masters-desk the teaching subset.
**Found by the stack:** the timetable-only teacher gets **0** students — on the server
`loadTimetable()` is always empty and `ensureTimetableHydratedServer()` writes through a
browser-only no-op, so `staffSectionScope()` never sees a published grid. The check records it
as an expected failure (XFAIL) that turns red the day it is fixed (fixed and promoted to a plain
check by 1.7). CI: job `e2e-stack`
(`continue-on-error` until the director makes it required; later steps call it the `e2e` job)
runs `up`, `build`, `app`, `check`, `down` on `ubuntu-latest`, uses no secret, and stops before
checkout if a `*SERVICE_ROLE*` secret is visible to the workflow or such a variable is in its
environment.

**1.1 The gate that can see the symptoms.** Playwright in `apps/web/e2e/`, run by the `e2e`
job against the 1.0 stack. Until a spec is green it runs `continue-on-error` with a scoreboard
comment on the PR; the director flips each spec to required when it passes.
- `counts.spec.ts` — as office open `/staff`, `/students`, `/masters`, `/attendance`,
  `/timetable`, `/homework`; assert staff, students, classes, subjects **from the DOM** equal the
  seeded counts within 5 s; desktop and a 375 px viewport with CPU throttled 4× (CDP
  `Emulation.setCPUThrottlingRate`).
- `propagation.spec.ts` — parameterised `observeAt(path)` / `editVia('editor'|'api')`: context A
  adds subject "Computer" to Class 5; context B (open on `observeAt` since before the edit, no
  reload) shows it within 30 s; same for a staff record and a section rename.
- `teacher.spec.ts` — the teacher login sees exactly her sections' students on `/attendance` and
  `/students` (including the timetable-only teacher), never zero, never the whole school; with
  the masters read forced to fail (route intercept 503) she sees "retry", never an empty school.
- `budget.spec.ts` — per page: ≤ 8 `/api/*` requests on open and ≤ 300 KB **encoded** bytes
  (CDP `Network.loadingFinished.encodedDataLength`, `/api/*` only, `_next/static` excluded); no
  single response > 150 KB except `?export=1`.
- `error.spec.ts` — with masters-desk intercepted to 503 the page shows "could not load / retry",
  not empty pickers.
- `stale-writer.spec.ts` (from 1.5 on) — a context pinned to the previous build's POST shape
  (a whole-desk body from a pre-write copy) is refused and does not revert or remove the row the
  kernel wrote.
Acceptance: the job runs on this PR; `counts` passes on desktop; `propagation` and `budget`
**fail** on today's code (prove the gate sees the disease) and are recorded on the scoreboard.
> Executor brief: do not change the app to make specs pass; this step builds the instrument.

*(Built 13 Oct 2026, PR #591.)* **What exists.** `@playwright/test` 1.63.0 (exact pin, Chromium
only) in `apps/web`; `apps/web/playwright.config.ts` starts and seeds nothing (no `webServer`, no
`globalSetup`) and refuses to load unless `E2E_APP_URL` and `NEXT_PUBLIC_SUPABASE_URL` are
`http://127.0.0.1:<port>` and `E2E=1`, so it only runs through `scripts/e2e/with-env.mjs`:
`cd apps/web && node ../../scripts/e2e/with-env.mjs .env.e2e -- npx playwright test` after
`e2e-stack.sh up && build && app`. It needs a **freshly seeded** stack (the propagation project
writes; a second run needs `down && up`). Projects: `desktop` (1440 px; every spec but
propagation), `phone-375-cpu4x` (Pixel 7 profile at 375 px, CPU 4× via CDP
`Emulation.setCPUThrottlingRate`; counts only), `propagation` (desktop; depends on the other two,
so it runs last). One worker. Logins: the minted `bhb_demo_session` cookie (`e2e/session.ts`) for
the fixture's office, class teacher, timetable-only teacher, and — new — the Principal
(`fixture.sessions.principal`): the fixture's Office role may only *view* Masters (built-in rbac;
a save as office is refused "Missing permission masters.edit"), so propagation's context A edits as
the Principal. Helpers in `e2e/support.ts`; the one app change is `data-testid="metric-value"` on
the number of `ErpMetricCard` (`components/ui/erp-roster.tsx`), which every module dashboard card
uses; everything else is found by role, label or visible text. The fixture's class–subject links
now carry `isOptional:false` as every app-written link does (see the finding below).

**The scoreboard rule.** `e2e/scoreboard-reporter.ts` writes `apps/web/e2e/scoreboard.json` and the
CI job summary: each test is `pass`, `expected-fail` (marked `test.fail()` with its reason — a known
defect the gate sees), `fixme`, `UNEXPECTED-PASS` or `FAIL`, with the innermost `test.step` that
failed and the measurements (`metric:*` attachments). **Green = only pass / expected-fail /
fixme.** An expected failure that starts passing is an UNEXPECTED-PASS and turns the run red: the
step that fixed it removes its `test.fail()` in the same PR (that is the "flip to required"). An
expected failure must fail at the right step: propagation tests at "propagation" (after the
control, the edit and a database read-back have passed, and with `visibleAfterReload: true` —
the same locator finds the change once B reloads), counts at the count, teacher tests at the
scope check.

**The scoreboard on origin/main eb966b7f (with 1.7 merged; clean local runs + CI).** 14 pass,
29 expected-fail, 2 fixme, 0 fail:
- counts — pass: `/masters` (15 classes, 44 subjects), `/timetable` (15 classes; V's Subject
  rules "45 periods a week asked"), `/homework` (15 classes; 22 subjects in Compose HW), on
  desktop (1.1–2.6 s) and on the phone (2.6–5.2 s — on the phone the 5 s line is measured, not
  gated: it moved with machine load alone). Expected-fail: `/staff` shows **0** active staff
  (seeded 34) although the page's GET staff-roster returned all 35 (S1); `/students` **crashes**,
  React #185 "Maximum update depth exceeded" (a dev build points at ErpSidebar's route effect),
  whenever the roster holds students (S2); `/attendance` V-A's 2026-27 register shows **0** for
  30 s although sis-roster arrived ~1.3 s after navigation, or **21** (seeded 19: the two V-A
  rows with a blank academic year counted as this year's).
- teacher — the class teacher's register lists 27 for Nursery-A (seeded 20: the section's 7
  blank-year rows — 5 other children, 2 of hers twice); her `/students` crashes (#185); the
  timetable-only teacher's `/students` crashes too now that 1.7 gives her 61 rows (before 1.7 it
  showed 0). Pass: the class teacher's picker offers exactly Nursery; the timetable-only teacher's
  offers exactly III and V (an expected failure until 1.7 — CI caught the flip on the merge ref);
  with masters-desk 503 both see "could not load" + Try again.
- error — pass on `/masters`, `/attendance`, `/timetable`, `/homework`: CoreDataGate turns the 503
  into "Could not load the school's classes, subjects and staff from the server." + Try again
  (shown ~7 s after navigation), draws no picker, and Try again recovers without a reload.
- budget — all six pages expected-fail: 23–36 `/api` requests and ~1,100 KB per open; every
  screen boots the whole replica (sis-roster 893 KB alone — `next start` sends it uncompressed —
  staff-roster 136 KB, masters-desk 36 KB, rbac 26 KB, ~20 small reads).
- propagation — all 12 subject/section cases (3 observers × editor/api × 2 changes)
  expected-fail **at the propagation step** with the change stored and `visibleAfterReload:
  true`; the 2 staff cases cannot be observed yet (every staff screen lists no staff, the S1
  defect) — the control is recorded `controlShown:false` and the API edit is proven; the staff
  *editor* case is `fixme` (no staff row to drive).
- stale-writer — `fixme`, lands with 1.5.

**Found while building it.** A masters-desk POST whose `classSubjects` rows lack `isOptional` is
*accepted into the slice* and then fails the row sync (`500 "Masters saved, but the row tables
did not update: … is_optional … not-null"`); every later Masters save then fails the same way
until the slice is repaired. Non-atomic (slice written, rows not); for 1.5.

**Not done / not proven here.** The scoreboard is a CI job summary and artifact, not a PR comment
(the workflow has `contents: read` only). Root causes of the `/staff` 0, the #185 crash and the
register 0 are not established — the specs prove the symptoms and what the page received.
Timings are from a Mac shared with other sessions and from `ubuntu-latest`; production may
differ.

**1.2 Observability and the build handshake.** (a) The client knows its build id. Not as
`NEXT_PUBLIC_BUILD_ID` from `generateBuildId`: the commit sha reaches the service only at run
time, a hand deploy can ship different code under one sha, and a random id made in
`next.config.ts` must come out identical in every process `next build` starts or every tab
looks stale forever. Instead the page keeps the first answer of `/api/app-version` — the one
the update bar already fetches and compares (`lib/clientBuild.ts`, fed by `UpdateBar`); the
server compares against the same function that endpoint serves (`lib/serverBuild.server.ts`).
(b) `lib/data/erpFetch.ts`: the one fetch wrapper every new hook uses; it sends `X-Bhb-Build`,
times the call, and changes nothing else about the request. (c) **Recorded, not refused.** A
POST/PUT/PATCH/DELETE whose `X-Bhb-Build` differs from the server's build gets one log line
`jsonPayload.event = 'stale-build-write'` and the reply header `X-Bhb-Build-Stale: 1`, and is
otherwise handled exactly as before (`lib/staleBuild.server.ts`, `withBuildCheck`, on
`POST /api/data/<collection>` now and on each kernel write route as it is built). Why not 426:
a tab opened before a deploy holds whatever a person has typed into it; refusing every write
from it would throw that away for routes whose body shape has not changed at all. An old build
is refused **per route, only when that route's old body shape is retired**: from this step on,
every removed accept path keeps a 410 stub returning `{ok:false, reason:'build_stale',
reload:true}` for one release, and only then does `erpFetch` (or the stub's caller) reload the
page. Why a helper and not `middleware.ts`: the middleware runs on the edge runtime (it cannot
read `.next/BUILD_ID`), matches page prefixes only, and widening it to `/api/*` would put a
new hop in front of every webhook, upload and mobile call. (d) `POST /api/client-metrics`:
session cookie required (`sendBeacon` sends cookies; 401 otherwise), body ≤ 2 KB (413),
60 a minute per session in-process (429), fields validated (400), sampled 1-in-5 for timings
and 1-in-1 for `rendered-zero-rows` and `query-error`; one structured log line
`jsonPayload.event = 'client-metric'` with `{build, platform, persona, roleCode, route, metric,
key, ms, bytes, rows}` — persona and role from the session, never the body; no database
write. Producers now: `page-ready` per route and `desk-hydrate` per desk from AppShell
(`components/shell/useClientMetrics.ts`; `desk-hydrate` rides the existing
`bhb-desk-first-hydrated` event — when 2.3a deletes that event, re-emit it from the query
hooks). (e) `evidence/metrics-queries.md` (the filters) and `scripts/metrics-report.sh` (reads
logs only): p50/p95 of `page-ready` per route per build, the daily count of
`rendered-zero-rows` per screen, `desk-hydrate` p95 per desk. (f) The Flutter counterpart
(`platform:'flutter'`, route, ms, build `<flavor>-<versionCode>`) from `api_client.dart` for
the home-screen calls, reusing the app's existing `X-App-Flavor`/`X-App-Build` headers, so
Phase 4 can be measured. Acceptance: the self-tests `test:client-metrics-route`,
`test:client-metrics-sender`, `test:stale-build`, `test:erp-fetch` in CI; after deploy,
`bash scripts/metrics-report.sh 1` shows numbers from an office PC and a phone within an hour;
`stale-writer.spec.ts` can assert `X-Bhb-Build-Stale: 1` and the log line (and, from the first
410 stub on, the 410).

**1.3 Server read kernel.** *(Built 13 Oct 2026 — migration
`20261013120000_erp_versions.sql` must be applied to production before deploy.)*
- **`erp_versions(p_tenant uuid) returns jsonb`** (SECURITY DEFINER, `search_path public`,
  STABLE; execute revoked from public/anon/authenticated, granted to `service_role`). One round
  trip, `{<key>: {updated_at, count}}`: (1) every `*_sync_meta` table **present at call time**,
  looked up in `pg_catalog` on each call (a dropped table — `purchase_`/`store_desk_sync_meta`
  since 23 Aug — simply disappears; a new desk appears with no migration; a table missing a
  needed column is skipped), keyed by its name without `_desk_sync_meta`/`_sync_meta`
  (`masters`, `sis`, `fee`, `rbac`, …), count = one documented column per desk (`masters`
  class_count, `sis` student_count, desk-slice modules row_count, … — the mapping is in the SQL),
  `{null, null}` when the tenant has no row; (2) `sis_staff`, `sis_departments`,
  `sis_designations`, `masters_desk_settings`: `max(updated_at)` + `count(*)` (the count is what
  a delete moves); (3) `module_state:<module_key>` per `module_local_state` book (count 1 —
  counting items would de-TOAST every book per poll); (4) the 36 named `*_state` blobs (count
  0/1). On the seeded local stack: 75 keys, median 6–10 ms over PostgREST, ~3.5 ms in Postgres.
- **`lib/data/server/versions.ts`** `readErpVersions()`: one RPC per tenant per 2 s, shared by
  every caller and every cache in the process, in-flight deduped; a failure is `{ok:false}`
  (held for the same window, so an outage costs one call per window), never `{}`.
- **`GET /api/data/views/versions`** (`app/api/data/views/versions/route.ts`, handler
  `lib/data/server/versionsRoute.ts`): guard = `resolveApiAuth`, then **staff session or API key
  only** — a parent gets 403, because the answer carries school-wide counts and no parent screen
  uses it (director's review, 13 Oct 2026); 401 without a session, 503 when the guard's own
  reads fail;
  `{ok:true, versions, at}` with `Cache-Control: no-store`; 503 `{ok:false}` when the versions
  cannot be read.
- **`lib/data/server/referenceCache.ts`** `referenceCache(name, deskKeys, build)` →
  `{read(), invalidate()}`: rebuilt only when the versions of its `deskKeys` moved (the versions
  are read before the build starts); in-flight deduped; a failed rebuild returns the previous
  value with `stale:true` and retries on the next read; no previous value = `{ok:false}`; a
  build may offer a `fallback` (served stale, never stored); with the versions unreadable, at
  most one rebuild per versions snapshot (2 s); `invalidate()` drops the value and the held
  versions, and a build started before it is not stored. One log line per rebuild:
  `[reference-cache] <name> rebuilt (<why>)`.
- **`lib/api/v1/auth.ts`**: `loadServerMasters` = `referenceCache("masters", ["masters",
  "sis_staff", "sis_departments", "sis_designations"])`; `loadServerRbac` /
  `loadServerRbacIfKnown` = `referenceCache("rbac", ["rbac", "rbac_state"])`. The 30 s TTLs and
  the 5 s `rbac_desk_sync_meta` probe are gone. Kept from 0.5c: no `defaultMasters()`, previous
  copy on failure, 503 with no copy, roster unreadable with no copy = masters without a roster,
  not stored; a no-database local demo is not a failure. `invalidateServerMastersCache` (udise
  teacher-details apply, staff/roster/mobile) and `invalidateServerRbacCache` (desk-slice POST)
  force the next read to rebuild.
- Tests: `test:reference-cache` (every branch, fakes), `test:versions-route` (reader window,
  handler statuses, the real route through the real guard by API key), `test:server-masters-cache`
  (rewritten: a `masters_desk_sync_meta` bump = one rebuild, no change = no rebuild after 31 s and
  10 min, failures keep the copy, staff and rbac the same) — each shown to fail with its
  predicate reverted; the masters test fails on the old `auth.ts`. Local stack:
  `apps/web/e2e/versions.acceptance.ts`, run by `bash scripts/e2e-stack.sh check` after
  `acceptance.ts` (it reads the app log to count rebuilds): 35 desk keys, counts = seed, anon
  refused, median < 50 ms, one request per app read, the route 401/200/403 and not
  `[collection]`, a masters-desk POST moves `masters` and `loadServerMasters` rebuilds exactly
  once, no rebuild after 31 s unchanged.
- Not in this step: no browser code changed (1.4 polls the route). Writers that bump no
  sync_meta (R3) stay invisible to the signal until 1.5. After deploy, a Masters save reaches the
  mobile API's copy within one versions window (2 s) instead of up to 30 s.

**1.4 Client query kernel.** Add `@tanstack/react-query`; `QueryClientProvider` in `AppShell`.
Build on what exists: wrap `readPage` / `readAll` (`lib/data/client/query.ts`) in
`useErpQuery(key, path, {desk})`; `useErpMutation` = `useSaveMutation`
(`lib/data/client/useSaveMutation.ts`) plus invalidation of the desk's keys; `useVersionsPoll()`
(20 s + `visibilitychange→visible`; a moved desk value invalidates its keys). Reference views
live as static routes under `app/api/data/views/<name>/route.ts` (Next prefers static segments
over `[collection]`): `masters` (full-rights or the teaching subset by permission, same rule as
`masters-desk/route.ts:56-118` — a teacher must get classes/sections/subjects, no 403),
`staff-list` (redacted: id, name, code, designation, department, status, links), `rbac`,
`module-registry`. Hooks: `useMasters()`, `useStaffList()`, `useRbac()`, `useModuleRegistry()`;
`staleTime` 60 s, `refetchOnWindowFocus`, `retry` 2 with backoff, errors through one
`<QueryError>`. `components/staff/useMyTeaching.ts` is the shape to migrate **away** from
(module-level TTL + mount-only effect); convert it to `useErpQuery('my-teaching',
'/api/v1/staff/my-classes')` here. Acceptance: a dev-only `/__kernel` page (`notFound()` unless
`E2E=1`) lists classes via `useMasters()`; `propagation.spec.ts` with `observeAt('/__kernel'),
editVia('editor')` passes (the old Masters editor's `masters_write_slices` already bumps
`masters_desk_sync_meta`); the teacher login's `useMasters()` returns the teaching subset.

*(Built 14 Oct 2026, PR #645.)* **What exists.** `@tanstack/react-query` 5.104.0 (exact pin, published
26 Sep). `lib/data/client/hooks.tsx`: `ErpQueryProvider` (one client per tab, mounted in `AppShell`
around the signed-in shell), `useErpQuery(key, path, {desk, parse})` (reads through `readView`,
added to `lib/data/client/query.ts` beside `readPage`/`readAll`, through `erpFetch`; `readPage` is
left on plain `fetch` because the website editor already uses `readAll` and this step does not touch it), `useErpMutation(collection, {desk})` (`useSaveMutation` + invalidation of the desk's queries
after a confirmed write and after a conflict; no consumer yet), `useVersionsPoll` / the provider's
poller, and `useMasters()`, `useStaffList()`, `useRbac()`, `useModuleRegistry()`. The rules are pure
functions in `lib/data/client/queryKernel.ts`: staleTime 60 s, refetch on focus, retry 2 (1 s, 2 s)
only for no answer / 5xx / 408 / 429 — a 4xx is not retried; the poll's outcome (200 apply,
401/403 stop for the life of the page, quietly; 503 / no answer / malformed = keep, nothing
invalidated); which queries go stale. Each view answers `{ok, data, versions, stale}` where
`versions` is what the copy was **built from** (new `builtFrom` on `referenceCache` reads — null for a
previous/fallback copy), so a query is stale when any of its desks now differs from what it was built
from; that also closes the race between a view's read and the poll's first answer. Queries without
it (`/api/v1/...`) go stale when a desk moves between two answers. **When the poll runs:** only while a
mounted query reads a desk and the tab is visible (immediately, then every 20 s, and on
`visibilitychange→visible`, never twice within 5 s). Today that is `/__kernel` and the ~15 screens
that use `useMyTeaching`; every other page makes no new request. Parents and field sessions never
render `AppShell` (the `(erp)` layout redirects them), and the Flutter apps' web views open only
checkout/e-books/videos. Views: `app/api/data/views/{masters,staff-list,rbac,module-registry}/route.ts`,
handlers in `lib/data/server/views.ts` (deps injectable), real deps in `viewDeps.ts`, types in
`lib/data/viewTypes.ts`. `masters` uses the masters-desk rule, now **shared** as
`lib/mastersReadScope.server.ts` (`resolveMastersReadScope`; the masters-desk GET calls it too) and
`lib/mastersTeachingSubset.ts` (the key list moved out of the route): the Masters grant = the book
without staff/departments/designations, any other staff session = the teaching subset (`scope:
"teaching"`), never a 403. `staff-list` is built field by field from an allow list (id, empCode,
fullName, stream, status, department/designation id + name, the four link lists with their known
fields only — duty-link `notes` dropped) plus departments/designations; nothing from
`sis_staff.profile` other than those fields can reach it (tested with a profile `loginPassword`); a
Masters copy without the roster (`fallback`) = 503. `rbac` = the rbac desk's rule (Settings view: the
whole state; other staff: every role, own assignments/grants, no audit; a failed Settings check is
503, never own-only); `known:false` means no saved role set. `module-registry` = a new
`referenceCache("module_registry", ["module_registry"])` over the desk (booleans only). All four: 401
no session, 403 parent / inactive family / the mirror sync secret (no mirror read on this path), 503
`{ok:false}` with no copy, `Cache-Control: private, no-store`. Sources: `readServerMastersCopy` /
`readServerRbacCopy` (new exports of the 1.3 caches in `lib/api/v1/auth.ts`). `<QueryError>`
(`components/data/QueryError.tsx`) uses CoreDataGate's words and button. `useMyTeaching` is now
`useErpQuery('my-teaching', '/api/v1/staff/my-classes', {desk: sis_staff, timetable, masters})`
with the same return type; the module-level copy and `fetchMyTeaching` are gone. `/__kernel` =
`app/(erp)/%5F%5Fkernel/page.tsx` (a `_` folder is private in the App Router), `notFound()` unless
`process.env.E2E === "1"` at request time.

**Proof.** `test:query-kernel` (pure rules + the wiring on a real `QueryClient` + `readView` +
`parseMyTeaching`), `test:reference-views` (`resolveMastersReadScope`, the auth matrix of every view,
subsets, redaction, 503s, and the real route files through the real guards by API key on a fake
PostgREST), `test:reference-cache` (+`builtFrom`) — each new assertion shown to fail with its predicate
reverted (21 mutations: 20 red at once; the one that stayed green — a Settings-check 503 treated as
"no Settings" — got its own case, which is red under that mutation). Playwright (local stack, fresh seed): the four `/__kernel` propagation cases **pass** (editor and
api × subject and section; seen after 17.6–20.3 s over two full runs); rebuilt with the poll's invalidation removed, all
four fail at "propagation" with `visibleAfterReload: true`. `kernel.spec.ts`: 401/403 matrix, office full
vs teacher own-only rbac, staff-list keys = the allow list, no versions request on `/masters` in 25 s,
one at mount and one 20 s later on `/__kernel`, a 403 stops it (1 request in 23 s), a 503 keeps the
list, a failed view = "Could not load … Try again" after 3 reads (~4 s) and Try again recovers.
`teacher.spec.ts`: the class teacher's `/__kernel` reads `scope: teaching`, 15 classes, 13 sections,
44 subjects, 127 links, no fee heads/structure/grants, no roster. Scoreboard: origin/main ea9f5ba2
fresh run 16 pass / 27 expected-fail / 2 fixme; this branch 27 / 27 / 2, 0 FAIL, 0 UNEXPECTED-PASS — the
11 new passes are the new tests; every existing test kept its status. Budget: the three useMyTeaching
pages (`/students`, `/attendance`, `/homework`) now make one extra small `/api` request in the first 5 s
(the versions poll); others unchanged. Bundle: every `(erp)` page loads two more chunks (react-query
≈ 34 KB raw / 10.3 KB gzip; the kernel + erpFetch ≈ 9.4 KB / 3.9 KB); public and parent pages unchanged.

**When the poll runs (updated 20 Oct 2026, #681).** The header bell (`NotificationBell`) is an enabled
`useErpQuery` on desk `erp_notifications`, mounted on every staff page, so the versions poll now runs on
**every staff page** — on purpose: a notification must reach the bell within one poll on any page. It is
still ONE poll per tab (the single `VersionsPoller` in `ErpQueryProvider`; the bell and every other desk query
share it), at the 20 s cadence (≥ 5 s apart on a focus tick), and never for a family (the versions route is
staff-only; `/parent`'s bell re-asks its own list every 30 s). `kernel.spec.ts` and `teacher.spec.ts` assert
exactly this: ≥ 1 and ≤ 2 polls in 25 s on `/masters`, ≤ 3 in 22 s on `/__kernel` with the four views mounted,
every gap ≥ 15 s, 0 on `/parent`; the closed header WhatsApp panel still asks no Masters view and opening it
adds no versions request of its own.

**Not done / not proven here.** No real screen reads `useMasters()` etc. yet (2.1) — the 12
real-screen propagation cases stay expected-fail; the 2.1 bridge (`writeMastersLocalRaw` from
`useMasters()`) is not built; `useErpMutation` has no consumer (2.2/1.5); `useErpCollection` over
`readAll` is not built (first consumer 3.x). R6's "200 with zero rows while erp_versions says
non-zero = failure" is not implemented on the client. `useMyTeaching` differences: a 5xx/network
failure now retries twice (~3 s more "loading" before `my: null`); a failed *background* refetch keeps
the last good answer (before, a remount after 60 s with a failed read gave `null`); it refetches on
focus after 60 s and when the poll sees sis_staff/timetable/masters move (attendance cover changes —
coordinators/leave — do not trigger it; they reach it on focus/remount as before). Not measured in
production (needs deploy); timings are from a shared Mac.

**1.5 Write kernel (migration PR — director applies before merge).**
- `desk_write_guarded` v3: refuse `base = null` whenever the row exists (409 `unversioned`;
  `null` stays legal only for an insert of an absent id); add `sync_meta_table` to
  `desk_writable_tables` and bump `updated_at` + the count columns inside the same transaction
  for every applied op; deletes on `sis_students` / `sis_households` require an approval rule in
  `lib/data/registry.ts` or become soft deletes (`deleted_at`), never a cascading hard delete
  behind `students.edit` alone.
- `desk_slice_row_write(p_tenant, p_table, p_slice_key, p_op, p_id, p_row jsonb, p_base)`:
  allowlist = the 16 `*_desk_slices` tables; locks the slice row (`for update`, as
  `masters_write_slices` does); for masters the base is the slice's `updated_at` the client
  loaded, for `_rev` desks (transport, trust, the 13 desk-slice modules) the base is the element's
  `_rev` and the RPC increments it exactly as `lib/sliceRevMerge.ts` does; replaces / inserts /
  deletes **one element by id** (elements without an id are rejected — verify `classSubjects`,
  `holidays`, `feeStructureLines`, `concessionGrants` all carry ids before this ships); writes a
  new slice `updated_at`; bumps `<desk>_sync_meta`; for masters also runs
  `masters_sync_rows_from_slices` and the counts update (`lib/mastersNormalized.server.ts:177-187`).
- `desk_slice_object_write(p_tenant, p_table, p_slice_key, p_value jsonb, p_base)` for the object
  slices (`midYearFeePolicy`, `schoolProfile`, `schoolTiming`, `statutoryConfig` and the desk-slice
  modules' `objectSlices`).
- The route clears the probe/response cache for that desk after a write so the 5 s cache cannot
  serve the pre-write body. A `kind:'slice'` registry entry type routes `useErpMutation` to the
  RPCs. `repo.list()` gets a `teacherScoped` flag that applies `staffSectionScope` (1.7) as
  `section_id in (…)` / `household_id =` filters; until 1.7 lands, `GET /api/data/sis.*` answers
  403 for non-school-wide sessions (today it would page the whole roster to any
  `students.view` holder).
- Tests: `supabase/tests/desk_slice_row_write.test.sql` beside the existing SQL tests; local-stack
  unit tests: write without base → 409; delete of a student needs approval; a teacher cannot
  list `sis.students`; every applied op moves `erp_versions`. Acceptance: two Playwright
  contexts edit the same subject — the second gets the conflict toast and sees the first's value;
  `stale-writer.spec.ts` passes.

*(Built 14 Oct 2026 — migration `20261014220000_data_layer_write_kernel.sql`: **the director
applies it to production before this deploys**. Without it the new code fails closed: a kernel
write answers 503 "the server's write kernel is not installed", never an old path. **Apply it
immediately before the deploy, not hours ahead:** the live code's UDISE+ sheet caller sends no
base, so between the migration and the deploy every UDISE+ upload after the first is refused
("Saved in this browser only"). The reverse order is safe — this code against the old database:
the fixed caller's bases are accepted by v2, teacher reach and delete approval live in the route,
and only `masters.*` writes (no caller yet) answer 503.)*
Also in v3: a new id is locked against a concurrent insert, and an id that belongs to another
school is refused (42501) instead of being updated.
**What exists.**
- `desk_write_guarded` v3: a null base on a row that exists → `conflict`, `reason:'unversioned'`
  (with the stored row; 409 at the route); a base on an absent row → `reason:'deleted'` (an edit
  never re-creates a removed row); a soft-deleted row *exists* (reviving it needs its revision).
  **All or none** (v2 applied the rest of a batch and reported the refused). An op without an id,
  an unknown op or an id twice in a batch raises 22023 (v2 skipped it silently). Every batch that
  changes anything bumps the table's `sync_meta` (`updated_at` strictly later + its count column;
  `sis_students` also `active_student_count`) in the same transaction — `desk_writable_tables`
  gained `sync_meta_table` / `sync_count_column`; new `website_desk_sync_meta` and
  `udise_sheet_desk_sync_meta` (both appear in `erp_versions`, count `null` — not in its mapping).
  The 22 `masters_desk_*` row tables **left the allowlist**: they are derived
  (`masters_sync_rows_from_slices` rewrites them and deletes what the slice lacks on every save),
  so a direct write was silently undone; no code wrote them.
- `desk_slice_row_write(p_tenant, p_table, p_slice_key, p_op, p_id, p_row, p_base, p_key='id')`
  (SECURITY DEFINER, service_role only): the 16 tables (production list, 14 Oct); advisory lock +
  `for update`; base = slice `updated_at` for masters **and timetable** (neither carries `_rev`),
  element `_rev` for the other 14 (absent `_rev` = 0; new → 1, changed → +1, identical →
  unchanged, a client `_rev` ignored — as `mergeWithRevs` with a base); **patch** of one element by
  key (`p_key` = `code` for `staff_hr.leaveTypes`); an element without a key, a row whose key
  disagrees, an object slice, a staff-owned Masters list (`staff/departments/designations`) or the
  `students` projection is refused; new slice `updated_at` (strictly later); `<desk>_desk_sync_meta`
  bumped with the counts the TypeScript writers compute, `slice_count` included (Masters and
  Trust: slice rows that are not an empty list; the others: every slice row — matched against
  production's stored values, 14 Oct); for masters `masters_sync_rows_from_slices`
  in the same transaction (a row the tables refuse rolls the slice back). A `classSubjects`
  element without `isOptional` is written with `false` (non-boolean refused) — and the old path's
  `pushMastersSlicesToDb` / `pushMastersDeskToDb` apply the same default
  (`withClassLinkDefaults`), so the 1.1 finding cannot recur from the old editor either.
- `desk_slice_object_write(p_tenant, p_table, p_slice_key, p_value, p_base)`: a fixed list of 12
  object slices (Masters' four + `rbac.mobile`, `exam_papers.importMappings`,
  `wa_templates.lastMetaSyncAt`, `staff_hr.leaveSettings`, `module_registry.enabled`,
  `automation.lastTickAt`, `transport.feePolicy`, `timetable.config`); base = slice `updated_at`.
- Registry: `kind: 'rows' | 'slice' | 'object'` + `slice: {table, key, keyField, base}`; the 21
  `masters.*` list collections are now **slice** collections (read from `masters_desk_slices`,
  camelCase, with the slice stamp as `revision`), `masters.settings` is replaced by four object
  collections (`masters.school-profile` …). A slice collection takes **one op per request**.
  `POST /api/data/<collection>` routes rows → `desk_write_guarded`, slice/object → the RPCs (the
  client is unchanged: `writeRecords` / `useSaveMutation` send `{ops}`; `WriteOk.revision` /
  `ReadOk.revision` carry the slice stamp; conflicts carry `reason`). After a write that changed
  something the route drops that desk's probe cache (`clearDeskProbeCache`: `sis-roster`,
  `masters-desk-rows`) and the masters reference cache.
- Deletes of `sis.students` / `sis.households` need `students` **approve** on top of edit
  (`approval.onDelete`; office: 403; principal: allowed). No soft delete: `sis_students` has no
  `deleted_at`, and adding one would need every roster reader to filter it.
- Teacher reach: `teacherScope` on the registry; `GET /api/data/sis.students` for a session that
  is not school-wide and lacks `students.edit` returns only rows whose (class, section) is in
  `staffSectionScope` (in the `WHERE` as `section_id in (…)` + the pair check), `sis.households`
  only those students' households, `udise.*` and `?ids=` 403; unknown scope 503.
- `GET /api/data/<collection>?ids=a,b` (≤ 200, not for scoped sessions): current revisions,
  soft-deleted rows included — what a client needs to revive a row it put away.
- **Callers.** Every `desk_write_guarded` caller is `repo.write()` behind `POST /api/data/<c>`;
  its callers: the website desk (`WebsiteWorkspace`, `PageEditor`, `MediaLibrary`,
  `Publications`: new records with a null base and fresh ids, edits/deletes with the row's
  `updated_at` — unchanged under v3) and the UDISE+ working sheet (`lib/udiseUploadServer.ts`),
  which sent **no base at all** — the sheet row on every save, every re-uploaded child, every row
  "start a fresh sheet" put away: under v3 every save after the first would have been refused.
  Fixed here: it sends the revision it loaded or last wrote, reads back soft-deleted rows'
  revisions (`?ids=`) to revive them, and for a live row it never loaded (the robot wrote it) is
  refused rather than overwriting it. The UDISE robot (`udiseRobotSync.server.ts`) writes the two
  tables directly, not through the kernel (unchanged; it bumps no signal). No mobile or script
  caller.

**Proof.** `supabase/tests/desk_write_guarded.test.sql` (37 checks, rewritten for v3; it fails
on origin/main's v2 at "masters_desk_* not writable", and with the allowlist checks removed at
"an op without an id is refused", then "the insert bumped sis_sync_meta", then "null base on an
existing row → unversioned") and `desk_slice_row_write.test.sql` (51 checks — `slice_count` checks fail on the first version of `_desk_slice_meta_bump`, which never set it; the functions do not
exist on origin/main), both in CI. `e2e/write-kernel.acceptance.ts` (24 checks, run by
`e2e-stack.sh check`; on origin/main's app a null-base write **overwrote** the student's notes
and the run stopped at check 3). Before/after on the class teacher's
`GET /api/data/sis.students`: origin/main 400 of the 401 rows (the whole school) and `udise.rows` 200; now 51
(her section) and 403. `test:udise-upload-server` (fails on the old caller: the first re-upload is
refused `unversioned`). `test:approval-gate` (+ onDelete). Playwright: `write-conflict.spec.ts`
(two contexts, the second gets "someone else changed this" and shows the first's value; fails on
origin/main — the screen does not exist) and `stale-writer.spec.ts` (fixme → pass; on origin/main
the same script's "kernel" write lands in the derived row table and the old tab's section save
is then **accepted**, 200 — the revert the spec exists to catch). Scoreboard on a fresh stack:
**18 pass · 27 expected-fail · 1 fixme · 0 fail** (origin/main ea9f5ba2: 16 · 27 · 2 · 0); the
only differences are those two specs. Migration rehearsal on a fresh PG17: 371 applied, the same 2
known failures as origin/main (adhoc-only tables), this one applied. `scripts/verify.sh`: 515
passed (typecheck, lint, every self-test); its `next build` died of Node's default 4 GB heap
twice with a `.next` cache left by the e2e-env build — the same tree built clean from a cold cache
at the default heap (89 s; origin/main 92 s), warm, and at CI's 6144 MB.

**Not done / not proven.** No product screen writes through the kernel yet (the test screen
`/e2e/write-kernel`, 404 unless `E2E=1`, is the only client); Phase 2 converts screens. No
`kind:'slice'` registry entries for transport, trust, timetable or the desk-slice modules — the
RPCs accept their tables (SQL-tested for `staff_hr` and `module_registry`), the entries come with
each desk's conversion. Old whole-desk paths for `_rev` desks still accept an unversioned save
(server writers, old builds): a kernel element write moves `_rev`, but an old no-`revs` POST
still wins for its rows (`mergeWithRevs` without a base) — closing that is the per-desk 410 stub of
1.2. A kernel delete of a Masters class/section bypasses the old editor's whole-book guards
(`guardMastersOverwrite`, `guardSubjectsOverwrite`); it is one named element with the slice stamp,
but nothing checks references (students in that class). `masters_desk_settings` (and every
`masters_desk_*` row table) is keyed on `id` alone, so with two tenants the row sync would write
across them (one school in production; seen in the SQL test, not changed here). The UDISE robot
bumps no signal. Unknown-scope 503 on `/api/data/sis.*` is the 1.7 reader's (`readStaffScopeForDesk`)
and is not re-tested here. `useErpMutation` (1.4) is not built here.

**1.6 Ratchets.** `scripts/check-ratchets.sh` defines each metric in a `case` block and
`scripts/ratchets.txt` carries the budget — add both for: `loadMasters(` files in
`components/` + `app/(erp)/` (today 109), `loadSis(` (77), `ensure[A-Za-z]+Hydrated(` in
components (70), `readCache(` files in `src` (69), `readFileSync` inside `*.selftest.ts` (66),
`ensureSchoolMirrorHydrated` files under `app/api/v1` (100), and two **all-of-src** counts used as
the Phase 2.3b / 3.4 gates: `loadMasters(` occurrences (476) and `loadSis(` occurrences (426),
selftests and definitions excluded. Acceptance: CI fails when any count rises.
*(Built 14 Oct 2026, PR #642.)* Measured on origin/main `ea9f5ba2`, budgets set to the true
count: `load_masters_screen_files` 106 (12 Oct: 109), `load_sis_screen_files` 77 (77),
`ensure_hydrated_component_files` 69 (70), `read_cache_files` 68 (69), `selftest_readfilesync_files`
89 (66), `v1_school_mirror_files` 107 (100), `load_masters_calls_src` 471 (476),
`load_sis_calls_src` 426 (426). All but the last two are FILE counts; those two are OCCURRENCES.
Common rules (`dl_code_lines` in the script): `.ts`/`.tsx` only, comment lines ignored,
`*.selftest.ts` and the function's own definition line excluded, the name bounded so
`loadMastersSafe(`/`loadSisForStaff(`/`reloadMasters(` do not count while `mod.loadMasters(` does.
Wired through the existing CI step "Ratchets — retired patterns may not regrow" (`ci.yml`) and
`scripts/verify.sh`; adding one call of each pattern turned all eight red and exited 1.

**1.7 Teacher scope from SQL (own step; 3.1 and 4.2 depend on it).** *(Built 13 Oct 2026.)*
`staffSectionScope` (`lib/api/v1/staffScope.ts`) computes sections from `sis_staff.profile` links
**and the timetable as the database holds it**: `lib/api/v1/timetableScope.server.ts`
(`loadScopeTimetable`) reads the `publishedGrids` row of `timetable_desk_slices` — **published
only; an unpublished draft never grants access**, even when nothing is published (director's
decision, 13 Oct 2026: production's 13 draft grids would have given 8 teachers 3–6 extra sections
each). Publishing the timetable is the deliberate act that grants timetable access. Per-process
copy keyed on `timetable_desk_sync_meta.updated_at`: one select of that row per call, the slices
re-read only when it moved (in-flight deduped); slices older than the meta value (a versioned save
caught between its meta claim and its slice write) are served but not cached; a failed read keeps
the previous copy (`stale:true`, warning); with no copy it throws `ApiError` 503 — never "no
timetable". This small cache moves to `referenceCache` (1.3) when that lands. The dead
`ensureTimetableHydratedServer()` / `loadTimetable()` calls are gone from the scope path. A
school-wide session (leadership, or an owner/principal/admin/office role) does not depend on the
timetable — that is decided before it is read — so for it a failed read is logged and the scope
built without it; for everyone else the scope is unknown (503). The scope is cached per request
(a `WeakMap` on the request's `ApiAuthContext`; a failure is not kept). The school-data routes
that did `staffSectionScope(ctx).catch(() => null)` now call `readStaffScopeForDesk(ctx)`: `null`
only for a non-staff session (their old rule), a `503 {ok:false, scopeUnknown:true}` for an unknown
scope — before, a null fell through to **the whole school** in sis-roster and to an unrestricted
send in `wa/dispatch`, and to an empty list in attendance-registers. sis-roster computes no scope
for a `students.edit` holder (they get the whole roster anyway). The sis-roster teacher branch
answers `{ok:true, scoped:true, sections:[{classId, sectionId, className, sectionName}],
students:[…]}` plus all its old fields (`scopedToTeacher`, counts, `meta`). Proof:
`test:staff-scope-timetable` (fake PostgREST, the e2e fixture's school; 12 of its 13 checks fail on
the pre-1.7 code); the acceptance check's former XFAIL is a plain check: the timetable-only teacher
gets 61 rows, 0 outside her two sections, `sections` = exactly those two. Still to do in 1.1:
`teacher.spec.ts`. **Not fixed here (same defect, outside the scope path):** `v1/staff/timetable`,
`v1/staff/summary`, `v1/teaching/today`, `v1/teaching/log`, `v1/staff/online-classes` still
read `loadTimetable()` on the server after `ensureTimetableHydratedServer()`, so they see no
periods; they should read `loadScopeTimetable()` (or its successor) in a later step.

### Phase 2 — Reference data: removes S1, S3, S5 on the web

**2.1 Pickers read `useMasters()` / `useStaffList()`.** The 109 component files (generate the
exact list with `grep -rl 'loadMasters(' apps/web/src/components 'apps/web/src/app/(erp)'`,
selftests excluded) grouped by directory — convert in this order, one PR each:
2.1a `components/attendance` (4), `components/timetable` (1), `components/homework` (1),
`components/teaching` (2) · 2.1b `components/students` (15) · 2.1c `components/staff` (14) ·
2.1d `components/fees` (10) · 2.1e `components/payroll` (10) · 2.1f `components/shell` (6),
`components/dashboard` (2), `app/(erp)` (1) · 2.1g `components/admissions` (6),
`components/comms` (5), `components/parent` (4) · 2.1h `components/masters` (5),
`components/exams` (2), `components/reports` (2), `components/field` (2), `components/events` (2)
· 2.1i the 16 single-file directories. Mechanical rule per file: a `useState(loadMasters())` /
`useEffect(() => setMasters(loadMasters()))` pair becomes `const { data: masters } = useMasters()`;
render the hook's loading/error state; delete the mount-time read, any `bhb-masters-updated`
listener and any `ensureMastersHydrated` call. **Bridge for the 107 `lib/` readers that still
call `loadMasters()`** (fees maths, exams, payroll, counter concessions): in 1.4's `useMasters()`
`onSuccess`, replace the page memory copy with the server answer
(`writeMastersLocalRaw(bundle)` — a replace, server wins, no snapshot, no merge). The bridge is
deleted in 2.3b. Acceptance per batch: `propagation.spec.ts` and `counts.spec.ts` pass for every
screen in the batch; the `loadMasters(` file ratchet falls by the batch size.

*(2.1a built 15 Oct 2026, PR #651.)* **What exists.** The 8 files of the batch
(`components/attendance/{AttendanceWorkspace,AttendanceExceptionsPanel,StaffAttendancePanel,StudentAttendanceReportsPanel}`,
`components/timetable/TimetableWorkspace`, `components/homework/HomeworkWorkspace`,
`components/teaching/{TeachingWorkspace,SyllabusPlanPanel}`) no longer call `loadMasters()`: no mount-time
read, no re-read in `refresh()` (none had a `bhb-masters-updated` listener or an `ensureMastersHydrated`).
Seven read `useScreenMasters()` (`components/data/useScreenMasters.ts`): the `useMasters()` answer **plus the
staff side** (staff, departments, designations, the SIS projection `students`) from `useAccessData()`'s copy —
`screenMastersOf` in `lib/data/client/mastersBridge.ts`. The staff side is required, not decoration: every
permission helper resolves the signed-in person through `masters.staff` + `designations` (`lib/rbac`
`resolveStaffForRbac` / `inferRoleCodes`), and a person missing from the roster falls back to designation
guessing — so a screen given the book alone would change who may do what; no access copy = `null` (loading).
The staff side is kept by content (a JSON signature) so `useAccessData`'s per-event re-reads do not re-run a
screen's `masters` effects (the teacher's homework defaults). `SyllabusPlanPanel` reads subject names from
`useMasters()` directly. A failed masters view with no answer yet = `<QueryError>` instead of the screen
(Attendance and Timetable inside their workspace shell; no class picker drawn); a failed *background*
refetch keeps the last answer. Timetable: the never-edited timetable's weekdays-from-school-timing
(`ensureTimetableWeekdaysFromMasters`, a local write) now runs from an effect on Masters/timetable arrival
instead of inside every `refresh()`; after Subject rules saves periods/week through the old `saveMasters`
path, the screen refetches the view at once (otherwise the saved value would show at the next poll, ≤ 20 s).
**The bridge** (`acceptMastersAnswer` in `hooks.tsx`, rules in `mastersBridge.ts`): every masters answer is
checked (`parseMastersView` — not `{scope: full|teaching, masters: {classes[], sections[], subjects[]}}` = a
failed read, nothing written) and written into the tab's page copy in one synchronous load→write (no await:
the S1 snapshot race cannot occur) with `writeMastersLocalRaw` — no push, no sync scheduled, **no
`bhb-masters-updated`** (so none of the 10 listeners — SchoolFavicon, AppShell `alignFromMasters`,
useAccessData, SessionSelector, PrincipalCockpit, ModuleDashboardHost, Exams, RolesPermissions, Staff,
Payroll — runs because of it). It loads the **stored** copy (`readMastersPageCopyRaw`, new in `lib/masters.ts`),
not `loadMasters()`, whose read-time normalisation mints fee-head ids on every read and would be persisted.
Full answer: every key it carries replaces the copy's, except the page-owned `staff`, `departments`,
`designations` (not in the view — the staff hydrate's) and `students` (the client SIS projection;
replacing it with the server's slice would re-trigger the projection write behind the 13 Oct #185 loop).
**Teaching answer (a teacher):** only `TEACHING_MASTERS_KEYS` are written; every other key — fee heads,
groups, structure, concessions and grants, numbering, statutory — is left exactly as the copy holds it (for a
teacher that is the old hydrate's same teaching subset), so a withheld-and-sent-empty list never empties
the copy (the 13 Oct `ensureFeeSetupInner` lesson). The bridge's write still passes `writeMastersLocalRaw`'s
existing `protectLocalClasses` guard (frozen file): an answer with no classes, or a wholly new class-id
generation, against a copy holding classes keeps the copy's classes/sections/subjects (logged) — so "server
wins" holds for everything except that case. **Proof.** `test:masters-bridge` (in `verify.sh` and CI): a fake
tab (memory-only `bhb_masters_v5`), the real `loadMasters`/`writeMastersLocalRaw` and `acceptMastersAnswer` —
full answer reaches the copy, roster/designations/projection untouched; teaching answer updates
classes/sections/subjects and leaves every fee list and grant identical; no fetch, no event, one synchronous
write; 7 malformed shapes throw and change nothing; `screenMastersOf` needs the access copy. Each predicate
mutated (page-owned filter, teaching-keys-only, the shape check, the bridge call, the staff side, an event in
the write, `loadMasters()` as the load): every mutation turns it red. Playwright, fresh stack, scoreboard
compared test by test with origin/main `1c54aa42` run on the same machine: main 29 pass · 27 expected-fail ·
1 fixme · 0 fail; this branch **43 · 17 · 1 · 0**. The only differences: the 10 propagation cases on
`/attendance`, `/timetable`, `/homework` (subject and section × editor and api) went expected-fail →
UNEXPECTED-PASS on the first run with their `test.fail()` still in place, and pass after it was removed here
(seen after 17.4–20.0 s); and 4 new tests pass (`error.spec` views/masters 503 on the three pages,
`teacher.spec` the same on her `/attendance`: "could not load" + Try again, no Class picker, Try again
recovers). `counts.spec` for the three pages: unchanged from main (`/timetable`, `/homework` pass;
`/attendance` stays expected-fail at the V-A register — students, S2, 3.1 — while its class picker shows 15).
Teacher spec unchanged (picker = exactly her sections; the register's blank-year defect still 27).
Ratchets (1.6's script from PR #642, not merged): `load_masters_screen_files` 106 → **98** (−8, the batch),
`load_masters_calls_src` 471 → 463, `ensure_hydrated_component_files` 69 (unchanged).
**Not done / not proven.** The staff side of these screens is still the replica (the `/timetable` staff
propagation case stays expected-fail; 2.1c/2.3a). Saves on these screens still go through the old whole-book
paths — Subject rules' `saveMasters` now sends the composed screen state (the server's book + the access
copy's staff side) instead of `loadMasters()`'s; for a teacher holding only `masters.class_subjects` that state
is the teaching subset, which the function-only push accepts only for its own slice (`mastersChangeAuth`) —
not re-tested here; 2.2 replaces it. Screens now render the server's raw book rather than `loadMasters()`'s
read-time normalisation (fee heads / class roster top-ups, `ensureFoundationOnMasters` defaults); none of the
8 files reads fee data, but a value present only through normalisation would now be absent — not audited
field by field. Budget: each of the three pages fetches the masters view (+37 KB, +1 request) on top of the
old masters-desk hydrate until 2.3b. The new error/teacher specs were not executed against origin/main (on
main these pages never request the view, so `hits > 0` and "could not load" cannot hold — argued, not run).
Timings are from a Mac running several other sessions' builds (load average ~10); one full run in that state
failed 7 tests on time-outs and was discarded and re-run clean.

*(2.1b built 15 Oct 2026, PR #659.)* **What exists.** The 15 `components/students` files
(`StudentsWorkspace`, `StudentForm`, `StudentUpdatePanel`, `StudentUpgradePanel`, `StudentPromotionPanel`,
`StudentSiblingsPanel`, `StudentDuplicatesPanel`, `StudentTagsPanel`, `SisReportsPanel`, `BirthdaysPanel`,
`LegacyAdmissionVerifyPanel`, `UdiseComplianceWorkspace`, `StudentFeeDuesCard`, `StudentExamMarksCard`,
`StudentHomeworkCard`) no longer call `loadMasters()`; all read `useScreenMasters()` (none had a
`bhb-masters-updated` listener or `ensureMastersHydrated`). A masters read that never answered = `<QueryError>`
(the workspace inside its shell; panels in place; the three profile cards say "could not be read … not a zero /
not empty" in-card). `StudentForm` fills its fields once per (mode, student, year) from the first Masters answer
(a ref key) — a background refetch must not wipe typing; the "Auto-assign admission no." button uses the
hook's book instead of a fresh `loadMasters()`. The students roster is still `loadSis()` (Phase 3, untouched).
**Teacher (scope "teaching") — fee lists withheld, not none.** Audited every key the 15 files (and
`StudentProfileModal`, which takes the workspace's masters) read outside the teaching keys: `feeGroups`
(form, upgrade, register filter/labels), the fee structure behind `computeStudentDues` (dues card, profile
modal Fees tab), `numberSeries` (admission-number suggestions — empty list = `null`/"could not generate",
a refusal, safe). Now: the dues card and the modal's Fees tab say "Fee dues are not shown to your role" instead
of computing ₹0 / "No pending dues" from an empty structure (on origin/main the teacher was told "No pending
dues" — screenshot in the fail-on-old run); the form's fee group is a read-only "Not shown to your role" and
the auto-resolve effect does not run, so the child's stored `feeGroupId` is what a Save sends (on main it was
re-resolved to "" from the empty list); Upgrade does not offer or send "remap fee group"; the register hides
the fee-group filter and ignores a saved one. Receipts on the dues card come from the fees desk, not Masters —
left as they were. **Masters write-backs from these screens.** No path passes the hook's book to
`saveMasters`. Reachable whole-book writes all build from the page copy (`loadMasters()` inside lib), as on
main: `bumpStudentSeriesUses`→`persistSeriesUse` (StudentForm save, legacy-admission verify) and
`ensureStudentClassLinks` inside every `loadSis()`; both are on 2.2's list (`lib/numberSeries.ts`, `lib/sis.ts`).
**Proof.** New specs: `error.spec` office `/students?tab=register` for masters-desk 503 and views/masters 503
(no "Filter by class" drawn, Try again recovers 15 classes); `teacher.spec` her `/students` views/masters 503,
and "fees are withheld, not none" (her child's profile: the not-shown line, no "No pending dues", fee group
field "Not shown to your role"); `counts.spec` `/students?tab=register` class filter = 15 (desktop + phone).
Fail-on-old (specs on this branch, components reverted to origin/main, fresh build): the two views/masters
specs and the withheld spec FAIL; the counts and masters-desk specs pass on main too (coverage, not a fix).
On this branch locally (desktop + phone): counts 14/14 as expected (`/students` stays expected-fail at
274 vs 250 — blank-year rows, 3.1), error 9/9, teacher 11/11. No propagation case observes `/students`.
Seen: all 12 tabs + a child's profile page, desktop-light and 375-dark, office and teacher (UDISE+ as
principal — the seeded office and teacher get "Access restricted" there, by RBAC). Ratchets
`load_masters_screen_files` 98 → **83**, `load_masters_calls_src` 463 → **447**,
`ensure_hydrated_component_files` 69 (unchanged: the cards still hydrate sis/fees/exams/homework).
**Not done / not proven.** Saves still go through the old whole-desk paths (SIS saves; the series bump and
class-link write above) — 2.2/Phase 3. Screens now render the server's raw book, not `loadMasters()`'s
read-time normalisation — not audited field by field beyond the fee keys above. The teacher's "Couldn't load
fee records" toast on /students (fees desk 403) is pre-existing and untouched. Upgrade's "(no matching group
— keep current)" hint is wrong on main too (a null resolve sets the fee group to null) — not changed here.
CI scoreboard: see the PR.
*(2.1c built 15 Oct 2026, PR #660.)* **What exists.** `grep -rl 'loadMasters(' components/staff` lists 14
files; 10 no longer call it. **`useStaffList()`** (the 1.4 directory view — code, name, status, department,
designation, links; no phone/Aadhaar/salary) where a panel only shows or picks staff: `StaffAppraisalPanel`
(the Staff picker and labels) and `StaffGeoAdminPanel` (the "n of N consented" count — computed ONCE at mount from
the page copy before, so it could read "of 0" on a cold page; now "…" while unread and a retry link on failure).
**`useScreenMasters()`** (2.1a's hook: server book + the access copy's full roster) where the panel hands a whole
`MastersState` to lib helpers or resolves the signed-in person (by staffId/e-mail, which the directory does not
carry), or reads fields the directory lacks (`category`): `StaffLeavePanel`, `StaffLeaveRulesPanel`,
`StaffLeaveReportsPanel` (+ `StaffAttendanceReportsPanel` on /attendance), `StaffOutdoorDutyPanel`,
`StaffPayslipsPanel`, `StaffMyProfileDocs`, `StaffAgreementPanel` (+ self panel), `StaffBroadcastButton`. Each renders
`<QueryError>` when the read failed with no answer and "Loading…" while unknown — never an empty roster
(`StaffLeaveRulesPanel` drew its steps with `masters = null` before, i.e. "(0 staff)" per category while loading;
it now waits). No file had a `bhb-masters-updated` listener or `ensureMastersHydrated`. The header WhatsApp button
(`StaffBroadcastButton`, mounted on every page) asks only once opened: `useMasters({enabled})` /
`useScreenMasters({enabled})` are new, and the versions poll now runs only while an ENABLED observer reads a desk
(`hasDeskObservers` uses `query.isActive()`, and re-checks on `observerOptionsUpdated`) — otherwise a closed button
would have started the 20 s poll on every page. `StaffLeavePanel` opens leave balances (`ensureBalancesForAy` +
save) only for a known roster (before: `loadMasters().staff`, empty on a cold page) and again when the roster
changes. `StaffAppraisalPanel` waits for the staff-HR desk before `ensureAppraisalCycle` (which SAVES a new cycle):
with the roster no longer gating its render, the save raced the HR load and showed "Still loading staff HR … NOT
saved" on 4/4 then 1/3 opens (0/4 on main); after the fix 0/5. **Left on their full-record read, for 2.2** (they
edit staff records and save the whole book through `saveMasters`): `StaffWorkspace` (roster, Allocate teaching,
duty roster, its `bhb-masters-updated` listener) and `StaffProfileForm`. `StaffRequestsPanel` untouched (another
branch owns it). `TeacherAssignmentsPanel` only names `loadMasters()` in a comment (not counted by the ratchet).
**Proof** (local stack, this branch): `error.spec` — /staff Leave with views/masters 503 → "could not load" + Try
again, no leave tabs or Staff picker, Try again → the form with 34 staff + Select; /staff Appraisal with
views/staff-list 503 → "Could not load the staff list", no Staff picker, Try again → 35 options. `teacher.spec` —
on /my-pay the class teacher's page asks neither views/masters nor views/versions until she opens WhatsApp, then
asks the view and offers "My class parents". All three FAIL on 9433ee26 (built and run on the same stack: no
"could not load"; masters view never asked). `counts.spec` /staff passes desktop and phone-375-cpu4x (34 active);
teacher.spec otherwise unchanged. Staff propagation: both cases still expected-fail, now at the PROPAGATION step
with `controlShown:true` and `visibleAfterReload:true` on /staff?tab=roster and /timetable — staleness alone (the
roster on both is the page copy: /staff until 2.2, the access copy behind useScreenMasters until 2.3a); reason text
updated, editor case stays fixme. Ratchets (on origin/main e8e7163f, after 2.1b and #657): `load_masters_screen_files` 83 → **72**,
`load_masters_calls_src` 447 → **436** (10 of each from these files; the 11th from #657's StaffRequestsPanel,
not yet written down), `ensure_hydrated_component_files` 69 → **68** (bookkeeping: already 68 on main). Screens seen desktop-light and
phone-375-dark, office (principal fixture) and class teacher: roster, Leave, Leave rules, Reports, Outdoor duty,
Appraisal, Payslips, My docs, Agreements, GPS, profile edit, /attendance, /my-pay + WhatsApp — no page errors.
**Not done / not proven.** /staff roster propagation (2.2/2.3a). A teacher opening Staff → Leave sees "You do not
have permission" (the leave panel's balance save) — on main too (seen on 9433ee26), not fixed here. If the
staff-HR desk never loads, Appraisal stays on "Loading appraisal…" (before: drew the placeholder). Lib helpers now
get the server's raw book instead of `loadMasters()`'s normalised read (agreements read `schoolProfile` /
`numberSeries` — a holder of Staff→agreements without the Masters view gets the teaching subset, so the old
`AGR-nnnn` fallback numbering, exactly as the page copy gave them before); not audited field by field. The header
WhatsApp panel's class list now appears after one view read instead of synchronously.

*(2.1e built 15 Oct 2026, PR #663.)* **What exists.** The 10 `components/payroll` files that called
`loadMasters()` (`PayrollWorkspace`, `ApprovalsInboxPanel`, `JuneHoldPanel`, `IncrementPanel`, `AdvancesPanel`,
`PrintPayslipsPanel`, `BankFileExportPanel`, `StaffSelfService`, `StatutoryRemitPanel`, `PayrollReportsPanel`) read
`useScreenMasters()`; the mount-time reads, the `[tick]` re-reads, `IncrementPanel`'s `masters || loadMasters()`
fallbacks and `PayrollWorkspace`'s `bhb-masters-updated` listener are gone (none called `ensureMastersHydrated`).
**Payroll's staff side is the full record.** `useScreenMasters`' staff side is `useAccessData()`'s copy, which is
the page copy `loadMasters()` returned before (normalised roster included) — salary links, bank, PF/ESI fields are
all there, so no payroll read had to stay on `loadMasters()` for 2.2. The only non-staff keys these screens and
the lib functions they call read are `statutoryConfig` (run build/rebuild/setup preview, increments, statutory
penalties), `designations` and `schoolProfile` (letterheads) — now the server's answer. **No payroll save path
sends a Masters book:** runs, advances, increments, holds, remittances and salary setup write their own desks;
none of the 10 files or `lib/{payroll,staffAdvance,salaryIncrement,statutoryRemit,payrollReportCatalog}` calls
`saveMasters`. A failed Masters read that never answered = `<QueryError>` (the workspace inside its shell; panels in
place); while loading, a "Loading …" line instead of a screen computed from nothing. **Behaviour changes.**
(1) `PayrollWorkspace`'s tab-access effect no longer decides while Masters is unknown: on main it ran on the first
render with `allowed = false` and moved an office user off a `?tab=` deep link (the probe run: `/payroll?tab=runs`
on main never showed Runs) — now a deep link holds. (2) The payroll dashboard is given `refreshKey={tick}`: the host
never loads payroll itself and used to redraw only on a later `bhb-masters-updated`; once the workspace waits for
Masters that event can come first and the dashboard said "No records yet" with 5 runs on file (caught by the new
spec on this branch's first cut, fixed here). (3) Each screen shows "Loading …" until the masters view and the access
copy have both answered (one extra 37 KB request per payroll page until 2.3b). **Proof.** New
`e2e/specs/payroll.spec.ts` (project `payroll-writes`, runs last): seeds through the app's write paths a salary setup
(six links: every statutory cover, a basic override, an additional amount, a gross-up) and a NON-default statutory
setup (EPF 10 %, no wage ceiling, ESIC ceiling ₹25,000), puts both back afterwards; opens all 13 office tabs by
clicking, each run's detail with "Review salary setup" open (5 runs, Aug–Oct, month groups intact), desktop-light and
375-dark screenshots, the teacher's two self-service tabs; attaches every tab's text. Asserts: no "Could not load",
the dashboard shows the October run's ₹39,500, and E2E-001's rebuilt line reads `₹22,750 / ₹2,113 / ₹20,637 /
₹2,288` (ESIC ₹113 exists only under the school's ₹25,000 ceiling — a default or withheld statutory setup gives no
ESIC on ₹22,750). **Same numbers before/after:** the same spec on origin/main (probe PR #666, closed) vs this
branch, every tab's text diffed: identical on run detail ×5 (all setup-review rupees), bank file, increment
(individual preview for E2E-003), advances, approvals, statutory, print, payslips, reports, runs, My payslip/advances —
the only difference is the propagation spec's random rename suffix on E2E-020 (the dashboard, before its fix,
read 0 runs — fixed and then identical too). CI scoreboard, same spec: origin/main + spec 100 pass · 17 expected-fail ·
1 fixme · 0 fail; this branch the same, test for test. Bank-file rows and advance amounts were not exercised with
data (the fixture has no posted run and no advance) — those screens are identical but trivially so.
Ratchets: `load_masters_screen_files` 72 → **62**, `load_masters_calls_src` 436 → **424** (12 calls);
`ensure_hydrated_component_files` unchanged (the workspace still hydrates the payroll desks).
**Not done / not proven.** A payroll holder WITHOUT the Masters view gets the teaching answer, whose `statutoryConfig`
is the empty shell's (defaults) — runs, increments and penalties would then be computed from default rates, exactly
as the page copy gave them on main (same subset); production's statutory setup equals the defaults today (read-only
check 15 Oct), so no rupee differs now, but a school-specific rate would. Should become a refusal ("statutory setup
not shown to your role") in 2.2/2.3 — not changed here. Lib helpers now get the server's raw book instead of
`loadMasters()`'s normalised read; only the keys above were audited. Process / Rebuild / Apply setup were not clicked
in the spec (they write runs); they call the same builders with the same `masters` the setup review uses.

*(2.1f built 20 Oct 2026, PR #661.)* **What exists.** Of the 9 files (`components/shell` ×6,
`components/dashboard` ×2, `app/(erp)/staff/job-applications/page.tsx`), 7 no longer call `loadMasters()`.
**The shell is on every page, so it adds no request:** the always-mounted header pieces do NOT call `useMasters()`
(that would add the masters view and start the 20 s versions poll on every page). What they read is a permission or
"who may reach whom" answer, so they read the copies the sidebar and `ErpModuleGate` already decide with —
`useAccessData()` (`UserAccountMenu`: profile link, roles, "Open Roles"; `UniversalSearchBar`: which modules may be
offered, the staff roster) or `useStableAccessCopy()` (new, `components/shell/useStableAccessCopy.ts`: the same
copies with an identity that moves only when the roster/classes/sections/subjects/class-subject keys or rbac change —
for `ErpAiChatbot`, whose history effect, and `StaffInternalChatButton`, whose thread/alert effects, would otherwise
re-run on every desk event). Until those copies have loaded each shows "Loading…" (failed: "did not load" + Try again
in the menu) — never "No staff profile linked" / "No roles assigned yet" / designation guessing; they now follow a
roster or roles change without a reload (all four read once at mount before). **Left on `loadMasters()`, by design:**
`useAccessData.ts` (re-implemented only in 2.3a — its read IS the permission copy) and `SchoolFavicon.tsx` (rendered
before the workspace boots, outside the query provider; reading through `useAccessData` would start the rbac/staff
hydrate before boot, through `useMasters` would add a request per page; it reads one value, `schoolProfile`).
**Home:** `SchoolHomeDashboard` decides teacher home vs school dashboard and the expenses tile from the access copy
(waits for it: "Loading school dashboard…"; failed = "Couldn't check your access" + Try again, the module gate's
words; the principal's cockpit, decided from the session alone, is unchanged). The owner branch is a new `OwnerHome`
component that alone calls `useMasters()` for `statutoryConfig` (full answer only; a failed read says "Statutory dues
could not be checked" + Try again instead of showing none; tiles added to copies, never to the parent's model).
`TeacherHome` reads `useScreenMasters()` (classes, holidays, bell; `<QueryError>` on a failed read; "Loading your class
desk…" until both answers are in — a pending register is not "none pending"); `shouldShowTeacherHome(session,
masters|null)` takes the access copy. **Job applications** (server page) read `readServerMastersCopy()` (the 1.3
reference cache every API permission check uses) instead of `ensureSchoolMirrorHydrated()` + `loadMasters()`; no copy,
or Masters without the roster (`from: "fallback"`), = an on-screen "could not check your access", never a decision
against an empty roster. **Proof.** New `e2e/specs/shell.spec.ts`: office, principal, class teacher, timetable-only
teacher × desktop-light and 375-dark, 9 routes each (`/home /students /staff /masters /attendance /fees /payroll
/timetable /homework`), full page loads: no `pageerror`, no React #185 / "Maximum update depth", no console error from
the page's code; the browser's "Failed to load resource" 4xx lines are recorded per request in the `shell-sweep` metric
(any 5xx fails); screenshots of home per login/viewport, the focused search and the open account menu (desktop) are
attached. Its first CI cut failed on exactly those network lines (403s of teacher desk reads, a 404 on /fees — all
present on main's pages, none from this step's reads), which is why they are recorded instead. Loop mutation (a
`useLayoutEffect` in `UserAccountMenu` re-dispatching `bhb-masters-updated` on each access-copy change — the 13 Oct
shape) pushed through CI: every page spec froze (budget/counts/error/kernel at 2.1 m time-outs) and the job hit its time
limit before reaching `shell.spec` — so the mutation is proven to break the gate, but **`shell.spec` itself failing on
it is not proven by a run.** Budget (CI, office, requests / KB): see the PR body — the shell added no request.
Ratchets: `load_masters_screen_files` 61 → **54**, `load_masters_calls_src` 423 → **410** (13 calls).
**Not done / not proven.** The header still reads the page copy (the access copy) — 2.3a replaces it with
`useRbac()` + `useStaffList()`; staff chat also reads sections/classes from that copy (2.3a must keep them or move the
chat onto `useMasters({enabled: open})`). No owner login in the fixture: `OwnerHome` was not seen on a screen. The
home's new access wait was not timed on the throttled phone profile.
*(2.1g built 20 Oct 2026, PR #682.)* **What exists.** `grep` lists 6 `components/admissions`, 5 `components/comms`
and 3 `components/parent` files; 9 no longer call `loadMasters()`. `PublicEnquiryForm` / `PublicFamilyRegisterForm` only
name it in a comment (public pages; not counted). **The 3 parent files (`ParentSubjectsPortal`, `ParentPtmPortal`,
`ParentHomeworkPortal`) are left to #674** (open, CI green): a `/parent` page runs as a PARENT session, which the
masters view refuses (403) and which has no access copy, so `useScreenMasters` cannot serve it — #674 moves each tab to a
parent-scoped server route (`/api/v1/homework/feed`, `/api/v1/ptm/overview`, new `/api/parent-portal/subjects`), which
is the conversion; doing it here as well would collide with that PR. **`useScreenMasters()`** (book + access copy's staff
side — permission helpers resolve the signed-in person through it, or a `MastersState` is handed to lib):
`AdmissionsWorkspace` (its mount-time `useState(loadMasters())` and the effect's re-read gone), `AdmissionReportsPanel`,
`ReferralPolicyEditor`, `WaStudentPicker`, `WaChatHubPanel` (family/class labels were computed ONCE at mount with `[]`
deps — on a cold page "—" for every thread until a reload; now recomputed when Masters answers). **`useMasters()`**
(book only): `SisParentMatchBanner` (class names; "…" while unknown), `AppPopupsPanel` (class checkboxes),
`ClassChannelsPanel` (subjects — it called `loadMasters()` on every render). **`useMasters()` + `useStaffList()`**:
`WaSendToAudiencePanel` (classes from the view, departments from the directory; its `ensureMastersHydrated` is gone).
`app/field/layout.tsx` now mounts an `ErpQueryProvider` (the banner is also drawn on `/field/capture`, outside AppShell;
2.1h's field screens need it too). No file had a `bhb-masters-updated` listener. A failed read with no answer =
`<QueryError>` (workspace, reports, referral policy, student picker, WA class list, pop-up classes) or an in-place
"could not load / Try again" line (chat hub labels, department and subject pickers say so in their first option).
**Teaching subset (no Masters view — e.g. an admissions counsellor):** fee groups / heads / concessions are withheld,
not none. Sending a lead to Students (`doAdmitLead`, `doEnroll`, Registration's Send) is refused with "Fee groups are
not shown to your role" unless the lead already names its fee group (`withheldFeeGroupRefusal`) — on main it enrolled
the child with NO fee group (resolved from the empty list), i.e. no dues; the profile modal opened from Admissions gets
`feesWithheld` and the fee group label "Not shown to your role"; the referral policy shows "Not shown to your role" for
the fee head and disables "Award reward" (which writes a concession through the page copy). After an award, the
editor refetches the view at once. **Proof.** New `e2e/specs/admissions-comms.spec.ts` (desktop project): 10 screens
seen as office, desktop-light and 375-dark, no page error, each class list = 15 (Admissions Report "Class sought",
WhatsApp Send → Parents buttons, Pick students class filter, pop-up "Some classes" checkboxes), WhatsApp Staff →
departments listed; views/masters 503 → /admissions?tab=reports and WhatsApp Send say "could not load" + Try again, no
tabs / class buttons, Try again restores 15. Fail-on-old (same spec, components reverted to origin/main 6e67c786, fresh
build, same stack): both 503 cases FAIL (no "could not load"; the lists drawn from the page copy); the 10 seen cases pass
on main too (coverage). This branch: admissions-comms + counts + error + teacher, all projects: 49 passed, 0 failed.
No propagation case observes these screens. Ratchets: `load_masters_screen_files` 61 → **52**, `load_masters_calls_src`
423 → **412**, `ensure_hydrated_component_files` 68 (unchanged: WaSendToAudiencePanel still hydrates WA templates;
the workspace still hydrates admissions/SIS). **Not done / not proven.** The teaching-subset refusals were not run end to
end (no fixture lead in "verified" stage and no fixture counsellor without the Masters view) — typechecked and read, not
executed. Saves still go through the old paths (admissions desk; the referral award's concession and `enrollLead`'s
RTE tag writes through `saveMasters` — 2.2's `lib/referralRewards.ts`, `lib/rteEws.ts`). The SIS roster these screens
read is still `loadSis()` (Phase 3). Screens now render the server's raw book, not `loadMasters()`'s normalisation —
audited only for the keys above (classes, sections, subjects, campuses, academic years, fee groups/heads, concessions).
*(2.1h built 20 Oct 2026, PR #686.)* **What exists.** The 13 files of the batch no longer call `loadMasters()`.
**`useScreenMasters()`** (server book + the access copy's staff side) where a screen resolves the signed-in person or
needs the full roster: `MastersWorkspace`, `RolesPermissionsPanel`, `SalarySetupPanel`, `ExamsWorkspace` (its
`RemarksPanel` now takes the workspace's `masters` as a prop), `ReportsCenterWorkspace`, `EventsWorkspace`, and the
Transport / Homework / Library runners in `ModuleReportRunners`. **`useMasters()`** where only classes/sections/fee
heads are read: `InterSchoolPanel`, the Exam and Teaching runners, `StaffLeadCaptureApp`, `StaffRegistrationCollectApp`
(the `/field` layout's `ErpQueryProvider` came with #682). **`useStaffList()`**:
`StaffAttendanceSettingsPanel`, `StaffAttendanceRulesPanel`. Gone: the mount-time reads, `MastersWorkspace`'s and
`ExamsWorkspace`'s `ensureMastersHydrated`, the `bhb-masters-updated` listeners in `ExamsWorkspace` and
`RolesPermissionsPanel`. **Masters editor:** reads `normalizeMastersRead(useScreenMasters())` (new in `lib/masters.ts`
— `loadMasters()`'s read-time normalisation applied to a book in hand, pure, no write) so panels and the unchanged
whole-book `saveMasters` see the same shape as before; a commit's state is shown (`pending`) until the save answers,
then the view is refetched at once and the server's answer replaces it (a failed save keeps the edit on screen beside
the push's error toast, as on main). Every screen: a masters read that never answered = `<QueryError>` + Try again;
"Loading …" while unknown, never an empty list. `RemarksPanel` reads `masters` through a ref at rebuild time — a
poll answer does not wipe typed remarks. `StaffRegistrationCollectApp` refuses to record a fee or build a UPI link
before Masters answers (main used the built-in fallback UPI id and a blank fee head on a cold page); for the teaching
scope its fee-head picker says "fee heads not shown to your role". `SalarySetupPanel` refuses for the teaching scope
(statutory rates withheld). `ReportsCenterWorkspace` decides module access only once Masters is known (main could deny
every module on a cold page). **Proof.** New `e2e/specs/masters-exams-reports.spec.ts` (desktop project, read-only):
16 screens seen desktop-light + 375-dark (office; principal for Roles and Exams; the class teacher for Exams and
Reports) with 15 classes / 34 active staff where a list is drawn, no page errors; 5 failure cases (views/masters 503 on
/exams, /reports, /events, /masters Salary; views/staff-list 503 on Attendance rules) show "could not load" + Try again
and recover. `error.spec` now includes /masters for views/masters 503; `propagation.spec` `/masters?tab=subjects` is a
kernel observer (must pass). **Fail-on-old** (specs on this branch, `apps/web/src` reverted to origin/main, fresh
build, same stack): all 5 failure cases FAIL, `/field/capture` and `/field/register` FAIL (class picker 0 of 15 — the
cold `/field` page had no Masters), `error.spec` /masters views/masters FAILS, both `/masters` propagation cases FAIL
at the propagation step. On this branch, fresh stack: masters-exams-reports + error + counts + budget + teacher on
desktop and phone-375 **65/65 pass**; the two `/masters` propagation cases pass. Ratchets (after 2.1f and 2.1g merged) `load_masters_screen_files`
45 → **32**, `load_masters_calls_src` 399 → **375**, `ensure_hydrated_component_files` 67 (unchanged: Masters and Exams
still hydrate staff/rbac/sis/exams). **Not done / not proven.** Saves still go through the old paths (2.2). Lib helpers
receive the server's raw book (normalised only in the Masters editor) — not audited field by field beyond the keys
above. The teaching-scope refusals (salary setup, field fee heads) were typechecked and read, not run (no fixture
holder of those screens without the Masters view). Pre-existing and untouched (seen on main too): `/exams` refresh
writes fee holds on every open (`setReportCardHoldFromStage`) — the teacher gets "You do not have permission", and on a
fresh stack the office can get "fee holds: changed on another device" (also seen on `/attendance`); the teacher's
"Couldn't load fee records" toast on `/reports`.
*(2.1h review fixes, 21 Oct 2026, PR #686.)* **The Masters editor's overlay.** On the first cut a commit's state was
shown until the first answer after its save — but that answer can predate the save (another instance's masters cache
re-checks erp_versions at most every 2 s; a failed refetch keeps the old answer), so the screen reverted, the bridge put
the old book in the page copy, and the next commit in another panel sent the old value of the first edit's section
back: **edit A reverted on the server** (reproduced end to end, below). Now (`components/masters/mastersPending.ts`,
pure): the overlay stays until an answer **provably** holds every save of it — built from the save's desk revision
or later (`builtFrom.masters.updated_at` ≥ the `masters_desk_sync_meta.updated_at` the save wrote; `saveMasters` now
answers it as `revision`, `useScreenMasters` exposes `builtFrom` via `useMastersBuiltFrom`), or reading every changed
key back as sent (a save with no revision: function-only, no database). No proof while a commit is saving. Unproven
answers are not shown; the editor re-asks every 2.5 s (4 times), then the versions poll. A **failed** save drops the
overlay once nothing else is saving, says "Not saved — showing the school's saved Masters again." and refetches (main
and the first cut left the refused edit on screen, to be re-sent by the next commit). `onMastersChanged` (subject
requests) only refetches — it no longer clears the overlay, mid-save or otherwise. `POST /api/school-data/masters-desk`
calls `invalidateServerMastersCache()` after any write that may have landed (not after a 409). **Deterministic
normalisation:** `normalizeMastersRead` filled gaps with `Math.random` ids (classes of the standard list, fee groups of
the 2026-27 structures, seed departments/designations) — a new id set on every answer; it now runs with `Math.random`
seeded from the book's own fingerprint for that synchronous call (same book → same ids; restored in `finally`).
**Loading:** Exams' Date-sheet / Seating / Invigilation / Admit cards / Question papers tabs and the Exam and Teaching
report runners say "Loading…" (the runners `<QueryError>` on a failed read) while Masters is unknown, not an empty tab
or an "All classes"-only picker. **Salary setup** for the teaching scope: an explicit refusal naming the grant
(*Masters · View*, Masters → Roles & permissions) — kept as a refusal, a behaviour change from main, which silently
worked salaries out on default EPF/ESIC rates. **Proof.** New self-test `test:masters-pending` (CI + verify.sh; 7
checks on the e2e fixture's book: stale answer keeps A and the real `mastersSectionSave` does not resend A's section;
Postgres-spelt revision; failed save; mid-save; proof by value; same book twice = same ids). Fail-on-old by mutation:
the branch's old drop-on-first-answer rule fails check 1, the old keep-on-failure rule fails check 3, the unseeded
normalisation fails check 7. New `e2e/specs/masters-overlay.spec.ts` ("propagation" project — it writes, then puts
the campus and section back): principal inactivates Main Campus, every views/masters answer from then on is the
pre-save body; the screen keeps "Inactive", class IV's section is renamed in another panel, and the server must hold
both; then the refused-save case (409). `masters-exams-reports.spec` adds 6 cases (Date-sheet, Seating, Result
reports × desktop-light / 375-dark) holding views/masters: "Loading…" shown, then the tab. **Fail-on-old** (specs on
this branch, `apps/web/src` at the pre-fix head 561aca62, fresh build, same stack): the stale case FAILS on screen
(back to "Active") and — with that check made soft — **on the server: Main Campus active again after B's save** (edit
A reverted); the refused-save case FAILS (no "Not saved", the edit stays); all 6 Loading cases FAIL (nothing drawn).
This branch: masters-overlay 2/2, the 6 Loading cases, masters-exams-reports + error 33/33 (desktop), /masters
propagation 2/2. **Not proven:** the multi-instance staleness itself (the spec fakes the stale answer at the network,
one local instance); a revision compared across server clocks (two instances with skewed clocks could leave an
overlay unproven until the next save/poll answer reads it back by value); the Teaching runner's "Loading…" is
unreachable on screen (Reports Center waits for Masters first) — typechecked and read only; the salary refusal still
not run (no fixture holder without the Masters view). `normalizeMastersRead`'s determinism is per book: a book that
changed elsewhere re-mints its fillers (ids no earlier answer had, never an earlier filler's id reused).

*(2.1i built 20 Oct 2026, PR #688.)* **What exists.** The list, generated on origin/main ab545386 with
`grep -rl 'loadMasters(' apps/web/src/components 'apps/web/src/app/(erp)'` minus 2.1a–2.1h's directories and the files
kept by design (`useAccessData.ts`, `SchoolFavicon.tsx`), is **15 files in 15 directories** (the plan's "16" was counted on
2f0eb3d4, which also had `timetable`, `homework` — 2.1a — and `app/(erp)/staff/job-applications` — 2.1f): `accounts/LedgerEntryPanels`,
`certificates/CertificatesWorkspace`, `complaints/ComplaintsWorkspace`, `discipline/DisciplineWorkspace`,
`documents/DocumentMakerWorkspace`, `health/HealthWorkspace`, `idCards/IdCardsWorkspace`, `inventory/InventoryWorkspace`,
`library/LibraryWorkspace`, `login/LoginPanel`, `ptm/PtmWorkspace`, `rte/RteWorkspace`, `studentLeave/StudentLeaveWorkspace`,
`transport/TransportWorkspace`, `visitors/VisitorsWorkspace`. **13 converted** to `useScreenMasters()` (every one resolves the
signed-in person for a permission check or lists staff — assignees, drivers, borrowers, class teacher, principal, gate duty —
so the access copy's roster is needed; `LedgerEntryPanels` reads only holidays/years but `isPublishedHoliday` takes a whole
`MastersState`) or `useMasters()` (`InventoryWorkspace`: class/section labels only). Removed: every mount-time and `refresh()`
read, `masters ?? loadMasters()` fallbacks, and every `ensureMastersHydrated` (in 11 files; the SIS / staff / own-desk hydrates
stay). No file had a `bhb-masters-updated` listener. A masters read that never answered = `<QueryError>` (inside the workspace
shell where the screen has one; PTM and Student leave in place of their existing "Loading…" block; Transport and Inventory
under their tabs; the Accounts quick expense inline in the "daily rate" line); while unknown, "Loading…" — never a screen drawn
from nothing. **Left on `loadMasters()` by design:** `RteWorkspace` — it writes Masters (`setRteHeadWaiver` /
`removeRteFromStudent` save concessions and grants through `saveMasters` from the page copy) and draws the very grants it
just wrote; moving its read to the view would show the old grants until the next poll, so it moves with its write path in 2.2.
`LoginPanel` — runs before there is a session (the demo / page-copy staff-password match), so there is no masters view to
read. **Masters writes left as they were (2.2):** `issueCertificate` → `persistSeriesUse` (certificate numbering) builds its
book from the page copy inside `lib/certificates.ts`, as on main. **Behaviour changes.** (1) Accounts → Quick expense →
"Bill a daily rate over a range": the billable days wait for the holiday calendar ("Loading the school's holiday calendar…" /
"Could not load … Try again"); on main an unread calendar meant no holidays and every shut day ticked. Save is disabled until
the calendar is known. (2) Complaints: tickets are not editable until the roster is known (on main "until masters load, the
session decides alone" — writable). (3) Library: the staff roster (borrowers, overdue "With") is now read on open; on main it was
read only inside `refresh()`, i.e. never on a page whose library desk did not change. (4) Each converted screen waits for one
masters-view read (+1 request, ~37 KB until 2.3b) and shows "Loading …" for it; Discipline, Health, ID cards, Library,
Visitors, Documents draw nothing but the shell until then. **Proof.** New `e2e/specs/single-dirs.spec.ts` (desktop project; it
switches the default-off Discipline module on through `/modules` for the file and off again): 14 screens (the 13 files; Transport
twice — dashboard and By class) seen desktop-light and 375-dark, no page error, class lists = 15 / sections = 13 where drawn;
and each with `views/masters` 503 → "could not load" + Try again, the masters-dependent part absent, Try again recovers. Local:
28/28. Fail-on-old (spec on this branch, the 13 components put back to ab545386, fresh build, same stack): **13 FAIL** (no "could
not load" — main never asks the view); the student-leave case passes on main too (its page is the Attendance workspace, whose
2.1a gate already shows the error first — so Student leave's own error state is not proven by this spec); the 14 "seen" cases
pass on main (coverage, not a fix). Ratchets (on origin/main after #661): `load_masters_screen_files` 54 → **41**,
`load_masters_calls_src` 410 → **385**, `ensure_hydrated_component_files` 67 → **65**. **Not done / not proven.** RTE and Login
(above). Screens now hand lib helpers the server's raw book rather than `loadMasters()`'s normalised read — not audited field by
field. Transport's change dialogs compute paid months with `computeStudentDues(student, masters, …)`: for a holder without the
Masters grant (teaching answer) the fee structure is withheld, so no month reads as paid — exactly what the page copy gave the
same person on main; should become a refusal in 2.2/2.3. On the ID-cards desktop shot the student list read "0 of 0" for the
first moments (the SIS hydrate, Phase 3 — pre-existing S2), 274 once it landed. Saves on these screens are unchanged (their own
desks). Teacher sessions were not exercised on these screens. CI scoreboard: see the PR. **Review fixes (21 Oct 2026, same PR).**
(1) *Money — Transport.* The hook's `scope` is now read: when the masters answer is not `"full"` (teaching subset — no
Masters grant, e.g. a transport in-charge) the screen passes `dues: null` to `TransportAmendDialog` and
`planTransportAmendment` refuses with `PAID_MONTHS_UNKNOWN_FOR_ROLE` ("Paid months cannot be checked for your role … Ask the
office"), Apply stays off, any "Apply from" month included. The Riders form's carry-over note says "Paid months are not shown
for your role" instead of nothing; search hits and their PDF/Excel export say "dues: not shown for your role" instead of
"open dues ₹0". Measured on the fixture's paid-month case: on the old code the teaching answer still showed "Applies from Oct
2026 · 6 paid months" — plain transport receipts are matched without the fee book — so the live risk is narrower than "no
month reads paid": a month settled with a TRANSPORT-head concession (fee heads and concession grants are withheld) reads
unpaid and the floor falls onto it. Refused either way. New selftest `test:screen-masters-dues`
(`lib/screenMastersDues.selftest.ts`, CI + verify.sh): dues of all 250 fixture children and the paid-month case's paid months
and amendment plan are **identical** from the raw server book and from `ensureFeeSetup` (loadMasters' normalisation:
`ensureAprToMarInstallments` …), and again on a production-shaped fee book (12 dated installments, TUITION/TRANSPORT heads, a
published group per class) — production holds 12 installments per year with no null `due_on` (read-only count, 21 Oct) — so no
normalisation is added; the same check with one blank `dueOn` does differ (the test can see it). (2) *Certificates* search hits
(and their export): "dues: not shown for your role" for a teaching answer. (3) *Documents* "Insert school facts": the fee
line reads "Fee: not available for your role …", never "0 fee structures published" (`buildComplianceFactsFromMasters`
`feesWithheld`). (4) `LedgerEntryPanels` asks views/masters only once the daily-rate spread is ticked
(`useScreenMasters({enabled: spread})`); Inventory only on Counter / Kits (a `?tab=` deep link to another tab may still fire
one read on the first render). (5) Certificates: the TC form's "Checked by" designation is filled by its own effect keyed on
`[student, masters]` (once per student, ref-guarded so a refetch never re-fills a field the clerk changed); the per-student
reset stays on `[student?.id]`. (6) *Availability.* Visitors and Health no longer wait for the masters view: tabs and edit
rights come from the access copy (`useAccessData` — the same roster + roles the book's staff side is), records, forms and
actions render; only class/section (and gate-duty staff) names show "…", and a failed read is an in-place `QueryError
compact` strip with Try again. Library stays gated. (7) Spec: `setDiscipline` reads the module's state from the Modules screen
first and restores THAT in `afterAll` (idempotent; reading the cached registry view before the write had primed it with the old
answer). **Fail-on-old** (new tests, source put back to 8a22525e, fresh build): selftest 2 FAIL (null dues → TypeError;
"0 fee structures"); single-dirs 6 FAIL (Health/Visitors usable ×4, certificates hit "open dues ₹0", documents fee line) + the
ledger lazy read (1 read at mount); transport-paid-month: teaching amend dialog showed "Applies from Oct 2026", riders hit
"open dues ₹0" (her October ₹500 transport is owing). The old spec left Discipline OFF after a run that found it ON (proved
on the stack). Local on the fix: single-dirs 34/34, transport-paid-month 8/8. Not proven: a real transport in-charge login
(teaching scope is simulated by cutting the real answer with the server's `teachingMastersSubset`); Certificates' step-3 "Open
dues" and the TC/no-dues gate still read the page copy inside `lib/certificates.ts` (2.2) — for a non-Masters holder that is
the teaching subset too, unchanged by this PR.

**Certificates TC / no-dues gate (2.1i follow-up, money).** *(Built 21 Oct 2026, PR #701.)* The gate no longer decides
from the page copy. `GET /api/data/views/certificate-dues?studentId=…` (Certificates create, its "Issue & register"
function, or Fees view; mirror secret refused; 403 / 404 / 503, never ₹0) counts one child's open dues on the server from
the inputs every server dues figure uses (school mirror + transport + fee adjustments — `lib/certificateDues.server.ts`,
`openBalanceFrom` shared with the screen). `certificateEligibility(student, kind, {server, bookIsFull})` /
`issueCertificate({…, dues})`: a TC or fee clearance with no server answer (checking / role / failed) is REFUSED ("Fee dues
could not be checked for your role — ask the office"); with a full Masters book the larger of the screen's figure and the
server's decides (never looser than before for the office); dues for other kinds are `null` when unknown, recorded as not
cleared. Issue & print re-asks with `fresh=1` (forced mirror + inputs re-read) for TC / fee clearance. Step 5 shows "Open
dues: not shown for your role" / "could not load · Try again" instead of ₹0. Proof: `test:certificate-dues-gate` (in CI and
verify; 13 FAIL on old) and `e2e/specs/certificates-dues-gate.spec.ts` (own project `cert-gate`, runs after every writer —
seeding a tuition structure switches on the built-in 2026-27 structures for every class; a fixture "Certificates clerk"
role: Students + Certificates, no Masters/Fees/Transport): 10/10 on the fix, 5 FAIL on old (₹0 shown, Issue enabled; old
code issued the fee clearance at issue time).

**2.2 Masters and staff editing write rows.** `MastersWorkspace` and its panels write through
`useErpMutation` → `desk_slice_row_write` / `desk_slice_object_write` (one subject, one
class-subject link, one section, one fee head at a time). The 14 non-Masters `saveMasters`
callers each become a row write of their own slice or are deleted: `components/staff/StaffWorkspace.tsx`,
`components/staff/StaffProfileForm.tsx`, `components/timetable/TimetableRulesSetup.tsx`
(`SubjectRulesPanel` periods/week → a `classSubjects` element write under the
`masters.class_subjects` function grant), `lib/counterConcession.ts`, `lib/numberSeries.ts`,
`lib/feeAdjustments.ts`, `lib/fees.ts`, `lib/rteEws.ts`, `lib/referralRewards.ts`,
`lib/staffAttendanceRules.ts`, `lib/profileDocVerification.ts`, `lib/sis.ts`
(`ensureStudentClassLinks` — a read must never save), `lib/staffPersistence.ts`,
`lib/mastersPersistence.ts`. Staff records (`sis_staff`, already a stamped row table) move to
`useStaffList()` + `useErpMutation` here so `scheduleStaffSync` can go with `saveMasters`.
Delete `saveMasters()`'s whole-book push, `mastersSectionSave`, and the function-only branch in
`lib/deskFeatureGate.server.ts` (`function-only push by` at :174); the masters-desk POST answers
410 (the 1.2 stub) for a body with `classSubjects`. Acceptance (CI): the POST handler returns 410
for a whole-book body; `deskFeatureGate` function-only branch gone (ratchet 0);
`propagation.spec.ts` end to end through the real editor; `stale-writer.spec.ts`. Post-deploy
measure: no `function-only push by` / `rejected unversioned push` lines in Cloud Run logs.

**The director's decisions (20 Oct 2026).** (1) Masters list elements (subjects, class-subject links,
sections, fee heads, concession grants, holidays …) carry a per-element `_rev`; an element write is a
compare-and-set on that ONE element — two people editing different elements both land, only the same
element at once conflicts; no writer, old or new, may ever reset a `_rev` (the "ABA" case). (2) Staff
Remove is a **soft** remove: a marker with who and when, hidden from lists, restorable; never a hard
delete. (3) Sensitive staff fields (bank account, IFSC, Aadhaar, PAN, salary) are written only by the
owner or someone with the payroll / accounts function, enforced in the database path the app uses. (4) The
fee-setup clone is all-or-nothing (a batch of element writes, one bad element = nothing written).

**The split.** 2.2 is six PRs, in order: **2.2a** the database (below). **2.2b** staff records through the
kernel: `sis.staff` / `sis.departments` / `sis.designations` registry collections, the staff editor and
profile form write rows, Remove = the soft delete, the sensitive-field route, every `sis_staff` reader
filters `deleted_at`, `scheduleStaffSync` deleted. **2.2c** `MastersWorkspace` and its panels write
elements (registry `base: "rev"` for the 21 `masters.*` list collections). **2.2d** the non-Masters
`saveMasters` callers (`lib/numberSeries.ts` → `masters_series_bump`; `counterConcession`, `feeAdjustments`,
`fees`, `rteEws`, `referralRewards`, `staffAttendanceRules`, `profileDocVerification`, `TimetableRulesSetup`;
`ensureStudentClassLinks` stops saving). **2.2e** the fee-setup clone through `desk_slice_rows_write`.
**2.2f** delete the whole-book push, `mastersSectionSave` and the function-only branch; the 410 stub; the
acceptance above. *(The split was given to the 2.2a executor as "2.2a–2.2f"; the per-PR contents above
are its reading of the step list — the director may re-cut 2.2b–2.2f.)* **Re-cut by the director (20–21 Oct):**
2.2b kernel plumbing (no screen moves) → 2.2c foundation panels, section teachers, timetable periods →
2.2d staff editor and profile form → 2.2e fees → 2.2f deletions (masters-desk POST 410, `saveMasters` gone).

*(2.2a built 21 Oct 2026, PR #697 — migration `20261021090000_data_layer_masters_row_revs_staff_kernel.sql`:
**the director applies it to production before 2.2b deploys**; it is safe to apply ahead of time — no
live code calls the new functions, and the only change live code sees is that Masters elements gain
`_rev`, which every client fingerprint already ignores (`rowFingerprint` in `sliceRevClient.ts`).)*
**What exists.**
- **Masters `_rev`.** `desk_slice_row_write` on `masters_desk_slices` takes the element's `_rev` as its base
  (a whole number; absent = 0; new element → 1, changed → +1, identical → unchanged), exactly as the other
  14 `_rev` desks. The slice stamp (a timestamp) is still accepted for Masters until 2.2c flips the registry
  (`lib/data/registry.ts` `base: "slice"` → `"rev"`), and the element's `_rev` moves under it too.
  Timetable keeps the slice stamp (its elements carry no `_rev`). The function body is now
  `_desk_slice_element_apply` (internal, not executable by service_role) + the meta bump / row sync, so
  the single-element and batch writers share one implementation; outcomes are unchanged.
- **The ABA guard is a trigger, not TypeScript:** `masters_desk_slices_carry_revs` (BEFORE INSERT/UPDATE OF
  payload) does `mergeWithRevs`-without-a-base in SQL for **every** writer — the kernel,
  `masters_write_slices` (`pushMastersSlicesToDb`), `pushMastersDeskToDb`'s direct upsert, scripts: an
  unchanged element keeps the stored element exactly; a changed one gets the **stored** `_rev` + 1; a new
  one max(its `_rev`, 1); a writer's own `_rev` on an existing element is ignored. So the old paths did
  not need a TypeScript change to carry `_rev`, and cannot reset one even from a copy that dropped it.
  O(n) (an id-keyed lookup): 3,000 elements in ~10 ms (production's largest list is 270,
  `feeStructureLines`; read-only count 21 Oct: no element without an id, no duplicate ids, none with `_rev`).
  `masters_sync_rows_from_slices` copies only keys that are row-table columns; no `masters_desk_*` table has
  a `_rev` column (asserted).
- **`desk_slice_rows_write(p_tenant, p_table, p_ops)`**: ≤ 500 element ops `{slice, op, id, row, base, key}`
  across the lists of one slice table, bases = element `_rev`s only (a stamp base, timetable, an element
  twice, an empty batch → 22023). All applied in a sub-transaction; any conflict rolls it back and the
  answer lists every op's outcome (`ok:false`); an invalid op raises. One meta bump and one Masters row
  sync per batch.
- **`masters_series_bump(p_tenant, p_series, p_used, p_ay default null)`**: series by code (or id), under
  the slice lock, next = max(stored next, `p_used` + 1) — per year (`countersByAy`) when `resetOnAy` and
  `p_ay` is given (as `advanceSeriesAfterUse`); a lower number is `unchanged` and moves nothing; unknown
  series → `not_found`; `p_used` < 1 → 22023. No base.
- **Staff rows**: `sis_staff` (soft delete), `sis_departments`, `sis_designations` (hard delete; they have
  `is_active`) are in `desk_writable_tables` with **no** sync_meta: `erp_versions` already reports each from
  the table itself (group 2, max(updated_at) + count(*)); a `sis_staff_sync_meta` table would have produced
  a second `sis_staff` key. `sis_staff` gains `deleted_at`, `deleted_by`. `desk_write_guarded` v4: a soft
  delete on a table with `deleted_by` needs the op's `by` (the route fills it from the session) and records
  it; an upsert there may clear `deleted_at` (restore, with the removed row's revision; `deleted_by` is
  cleared) but never set it. Unchanged for every other table.
- **Sensitive staff fields** (`_sis_staff_sensitive_keys()`: profile `bankName`, `bankBranch`,
  `bankAccountNo`, `bankIfsc`, `bankAccountName`, `upiId`, `aadhaarNo`, `panNo`, `basicPay`, `visitingPay`;
  blank = null = "" = absent): `desk_write_guarded` refuses any op that sets, changes or blanks one
  (42501 → 403 at the route; nothing written) unless the transaction carries the mark that only
  **`sis_staff_write_sensitive(p_tenant, p_ops, p_authority 'owner'|'payroll'|'accounts', p_actor)`** sets
  (transaction-local, cleared before it returns). Every marked change is recorded in the new
  `sis_staff_sensitive_changes` (field names, actor, authority, when — never values).
  **How 2.2b sets it:** `POST /api/data/sis.staff` → `repo.write` → `desk_write_guarded` can never change these
  keys. A separate server path calls `sis_staff_write_sensitive` **only after** checking that the session
  is the owner or holds the `payroll` or `accounts` function, passing which one and the session's id as
  actor. Because `profile` is one jsonb column and the kernel patches top-level columns, a staff-edit save
  must send the profile with the sensitive keys **as stored** (the route lays them on from the row it read)
  — a profile without them is a blanking and is refused.
- Grants: every new function `search_path = public`, revoked from public/anon/authenticated, executable by
  service_role; the apply step and the trigger function owner-only; `sis_staff_sensitive_changes` RLS on,
  service_role only.

**Proof.** `supabase/tests/masters_row_revs_staff_kernel.test.sql` (69 checks in six self-contained
sections; in CI). On origin/main's schema each section fails at its first check (A "a new Masters slice
row gives every element _rev 1"; B and C the `_rev` base "1" is not a timestamp; D and F the functions
do not exist; E "sis_staff … kernel-writable"), and the old contract shown directly: two people editing
**different** subjects from one load → the second is `stale`. Eleven mutations of the new migration, each
red: masters back to slice mode; the trigger trusting the writer's copy ("3 → 4, never reset"); the
trigger removed; the batch not rolling back ("NOTHING of it was written"); no refusal at all; the series
not monotone; remove without `by` accepted; hard delete ("the row is still there"); `sis_staff` not soft;
an empty sensitive-key list; the mark not cleared. `desk_slice_row_write.test.sql` (51) — its "no _rev on
a masters element" check now asserts `_rev` 1 → 2 (fails on origin/main's schema, as intended);
`desk_write_guarded.test.sql` (37) — "every writable table names a sync_meta table" now exempts the three
tables erp_versions reads directly. `e2e/versions.acceptance.ts` "the subject is restored exactly as seeded" compared the element byte for byte and failed in CI on this branch (the restore moved `_rev` 1 → 3 — the guard working); it now compares the content without `_rev` and asserts `_rev` moved by exactly 2; `e2e/write-kernel.acceptance.ts` "slice: restored the seeded subject exactly" — the same failure, the same change. Migration applied twice on a fresh PG17 (idempotent; 393 applied, 0
failed).

**Not done / not proven.** No app code changes (2.2b–2.2f): nothing calls the new functions, the
registry still sends Masters slice stamps, no screen soft-removes or restores staff, and no `sis_staff`
reader filters `deleted_at` yet — **2.2b must add that filter to every reader (roster, logins, mobile
auth, payroll, attendance) before it ships Remove**, or a removed member keeps showing and signing in.
The e2e stack's `write-kernel.acceptance.ts` / `write-conflict` / `stale-writer` specs (slice-stamp Masters
writes) were not run locally (no app build on this machine) — CI runs them. A delete and re-create of the
same element id through the old path restarts at max(its `_rev`, 1): an old copy carrying the deleted
element's `_rev` could then match (the old path resurrecting a deleted element is the replica's own bug;
2.2f removes that path). `pfNumber` / `uanNumber` / `esicNumber` and the Aadhaar/PAN document files
(`docs.*`) are **not** in the sensitive list — the director's list did not name them; adding one is a
one-line change to `_sis_staff_sensitive_keys()`. Masters exports that dump whole elements will show a
`_rev` field.

*(2.2b built 21 Oct 2026, PR #702 — kernel plumbing; no screen moved, no migration.)* **What exists.**
- **A staff write never wipes the record:** `profile` is one jsonb column and the kernel patches columns, so an
  upsert's profile keys are laid on the STORED profile (a key is cleared by sending it blank, never by leaving it
  out) — without this, a profile carrying only the changed keys replaced the whole record (found on the stack: an
  edit sending `{fullName, mobile}` replaced a 69-key profile with those keys plus the protected ones; fixed and asserted key by key).
- **Staff collections** (`lib/data/registry.ts`): `sis.staff` (soft delete; `staffRecords`), `sis.departments`,
  `sis.designations` (hard delete) — module `staff`, view/edit `staff`; a delete of any of the three is a decision:
  `staff · delete` (new `ApprovalRule.action`; the approval gate asked only `approve` before). `POST /api/data/sis.staff`:
  a delete op's `by` is the SESSION's (staff id, else e-mail) whatever the body says, on every collection; an upsert
  may not write `deleted_by`/`tenant_id`; restore = an upsert `{deleted_at: null}` at the removed row's revision
  (`?ids=`). `GET /api/data/<softDelete collection>?removed=1` lists the removed rows (edit holders only).
  `GET sis.staff` = the staff-roster GET's rule: whole rows (never `loginPassword`) for staff · edit and for the
  person's own row, a directory for everyone else (`lib/data/server/staffKernel.ts`).
- **Protected staff fields** (`lib/staffProtectedFields.ts`, keys in `lib/staffProtectedKeys.ts` = the database's
  `_sis_staff_sensitive_keys()`, checked on the stack): bank, UPI, Aadhaar, PAN, pay — and, decided here, the
  **login**: `loginUsername` is an identity link (`/api/auth/session` signs a Supabase login in as the row whose email
  OR loginUsername matches) and `loginPassword` is a demo-era plain-text password (real sign-in is Supabase Auth).
  Through `sis.staff` none of them changes (403 with the reason; the profile is ONE jsonb column, so keys an upsert
  leaves out are laid on from the stored row — leaving them out is not a blanking; a stale copy's old bank value is
  the database's 409, but a login change is refused even from a stale copy, having no database check). A new record
  may carry the username the form derives from its employee code, or none; no bank details.
  **`POST /api/data/sis.staff/sensitive`** (`app/api/data/[collection]/sensitive/route.ts`, rules in
  `lib/data/server/staffSensitive.ts`): body `{ops:[{id, base, fields}]}`, fields = protected keys only; authority
  from the SESSION (`staffSensitiveAuthority`: owner — protected e-mail or a role coded `owner`; else payroll · edit;
  else accounts · edit; never the mirror secret), actor = the session's staff id; the stored profile with the given
  fields laid on goes through `sis_staff_write_sensitive` (which logs field names to `sis_staff_sensitive_changes`).
  Login username: owner only; a password is never SET by any path — the owner may clear one. Removed member: restore
  first. **Finding:** the built-in `office` role holds payroll · edit and accounts · edit, and `admin` accounts · edit —
  so every built-in role with staff · edit is also an authority; "plain staff editing" exists only for custom roles or
  personal denies (how the stack proves the refusals).
- **Conflict answers** never carry those keys: `answerRedaction` in the registry (sis.staff: profile's bank / UPI /
  Aadhaar / PAN / pay / login), applied in the repo to every conflict `stored` row (`lib/data/answerRedaction.ts`) —
  `write`, `writeRows` by table, and the sensitive route. (Review of 2.2a, item 1.)
- **The old staff-roster route** (still the Staff screen's save until 2.2d): POST judges the rows it WILL write
  (stamped: the rows named; unstamped: new rows only; stored rows matched by id, else by employee code) with the same
  rule and the session's authority — a plain staff editor changing a protected key → 403, nothing written; the
  browser's push records the 403 with `recordDeskSyncFailure`, whose toast now recognises these refusals
  (`isFeatureRefusalMessage`). DELETE (the "wipe", no caller in the app) is a SOFT remove of every live staff row
  (`deleted_at`, `deleted_by` = the session); departments and designations are no longer deleted. (Items 2 and 4.)
- **Removed staff are hidden by every server-side list** (item 5), inventory: `fetchStaffRemoteServer` (staff-roster
  GET; the server Masters cache behind `/api/data/views/{masters,staff-list}`, every `/api/v1/*` route reading
  `ctx.masters.staff` — mobile roster, scope, payroll; the school mirror; and `revalidateStaffSession`, so a removed
  member's session ends with 401), `/api/auth/session` (sign-in match), `authProvisioning` (OTP provisioning),
  `erpChatActorLite`, `waRoleResolver.server` (WhatsApp identity ×2), `/api/v1/staff/profile-requests` (mobile clash),
  `udiseTeacherSync.server`, `udiseSchoolProfile.server`, `noticePush.server`, `visitingPay.server` (visiting list),
  `websiteContent.server` (public people). Left as they are (single records by id, history labels, an existence
  check, the BigQuery export): `fetchStaffDocsById`, `staffSelfProfile.server`, `visitingPay` single-row reads,
  `libraryCounter` labels, `staffAttendanceOutdoorDuty` id check, `bigQuerySyncCatalog`. Restoring clears
  `deleted_at`: every reader shows them again (proved on the stack).
- **Masters element writes:** the 21 `masters.*` list collections are `base: "rev"` — a read hands out each element's
  `_rev` (no slice stamp), a write sends it; several ops in one request to a `_rev` list are ONE all-or-none
  `desk_slice_rows_write` batch (`writeSliceBatch`, ≤ 500). Object slices keep the slice stamp. The masters view passes
  `_rev` through (nothing normalises it away) and returns `stamps` — each object slice's `updated_at`, read with its
  payload (`serverMastersSliceStamps`; a withheld object in the teaching answer gets none).
- **Function grants in `POST /api/data/<masters list>`** (`lib/data/server/sliceFunctionGate.ts`, rule
  `sliceFunctionRules.ts`): without masters · edit, the function that owns the list decides, op by op from the
  STORED element (absent = create): a teacher's `masters.class_subjects` writes only in her classes (the stored
  element's class and the written one); a whole-module holder personally denied a function's action is refused it.
  `deskFeatureAuth` compares rows without `_rev` (item 3: a re-push carrying an older `_rev`, or none, is no change).
- **Client:** `useMastersMutation(sliceKey)` (`lib/data/client/writeHooks.tsx`) — `commit(next)` compares the edited
  list with the view's served list and sends only the differences on their served `_rev` (`mastersCommit.ts`): more
  than ONE delete per commit, a list going empty, an id twice or missing, a withheld (teaching-subset) list, or an
  object without a served stamp are refused with nothing sent; then the masters view refetches.
  `useStaffMutation(collection)` + the **staff bridge** (`staffBridge.ts`): after a confirmed staff write (or a
  conflict) the page copy's roster is re-read from the server (server wins; removed members leave it), so permission
  checks and the old save's stamps follow. `writeStaffSensitiveFields()` posts to the sensitive route. Nothing on a
  screen calls these yet (2.2c/2.2d). The test screen `/e2e/write-kernel` writes on the element's `_rev`.
**Proof.** Self-tests (in `verify.sh` and CI): `test:staff-kernel` (protected keys refused fresh/stale, laid on when
absent, `by` = session, conflict redaction, list directory, authority matrix incl. a personal deny, sensitive-route
rules, the old route's guard), `test:masters-writes` (registry flip, commit adapter, function rule, the masters view's
`_rev` + stamps, the bridge), `test:desk-feature-rev`. Fail-on-old: `test:desk-feature-rev` fails on the old
`deskFeatureAuth` ("You may not change class subjects"); 17 mutations of the new code each turn a self-test red.
Stack (`e2e/staff-kernel.acceptance.ts`, in `e2e-stack.sh check`): on this branch **18/18**; the same file (16 checks at
the time) against the base branch's app code, built on the same stack: **3/16** — a member marked removed still listed by staff-roster, the staff-list
view and the mobile roster and still signed in; a plain editor's bank change through the old route written ("OLD-ROUTE");
the old DELETE hard-deleted 35 staff, 3 departments and 8 designations; the teacher's own-class link 403; sis.staff and
the sensitive route 404. `write-kernel.acceptance.ts` §3 now on element `_rev`s (adds: a different element from the
same load lands; two ops = one batch, a stale one writes nothing); `stale-writer.spec` / `write-conflict.spec` use the
element's `_rev`. CI scoreboard: see the PR.
**Not done / not proven.** No screen writes through the new hooks (2.2c/2.2d). The refusal TOAST of the old staff
editor was not seen on a screen: on the stack the old editor (`/staff/<id>/edit`, opened from the roster) sends no
`POST /api/school-data/staff-roster` at all on Save (no request in 30 s; seen on the base branch's build) — the old
save path is gated on the staff desk having been loaded by that page (`scheduleStaffSync`/`hasDeskLoaded`); a
pre-existing defect, left to 2.2d, which replaces that path. The function-grant path writes only `_rev` lists (an
object slice still needs masters · edit). `pfNumber`/`uanNumber`/`esicNumber` and document files are still not
protected (2.2a's list). The e-mail column is an identity link too (sign-in matches it) and stays plain staff · edit.

*(2.2b review fixes, 21 Oct 2026, same PR #702.)* An independent review found eight faults; all fixed, each with a
self-test that fails on the earlier head (shown by reverting each fix: red) and a stack acceptance re-run (22 checks;
the earlier head's app on the same stack: **11/22**).
- **Director's decision (21 Oct): sensitive staff fields = owner + accountant only.** Payroll·edit / accounts·edit are
  NOT the authority any more: the Office role (production: payroll·edit + accounts·edit, 2 active staff) runs payroll
  and the books daily, and Admin (accounts·edit, 2 active staff) the accounts — taking those grants away would stop
  that work. So a new FUNCTION `staff.sensitive_edit` ("Bank, ID & pay details", `lib/rbacFeatureCatalog/people.ts`)
  is the authority, held as a function grant only (`featureGrantHeld` / `functionGrantHeldOnServer` — never via the
  staff, payroll or accounts module as such), given to the built-in **Accounts** role in code (`defaultBuiltInRoles`)
  and, for schools that already stored their roles, through `BUILT_IN_GRANT_ADDITIONS`
  (`2026-10-21.accounts.staff_sensitive_edit`: added once to the stored Accounts role — production: 2 active staff
  hold it). Production read-only, 21 Oct: roles with payroll·edit or accounts·edit and active staff assigned —
  office 2, admin 2, accounts 2, principal 2; personal grants: 2 `payroll` edit DENIES, 2 `staff` edit allows; no one
  holds the new function yet. After deploy only the owner and the Accounts role's 2 members can change these fields;
  the principal (whole modules, no function grant) no longer can.
- **Old route judges each row where the write lands**: by employee code (upper-cased, trimmed — the write's remap now
  uses the same key, `rosterEmpKey`) first, else id; an id that is one member with another member's code is refused.
- **Absent = keep** on the old route (`prepareRosterRows`): its push normalised an absent key to "" — leaving the bank
  keys out blanked them.
- **The form's default username** (derived from the employee code on every save) over a blank one is not a login
  change (29 of 35 active production staff have no username: the office could otherwise save almost nobody).
- **Refused rows only**: the old route writes the other rows of a save, answers `refused: {staff: [ids]}` with the
  reason; the browser toasts it once and re-reads the roster (the refused rows go back to the server's copy) instead
  of re-sending them with every later save.
- **Profile-request approvals** of bank / Aadhaar / PAN go through `sis_staff_write_sensitive` (logged, owner or the
  function — the accountant may decide such requests without staff·edit), never to a removed member.
- **Sign-in links**: `email` and `mobile` (sign-in resolves people by them) on an existing record — set or changed — are
  the owner's (kernel, old route, `/api/v1/staff/roster/mobile`); a new record may carry ones no other member holds;
  a member may not give themselves another member's or an owner's e-mail (self-service profile).
- **Server-side commit caps** on `POST /api/data/masters.*`: more than one removal, a removal emptying the list, or more
  than 500 ops (every collection) → 400.
- **Canonical comparison** (sorted keys; a number and the string that spells it alike; leading zeros kept).
- Minor: an empty roster that was READ ends non-owner sessions (all removed); the owner is never locked out by the
  roster; `visitingPay` single-row reads and `patchStaffRow` skip removed members.
**Behaviour changes (review):** the office, admin and principal can no longer change bank / UPI / Aadhaar / PAN / pay;
the office can no longer set or change anyone's e-mail or registered mobile on an existing record (the owner can) —
including recording a missing mobile from the phone; a save with one refused row now saves its other rows.

*(2.2b, director's follow-up and re-review, 21 Oct 2026, same PR #702.)*
- **The Accounts role's `staff.sensitive_edit` is automatic and once-only**: `BUILT_IN_GRANT_ADDITIONS` adds it to a
  stored Accounts role once (stamped in `defaultsApplied`, audited); the template is stamped too; a later removal by the
  office stands on every load (self-test).
- **A missing staff mobile may be recorded by the office** (director): only blank (or 0000000000) → a 10-digit number;
  refused when any other member, family (mobile, WhatsApp, alternate) or login (`profiles`) has it — compared as the
  last 10 digits (`signInMobilesInUse`) — or when the member holds powerful access (principal designation; owner /
  admin / accounts / principal role; payroll·edit or accounts·edit; the bank & pay function; an owner e-mail —
  `staffHoldsPowerfulAccess`); changing a set number stays the owner's. Same rule in the kernel, the old staff-roster
  route, `/api/v1/staff/roster/mobile` and profile-request approvals. Every fill is in the app audit log
  (`audit_events`: who, which record, when — never the number; `sis_staff_sensitive_changes` allows only owner /
  payroll / accounts authorities by its own check, so using it would need a migration). The roster/mobile audit line no
  longer carries numbers.
- **The accountant can use the function**: `/staff/<id>/edit` shows a holder of the function without staff·edit a panel
  with only bank, UPI, Aadhaar, PAN and basic pay (`StaffSensitiveDetailsPanel`, saving through the sensitive route);
  the full record is readable for them (staff-roster GET, `GET sis.staff`); Staff → Requests shows them, and lets them
  decide, the bank / ID / pay requests. For everyone without the function those inputs on the profile are locked, with
  a line saying who enters them — typed data is never silently dropped.
- **Sign-in details are one person's** even for the owner (sensitive route: an e-mail or mobile another member, family
  or login holds → 409); a new member with a number someone else has is refused with a message saying so (a shared
  family phone?) and that the owner can set it.
- Main's `staff-editor-save.spec` (the old editor's Save, #705) now edits the father's name: a set mobile is the owner's.
**Proof.** Self-tests (mobile rule, powerful access, once-only grant) red on the previous head; the stack acceptance
(31 checks) on the review head's app: 23/31 — every new rule failed there; this branch 31/31. New
`e2e/specs/staff-sensitive-screens.spec.ts` (project `staff-sensitive`): fails on the review head (no locked note, no
panel); passes here; screens seen — the office's locked Bank tab and the accountant's panel saving, desktop light and
phone 375 (the app's dark theme was not applied by the browser's colour-scheme emulation — dark not seen).
*(2.2b follow-up, built 21 Oct 2026, PR #706 — fix/staff-locked-field-validation.)* The full profile's Save no
longer checks Aadhaar / PAN / IFSC format for a user who cannot edit them (`validateStaffProfile(draft, { sensitive:
canSensitive })`): a malformed stored value (legacy import) refused Save and sent them to a tab they cannot change.
Holders of the function and the owner are still checked. Self-test cases in `staffProfileValidate.selftest.ts`;
`e2e/specs/staff-locked-validation.spec.ts` (project `staff-sensitive`) red on main, green here. Found, not fixed: the
fixture's office (staff · edit, Masters view-only) has its profile Save blocked by `saveMasters` before any request,
while the form still says "Staff updated".

*(2.2c built 21 Oct 2026, PR #PRNUM — the Foundation panels, the class/subject teacher links, Timetable's periods/week and
the number series write elements; no migration.)* **What exists.**
- **The Masters editor's commit** (`components/masters/MastersWorkspace.tsx`): panels still hand `commit(next)` a book;
  `planMastersElementCommit` (`lib/data/client/mastersElementPlan.ts`, pure) turns the difference between the book ON
  SCREEN and `next` into element writes for the Foundation lists — campuses, academic years, terms, classes, sections,
  subjects, senior streams, class subjects, number series, holidays — and the objects school profile / school timing /
  statutory setup: an element the action changed → one upsert (base = the revision of the element as SHOWN: the one
  this tab's own save answered, else the `_rev` it carries, else the served one; a dropped key is sent as null); an
  element it removed → a delete, ONE PER REQUEST (a user action that removes several — a subject with its components
  from a class, a class with its links — is several saves in a row, parents first; > 12 in one action, an emptied
  list, a missing or doubled id → refused, nothing sent); an object → one upsert on the view's stamp. Elements the
  action did not touch are never sent, whatever a stale answer shows. `useMastersElementWrites()`
  (`lib/data/client/writeHooks.tsx`) sends them request by request (each all-or-none on the server) and stops at the
  first refusal; the masters view refetches. A refusal says "Not saved — …" (a conflict: "Someone changed this on
  another device a moment ago — nothing was saved. The screen now shows their version; make your change again.").
- **Class / subject teacher links** (`SectionTeachersPanel`, and the cascades of removing a class or section): a
  change to `classTeacherLinks` / `subjectTeachingLinks` becomes, per member, the added links and the removed link
  ids, laid on the record AS STORED NOW (GET `sis.staff`, its `updated_at` the base) and written through
  `POST /api/data/sis.staff` with `{profile: {classTeacherLinks}}` only (2.2b lays it on the stored profile); then the
  staff bridge re-reads the roster. Never the roster, never the old staff-roster route. Needs Staff · edit.
- **Fee setup (2.2e) and staff setup (2.2d)** keys still save through `saveMasters` — only when an action changed one
  of them, with the Foundation keys taken from the tab's page copy AS LOADED, so the old save never sends a Foundation
  list. The 2.1h whole-book overlay now holds only its own keys.
- **The overlay, per element** (`components/masters/mastersElementPending.ts`, pure): what a save sent is laid over
  the answer element by element until an answer serves that element at the `_rev` the save answered (or later), or
  no longer has it (a delete), or the object's stamp is the save's or later; a failed save drops its elements at
  once; an unproven entry goes after 60 s. Everything else on screen is the latest answer — another person's change to
  a different element of the same list shows at once. The editor re-asks every 2.5 s while an element is unproven.
- **The masters-desk bridge** (`lib/data/client/mastersDeskBridge.ts`): after any element write (and on a conflict)
  the tab's masters desk is re-read (`ensureMastersHydrated` after dropping its mark), so the OLD save's per-section
  stamps follow the server — without it a fee edit right after a subject edit in the same tab was refused "changed on
  another device". The old save waits for a running re-read. Goes with the old save (2.2e/2.2f).
- **Timetable → Subject rules** (`TimetableRulesSetup`): periods/week = `useMastersMutation("classSubjects")` — only
  the links whose number changed, one request; a teacher only in her own classes (2.2b's function-grant path).
- **Number series** (`lib/numberSeries.ts persistSeriesUse`): `POST /api/data/masters.number-series/bump`
  `{series, used, ay?}` → `masters_series_bump` (monotone, no base; new route `app/api/data/[collection]/bump`,
  repo `bumpNumberSeries`). Allowed for a staff session with edit on masters, students, admissions, staff,
  certificates, fees or accounts. The screens see the new next number at the next masters answer.
- **The old path refuses a Foundation wipe** (`guardFoundationListsOverwrite`, `lib/mastersWriteGuard.ts`, in
  `POST /api/school-data/masters-desk` before any write): a body that would remove more than ONE element of any
  Foundation list, or empty one, is 409 `foundation_shrink`, nothing written (the 10 Oct subject wipe passed the old
  2-subjects/10 % guard).
- **School profile panel**: its tables now show the SAVED profile (they showed the form's draft, which was read once —
  a profile saved elsewhere never reached an open panel); the form follows a newer saved profile unless it holds
  unsaved typing. `SectionTeachersPanel`'s selects are labelled ("Class teacher of IV-A", "ENG teacher of IV-A").
- New ratchet `save_masters_call_sites` (call sites of `saveMasters(` in src): 19 on main → **17** (TimetableRulesSetup,
  numberSeries; the editor keeps one call for fee/staff setup).
**Proof.** Self-test `test:masters-element-commit` (CI + verify.sh; 13 checks: one element on its shown `_rev`, a
stale neighbour never sent, the stale element itself sent on ITS old `_rev`, parents first, one removal per request,
emptying / too many / bad ids refused, objects on the stamp, staff links apart, fee keys → the old save, the overlay's
proof and drops, the old path's guard). Specs (all on the real screens, e2e stack): `propagation.spec` 7 new cases
(campus added, term added, number series prefix, government holiday approved, school profile website, class renamed,
periods/week from Timetable) — A edits on the panel, the request must be element ops to that panel's collection and
never masters-desk, the database holds it, and B (office) with the same panel open sees it within 30 s; the existing
subject/section editor cases now go through element writes too. New `masters-element-writes.spec` (propagation
project): **overlap** (two principals rename the sections of IV and V from screens loaded together → both on the
server, no "Not saved", B's request = V's section only), **same element** (B held on the pre-save answer renames IV-A
after A → "Not saved — …", A's name stays), **subject wipe** (an old masters-desk body dropping two subjects → 409
`foundation_shrink`, nothing removed; two deletes in one kernel request → 400; deleting a subject on the screen sends
exactly one delete op), **teacher** (Nursery-A's teacher marks Music optional in Nursery on the real screen → one
element to `masters.class-subjects`, stored; the same in LKG → "Not saved — … not one of your classes", LKG unchanged),
**class teacher** (IV-A's class teacher changed on Sections → Teachers: one `sis.staff` request with the two members,
each op `{profile: {classTeacherLinks}}` only, every other profile key unchanged; put back on the screen).
`masters-overlay.spec` now waits for the element writes and mocks the element 409. **Fail-on-old** (these specs,
`apps/web/src` at origin/main cbd9b973 with only the class-teacher select's label added, fresh build, fresh stack):
overlap FAILS (B's save refused — the sections slice's old stamp), subject wipe FAILS (the old body was accepted: two
subjects removed), teacher FAILS (whole-book masters-desk save), class teacher FAILS (masters-desk / staff-roster
save), both masters-overlay cases FAIL, all 7 new propagation cases FAIL ("no whole-book save"); same element passes
on main too (coverage). This branch, fresh stack: `e2e-stack.sh check` all green (16, 22, 26, 31 + v1); counts +
teacher + kernel + error + masters-exams-reports + stale-writer + write-conflict, desktop and phone-375: **73/73**;
propagation + masters-overlay + masters-element-writes + student-upgrade + staff-editor-save: **34 passed, 1 skipped**; after merging main (#706), fresh stack: payroll-writes + staff-sensitive **7/7**
(the staff cases stay expected-fail). Screens seen desktop-light and 375-dark: campuses, session, numbering, holidays,
school, classes → sections → teachers, subjects, Timetable → Subject rules. counts.spec unchanged.
**Behaviour changes users will notice.** Two people editing different items of one Masters list both save (before:
the second got "changed on another device"); the same item at once → the second is told and shown the other's
version. Removing several links in one action is several saves in a row (not atomic: a refusal part-way leaves the
earlier removals done). Removing the LAST item of a Foundation list (e.g. the only holiday) is refused ("would leave …
empty") — 2.2b's server rule, now reached from the screen. Number series now move for the office and the counter too
(before: only a Masters editor's issue moved them — the rest were silently dropped). Setting a class teacher needs
Staff · edit (it writes staff records). School profile tables show the saved profile, not the typing.
**Not done / not proven.** Fee setup (2.2e), staff setup / departments / designations and the 13 other `saveMasters`
callers (2.2d) still save whole. The masters-desk bridge re-reads the desk (~235 KB) after every element save while
the old save lives. A class teacher set on another tab reaches B only after a reload (the staff side is the access
copy until 2.3a — not tested as propagation). Multi-instance staleness is simulated at the network (one local
instance). Brand & stamps / school timing / statutory panels write through the same path but have no spec of their
own (`payroll.spec` writes the statutory setup through the kernel API, not the panel; it passes here). The number-series bump route is exercised only
by type and read-through (no spec issues a number). A re-run of the holiday case on a used stack fails its control
(Holi is left unpublished, not removed — a fresh stack is needed, as for the rest of the propagation project).

**2.3a Delete the gate and the events.** With every component reader on hooks: delete
`CoreDataGate` (React Query's loading state replaces it), the `bhb-masters-updated` /
`bhb-rbac-updated` / `bhb-desk-first-hydrated` events and their listeners (one is the
`desk-hydrate` metric in `components/shell/useClientMetrics.ts`: re-emit it from the query hooks); re-implement
`useAccessData` (`components/shell/useAccessData.ts`, 23 consumers) on `useRbac()` +
`useStaffList()` with the same return type. Acceptance: `counts.spec.ts` on the throttled
375 px profile shows classes and staff within 2 s.

**2.3b Delete the four core hydrate tasks and the bridge.** Gated on the all-of-src
`loadMasters(` occurrence ratchet reaching 0 (the 107 `lib/` readers converted to take `masters`
as a parameter from the hook, or to server code). Then delete the `masters`, `staff`, `rbac`,
`moduleRegistry` tasks from `deskHydrationSchedule.ts` (a deletion in a frozen file) and the
2.1 bridge. Acceptance: the `ensure*Hydrated` component ratchet falls by 4; `counts` and
`propagation` green.

### Phase 3 — Students: removes S2 and most of S4

**3.0 Exports for the non-browser callers first.** 39 files authenticate with
`MIRROR_SYNC_SECRET`; the nightly BigQuery sync (the only disaster-recovery copy — it restored
134 receipts' lines on 1 Sep), the 3-hourly watch emails, the `school-erp-lite` sync, the UDISE
robot and the Flutter app all read bulk desk GETs. Enumerate every caller (`grep -rl
MIRROR_SYNC_SECRET\|viaMirrorSecret apps/web/src`, Cloud Scheduler `bhb-*-tick` jobs,
`scripts/`, `sync-lite-service.sh`, the robot's headers) and give each an explicit
`GET /api/export/<desk>` (service-secret only, paged, probe-cached) before any browser route is
gated. Acceptance: the 01:30 IST BigQuery sync and the watch email run green the night after
deploy (named in the PR as a post-deploy check), and every enumerated caller is listed with its
new endpoint.

*(Built 15 Oct 2026, PR #648 — enumeration only: **no non-browser caller of a bulk desk GET
exists**, so no `/api/export/*` route was added.)* **What was found.** The premise above (from
`evidence/review-v1.md` §3.3) was checked caller by caller and is wrong for every one:

| Caller | What it actually calls | Auth | Bulk desk GET? |
|---|---|---|---|
| Nightly BigQuery sync (`bhb-bigquery-nightly-sync`, **02:00 IST**, on `school-erp-lite`) | `POST /api/analytics/bigquery-sync/tick` → `lib/bigQuerySync.server.ts` `select * from <table> where tenant_id = $1` through `postgresPool` (9 tables) | `x-cron-secret` | no — reads Postgres directly |
| `school-erp-lite` (`scripts/sync-lite-service.sh`) | a copy of the web image serving ticks + the Fleet Edge push; calls nothing | — | no |
| 19 Cloud Scheduler jobs, asia-southeast1 | `POST` to `*/tick`-style routes (all exist) | `x-cron-secret` | no |
| 6 Cloud Scheduler jobs, us-central1 (5) + asia-south1 (1) | `GET /api/cron/{control-jobs,audit,ai-run,scheduled}`, `GET /api/holidays/official-suggestions/sync`, `POST …-uc.a.run.app/api/cron/scheduled` | `x-cron-secret` | no — and every one **404s** (last status NOT_FOUND; the routes do not exist) |
| ERP watch (3-hourly) and nightly review (01:30 IST) — Claude cloud routines | Supabase `SELECT`s, repo reads, Gmail; no gcloud, no app secret | Supabase MCP | no (prompts not re-read in this step; logs below cover them) |
| UDISE / Propel office robot (`extensions/office-robot`) | `/api/v1/udise/robot/*`, `/api/v1/propel/robot/*` only | the staff's own ERP cookie (`credentials: "include"`) | no |
| Flutter apps (`cbse_school_mobile/lib`) | 141 distinct `/api/v1/*` path strings + auth/upload/file/checkout/client-metrics | bearer session | no (their whole-desk cost is server-side, Phase 4) |
| `scripts/`, `apps/web/scripts/` | PostgREST directly (`/rest/v1`), `/api/wa/*`, `/api/analytics/bigquery-sync/tick?dryRun=1` | service key / secrets | no |
| Senders of `x-mirror-secret` (`MIRROR_SYNC_SECRET`: named in 44 route files, accepted by every `requireStaffApi` route) | none in the repo outside three self-tests | — | no |

Production agreed: Cloud Run request logs, 8–15 Oct, 27,519 GETs of `/api/school-data/*` +
`/api/data/*`, every one on `school-erp-web` from a `Mozilla` user agent (no headless, webview or
Electron agent); 15 Sep–15 Oct, the only non-browser request to those paths was one `curl` POST
answered 401. **What exists.** Ratchet `nonbrowser_desk_get` (budget 0, `scripts/check-ratchets.sh`):
a reference to `api/school-data/` or `api/data/` in the Flutter app, the extension, `scripts/`
(e2e harness excluded), `apps/web/scripts/`, CI workflows, `deploy/`, `cloudbuild*.yaml`, the
BigQuery sync files, or a `fetch(` of those paths in a route or `*.server.ts` fails CI; shown
red for a planted line in each of six of those places. **Consequences for later steps.** 3.3 and
Phase 6 can gate or delete the browser desk routes without an export path; `?export=1` on
`sis-roster` is not needed for any caller; the mirror-secret bypass on the bulk GETs has no user
and can go with them (`apiRouteAuth.server.ts` `hasMirrorSyncSecret`). The e2e acceptance
scripts and specs GET `masters-desk`/`sis-roster`/`staff-roster` with session cookies and move
with 3.3. 6.0 re-runs this enumeration (the ratchet plus the log query above). **Not done / not
proven.** The cloud routines' current prompts were not read (no tool for it here); a caller
outside the repo using a browser user agent with the mirror secret cannot be told apart in the
logs. The six 404 scheduler jobs are the director's to delete or repoint (not changed here). A
post-deploy check is still named — the 02:00 IST BigQuery job and the next watch email green —
though nothing in this PR touches either.

**3.1 Per-screen student endpoints.** `GET /api/data/sis.students?ay=&class=&section=&status=&q=&cursor=`
(the registered collection, keyset-paged ≤ 200) returns the list projection (id, admission no,
name, class, section, roll, household id, guardian name, phone, status, photo key).
**Year rule, encoded server-side and documented in the endpoint** (the comment at
`lib/data/registry.ts:95-110` is from 10 Aug and pre-dates the 31 Aug/13 Sep rule — replace it):
one row per child — prefer the row whose `academic_year_code` is the session year, else the
newest; **keep** rows with a blank year; de-duplicate on admission number **and** name; `?ay=all`
for exports; dueKey-resolving callers (pay links, parent checkout, `/api/v1/fees/ledger/[id]`)
stay unscoped. The 1.0 fixtures reproduce every one of these cases. `GET /api/data/views/student/:id`
returns the full record for the form; `GET /api/data/views/household/:id` one family with its
children. Teacher sessions are scoped by 1.7. Acceptance: `teacher.spec.ts`; a `students-year-rule`
unit test over the fixture; p95 of the list endpoint < 300 ms on the local stack.

**3.2 Fee counter search on the server.** `GET /api/data/views/fee-search?q=` returns ≤ 40
matches with dues from `fee_desk_open_dues` and transport dues in one query — replacing
`searchFeeStudents` + `computeStudentDues` in the browser (which parse the roster and the
transport desk per result). **Owner of `fee_desk_open_dues` maintenance:** today it is rebuilt by
the whole-desk fees-vouchers POST and `app/api/fees/rebuild-open-dues`; before this ships, 5.1b's
`fee_voucher_write` RPC (or an interim trigger on `fee_desk_voucher_lines`) must maintain it per
student on every write, or the counter shows stale dues. Acceptance: `budget.spec.ts` for
`/fees`; search results within 400 ms on the throttled phone profile; a counter receipt written
by the kernel changes the next search's dues.

**3.3 Convert the student readers.** The 77 component files (generate with `grep -rl 'loadSis('
…`), by directory, one PR each: 3.3a `components/students` (18) · 3.3b `components/fees` (14)
· 3.3c `components/parent` (7), `components/exams` (5) · 3.3d `components/masters` (4),
`components/events` (3), `components/comms` (3), `components/attendance` (3),
`components/shell` (2) · 3.3e the 18 single-file directories. The whole-roster `sis-roster` GET
stays only behind `?export=1` for 3.0's callers. Acceptance per batch: `counts` + `budget` for
the batch's screens; the `loadSis(` file ratchet falls.

**3.4 Student writes.** The student form and bulk actions write `{ops}` to
`/api/data/sis.students` / `sis.households` (`desk_write_guarded` v3); `sis_push_guarded` stays
only for the UDISE/import bulk paths. Delete `saveSis()`'s whole-roster push and
`alignSisToMasters`'s read-time rewrite (it silently re-files children into a class's first
section from a stale copy — `evidence/propagation.md` §2); gated on the all-of-src `loadSis(`
ratchet reaching 0. Acceptance: two contexts edit two different students concurrently — both
persist; a stale edit of the same student gets the toast; `stale-writer.spec.ts`.

**3.5 Home and shell.** `GET /api/data/views/search?q=` (server search, ≤ 40 hits, replaces
`UniversalSearchBar`'s per-keystroke parse of masters + sis + fees + admissions);
`GET /api/data/views/home-kpis` (the defaulter tile from `fee_desk_open_dues`, replacing
`listLiveDefaulters`'s 713× transport parse); `PrincipalCockpit` on one `useErpQuery` key;
`ModuleDashboardHost` figures on one query per desk instead of a fetch per `bhb-*` event (the
1,559 + 1,578 daily `open-dues-summary` / `inventory/sales` calls). Acceptance: `budget.spec.ts`
for `/home`; a keystroke in the search bar costs < 20 ms main-thread time (Playwright
`performance.measure`).

### Phase 4 — Mobile API: removes S6 (4.1 may run in parallel with Phase 3 once 1.7 is merged)

**4.0 Director prerequisite for 4.3.** Create a Cloud Tasks queue `wa-inbound` in
asia-southeast1, grant the service's runtime account `cloudtasks.enqueuer`, set `WA_TASKS_QUEUE`
on the service; the worker route authenticates with the existing `WA_DISPATCH_SECRET`.

**4.1 Per-person queries, one PR per route (4.1a–i), each with a per-phase timing log (auth /
query / build) and its own p95 target on the local stack.** Each route reads SQL scoped to the
caller and the reference cache (1.3); none calls `ensureSchoolMirrorHydrated` or any
`ensure*HydratedServer` afterwards. 4.1a `app/popups` (parents: one household's children by
`household_id`) < 100 ms · 4.1b `parent/attendance` (marks by `student_id` and date range)
< 150 ms · 4.1c `parent/summary` < 300 ms · 4.1d `homework/feed` (posts by section ids)
< 150 ms · 4.1e `comms/feed` (latest N notices) < 100 ms · 4.1f `staff/approvals` (counts by
`status='pending'` and scope) < 150 ms · 4.1g `staff/summary` and `staff/features` < 300 ms ·
4.1h `principal/snapshot`: one SQL function `principal_snapshot(tenant, ay, today)` (migration +
grant) returning the aggregates the screen shows, cached per process for 30 s keyed on
`erp_versions` < 800 ms · 4.1i the remaining `app/api/v1` callers. Phase exit: the
`ensureSchoolMirrorHydrated` ratchet under `app/api/v1` reaches 0 (100 files today).

*(4.1a built 15 Oct 2026, PR #652.)* **What exists.** `GET /api/v1/app/popups` for a parent reads
the family's student rows from `sis_students` by `household_id` (id order, filtered by household again in
Node) through `lib/data/server/householdRead.ts` — `householdChildren()` in `lib/appPopups.server.ts` no
longer hydrates the whole roster (`ensureSisHydratedServer` + `loadSis()`). Staff read no SIS at all, as
before. R6: a failed family read is 503 (it was the pop-ups of a family with no children), and an unreadable
pop-up list or event history is 503 (it was `{popups: []}`); the Flutter app already skips a failed pop-up
read silently (`core/popups/app_popups.dart`), so a parent sees the same thing. `householdChildren` is also
used by `POST /api/v1/profile/aadhaar`: there a failed read is now 503 instead of 404 "No children on roll".
One `{"event":"route-timing","route":"v1/app/popups",authMs,queryMs,buildMs,totalMs,persona,children}` line
per request (`lib/data/server/routeTiming.ts`, shared by 4.1a–c). **Proof.** Golden: the origin/main build
and this build on the same seeded stack (`e2e/parentApi.golden.ts`: eleven pop-ups of every rule, form and
audience plus events, for all 169 fixture families as their parent — the all-inactive family, the
`0000000000` families, 2–4 per-year rows, blank-year rows, the duplicate admission number — and as the
office): 171/171 popups answers byte-identical. `e2e/v1-popups.acceptance.ts` (in `e2e-stack.sh check`):
every family's targets are its own children (1,089 checked), no other child named, inactive family 403,
`sis_students` / `module_local_state` SELECT revoked → 503, timing lines, p95. On origin/main the two 503
checks, the timing check and the p95 check fail. `test:parent-api-scope` (reader filter, failure =
`{ok:false}`, timing line) — its household-filter checks fail with the filter removed. p95 (local stack,
200 warm sequential requests across families, shared Mac): **46–58 ms** (p50 27–31); origin/main 101–124 ms
(p50 66–73). **Not done:** `schoolAadhaarGaps`, `popupResponses`, `markAadhaarVerified` (office screens)
still hydrate the roster; production timing needs the deploy.
*(4.1b built 15 Oct 2026, PR #653.)* **What exists.** `GET /api/v1/parent/attendance` reads the
student by id (`lib/data/server/householdRead.ts`, shared with 4.1a/c) and that child's marks in one query:
`attendance_desk_marks` by `student_id` inner-joined to `attendance_desk_registers` filtered on the child's
section, the session's year and `attendance_date >= since` (one mark per register and student is a unique
key). No `ensureSchoolMirrorHydrated`, no `ensureAttendanceHydratedServer`. R6: a failed student or marks
read is 503 (origin/main answered 200 from its process copy). One
`{"event":"route-timing","route":"v1/parent/attendance",authMs,queryMs,buildMs,totalMs,entries}` line per
request. **Proof.** Golden: origin/main and this build on the same seeded stack (728 registers, 13,706
marks of every status, this year and last, 150 days) — every student row of all 169 families at 90 and 366
days as the parent, every row as the office, the refusals: 1,374/1,374 answers byte-identical.
`e2e/v1-parent-attendance.acceptance.ts`: 798 answers equal to the marks counted independently with psql,
cross-family 403 for every family, inactive family 403, 404/400, `attendance_desk_marks` / `sis_students`
SELECT revoked → 503, timing lines, p95; on origin/main the two 503 checks, the timing check and p95 fail.
p95 (local stack, 200 warm sequential requests, shared Mac): **65 ms** (p50 29; a second, noisier run
p95 119 / p50 25); origin/main p95 324–423 ms (p50 167–234). **Intended difference (production only):** a
register that exists only in a process copy (deleted from the table, or carried from the old blob) is no
longer shown. **Not done:** production timing needs the deploy.
*(4.1c built 15 Oct 2026, PR #654.)* **What exists.** `GET /api/v1/parent/summary` reads the
household (`sis_households` by id) and its student rows (`sis_students` by `household_id`, id order)
through `lib/data/server/householdRead.ts` (shared with 4.1a/b; the rows are filtered by household again
in Node), class/section names from `ctx.masters` (the 1.3 reference copy the session was already checked
against) and the per-child open dues from `fee_desk_open_dues` as before. A failed household/students read
is 503 (origin/main answered 200 from its process copy of the whole school, whatever that copy held). One
`{"event":"route-timing","route":"v1/parent/summary",authMs,queryMs,buildMs,totalMs,children,computed}`
line per request (`lib/data/server/routeTiming.ts`). **Not removed:** a child with no open-dues rows (a fully
paid child, or one admitted since the cache was rebuilt — 30 of 164 families in production, 15 Oct) still
needs `computeHouseholdDues`, which reads the fee book, transport, fee adjustments, concession aliases
(`loadSis()`) and Masters through module-level stores; that fallback still calls
`ensureSchoolMirrorHydrated` (now lazily, only when a child needs it) and can only go with 5.1 — so this file
stays in the ratchet. **Proof.** Golden: the origin/main build and this build on the same seeded stack (all
169 families, as each family's parent and as the office, every refusal) — `e2e/parentApi.golden.ts compare`:
509/509 summary answers byte-identical (and popups 171/171, attendance 1,374/1,374). `e2e/v1-parent-summary.acceptance.ts`
(in `e2e-stack.sh check`): children/names/cached balances against the fixture and SQL for 168 families (117
all-cached, 51 computed), cross-family 403 for every family, `sis_households`/`sis_students` SELECT revoked →
503, timing lines, p95. On the origin/main build the two 503 checks and the timing check fail (it answers 200). p95 (local stack, 200 warm sequential requests from the test process, shared Mac): cached families
p50 22.8 / p95 43.7 ms, computed families p50 24.4 / p95 37.3 ms; origin/main, same checks: cached p50 20.4 / p95 26.1 ms, computed p50 32.5 / p95 71.3 ms
— locally the old route was already fast because one long-lived process keeps its mirror warm; the
production gain (cold Cloud Run instances, ~1.2–2.2 s today) is **not measured** until deploy.

**4.2 Teacher scope in the app.** Depends on 1.7; verify every `app/api/v1/staff/*` route uses
it. Acceptance: a teacher whose only link is the timetable sees her sections in the app.

**4.3 WhatsApp webhook off the request path.** The webhook verifies the signature, inserts the
inbound message (Meta message id as the idempotency key; a duplicate delivery is a no-op), and
returns 200 **after the insert commits**; a Cloud Tasks task (4.0) calls `/api/wa/process` which
does the bot work with its own 25 s budget. `ensureWabaWebhookSubscription`
(`lib/waMeta.server.ts:162`) runs once per process. The 14 `lib/wa*.ts` mirror readers
(`waUnifiedBotServer.ts:2297` and siblings) move to `referenceCache` + per-household queries in
this step. Acceptance: webhook p95 < 500 ms in Cloud Run logs after deploy; the
`NOT_IN_SUITE` wa-webhook live test (`scripts/verify.sh:588-601`) runs against the local stack in
the `e2e` job; a replayed delivery produces one reply.

**4.4 Flutter client hygiene.** One long-lived `http.Client` with keep-alive; a 15 s timeout on
every call; a small JSON cache (path → last body, memory + file) so every home paints the last
payload instantly and refreshes in the background; refetch summary/features on resume when older
than 2 min; `WaitingCard` refreshes only when a pushed screen returns `true`; `RunningStrip`
polls only while the home route is current; `cacheWidth`/`cacheHeight` on gallery thumbnails.
Acceptance (1.2f beacon): cold open of the staff home paints cached data < 200 ms; approvals
calls per session ≤ 2; the app shows a Masters change within 2 min of resume.

*(Built 15 Oct 2026, PR #656 — app code only; no APK built, no versionCode change.)* **What
exists.** `lib/core/api/http_transport.dart` `TimeoutClient`: a view over ONE `http.Client` that
`ApiClient` creates lazily and keeps for its life (keep-alive); 30 s for the headers and for each
gap in the body — 30 s, not the 15 s planned above, because a cold Cloud Run instance rebuilds the
whole-school mirror before answering any `/api/v1` route (14 Oct 18:55–21:15 IST:
`homework/feed` 15.7 s once in 76 calls, `principal/snapshot` p95 6.2 s, `owner/anomalies` 6.2 s);
lower `TimeoutClient.standard` to 15 s once the `ensureSchoolMirrorHydrated` ratchet under
`app/api/v1` reaches 0 in Phase 4. Evidence for 30 s — Cloud Run, 7 days to 15 Oct, requests > 10 s on
`/api/v1/*`, slowest seen:

| Route | Method | Max |
|---|---|---|
| `principal/snapshot` | GET | 26 s |
| `owner/anomalies` | GET | 26 s |
| `homework/feed` | GET | 25 s |
| `comms/feed` | GET | 25 s |
| `parent/attendance` | GET | 24 s |
| `app/popups` | GET | 23 s |
| `homework/post` | POST | 46 s (slow list, 120 s) |
| `comms/unknown-logins` | POST | 35 s (added to the slow list; no app screen calls it today) |
| `profile/document` | POST multipart | 80 s (upload client, 5 min) |

Every GET stays ≤ 26 s, so 30 s covers today's cold starts. The body deadline is a Timer per
gap (not `Stream.timeout`, which FakeAsync does not drive). 120 s for
`ApiClient._slowPaths` (command desk, lesson plan, syllabus scan/import, homework post,
class-gallery complete, staff/owner broadcast, comms/unknown-logins); 5 min for multipart uploads; 30 min for the class
video PUT straight to storage. Every `http.get/post/patch/delete` and `req.send()` in
`lib/core/api/*` now goes through it. Not moved: `_aiPost` and the tutor SSE stream keep their own
per-call client (cancellable; `_aiPost` already had 150 s), and `app_update_gate.dart` (10 s, own
call). `lib/core/api/json_cache.dart` `JsonCache`: last `data` of `_cachedPaths` (parent/summary,
staff/summary, staff/features, principal/snapshot, staff/approvals, comms/feed,
transport/routes), memory + one JSON file per (scope, path) under the app support dir; scope =
flavor + SHA-256 of the session cookie (the cookie itself is never written); each file names its
owner and is ignored under any other; a reply is saved only when the scope after the call equals
the scope before it; `wipe()` on sign-out AND on every sign-in. `lib/core/api/home_refresh.dart`:
`loadCachedThenFresh` (saved copy painted unless a SUCCESSFUL answer already arrived; on failure
the screen keeps it and gets its saved-at time), `RefreshClock` (2 min), `ResumeWatcher`. All five
homes (parent, teacher, principal, desk, driver) paint the saved copy on open, re-read summary +
features (principal: snapshot + features + summary; driver: routes + features) on resume when
≥ 2 min old, and on failure with a copy show `StaleBanner` ("Couldn't reach the school — showing
what was saved at HH:MM", Hindi when the app is Hindi) instead of the error screen; with no copy
the old error screen is unchanged. `WaitingCard` paints saved counts, reads once on mount, and
re-reads only on `refreshKey` — which homes bump only when a pushed screen returns `true`
(`PopWithChanged` on staff leave, student leave, complaints, documents: true after a decision)
or on pull-to-refresh. `RunningStrip` paints the saved feed and its 10-min poll runs only while
its route is current and the app resumed (`shouldPoll`); its AnimationController is now created on
first use (it was created inside `dispose()` when the strip never showed — a debug assertion).
Gallery carousel, class-gallery 48 px thumb and review card decode via `cacheWidth`
(`core/ui/thumb_size.dart`; width only — aspect kept; the full-screen viewer stays full size).
**Proof.** `flutter analyze` clean; `flutter test` 123/123. New: `test/http_client_hygiene_test.dart`
(one client for 5 calls; 30 s header deadline — still waiting at 29 s; stalled body; command desk 120 s),
`test/home_cache_test.dart` (identity keying memory+file, owner check, wipe on sign-out and
sign-in, late reply after identity change not saved, failure keeps last good, SWR ordering,
stale label, RefreshClock, ResumeWatcher, strip under a pushed route, PopWithChanged, thumb size),
`test/staff_home_refresh_test.dart` (real `TeacherHomeScreen`: approvals once at open, not
re-read after a screen that decided nothing, resume < 2 min nothing / ≥ 2 min summary+features
again and approvals not, cold open paints the saved home within 200 ms of fake time while the
server is pending, server away keeps it with the banner, no copy → error, another cookie's copy
never painted). Fail-on-old: the old-API tests run against origin/main's `lib` fail (6 clients
for 5 calls; no timeout at 16 s or 121 s — the deadline test now checks 29 s / 31 s and fails
with the deadline removed or set back to 15 s; approvals 2 after My leave — that run needed the
RunningStrip dispose fix patched in, since old code first fails on that assertion); every other
new test fails under a named mutation (scope re-check, sign-out/sign-in wipe, identity in scope,
owner check, `!freshOk`, staleSince, 2 min, resume attach, cold paint, push bump, `shouldPoll`,
pop result, shared client, deadlines, slow path, body deadline, slack). Seen: widget-test renders
at 375 px of the five homes offline with a saved copy (banner placement fixed on teacher/parent).
**NOT done / not proven.** No device or emulator run (no APK by instruction); the 1.2f beacon
acceptance (cold paint < 200 ms on a phone, approvals ≤ 2 per session, Masters ≤ 2 min) is
post-release only. A resume never re-reads approvals or the strip (by spec), so new approvals
from others appear on pull-to-refresh, after a decision here, or on next open. Screens other
than the five homes (notices list, fees, etc.) are not cached. Gallery thumbnails were not seen
on a screen. `cacheHeight` not set (width only, to keep aspect).

### Phase 5 — Transactional desks, one desk at a time

Order (browser bytes × wipe history): **fees → homework → attendance → exams → admissions →
transport → staff attendance → staff HR → accounts → payroll → PTM → student leave → comms/news/
gallery → notifications → library → vault, statutory, RTE, trust → timetable → exam papers →
certificates → automation, WA templates → chats.** For each desk the procedure is:

1. **Inventory the server-side writers and readers first** (one PR, no behaviour change): every
   file that calls the desk's `ensure*HydratedServer`, `load<Desk>()` on the server,
   `push<Desk>RemoteServer`, or `ensureSchoolMirrorHydrated` to reach it — under `app/api/*`,
   `lib/*`, cron ticks and WhatsApp flows. The desk cannot be converted while a server writer
   still pushes a 45-second-old whole copy over kernel writes.
2. Server writers move to transactional RPCs / `{ops}` writes that bump the desk's version.
3. Screens' views get `GET /api/data/views/<desk>-<view>` endpoints (paged, scoped) and
   `useErpQuery`; mutations go through `useErpMutation`.
4. Delete the desk's `*Persistence.ts`, `*NormalizedClient.ts`, its hydrate task, its
   `ensure*HydratedServer`, its whole-desk POST (410 stub for one release) and its source-grep
   self-tests.
5. Acceptance: `counts`, `budget`, a desk-specific `propagation` case, `stale-writer`, the
   desk's ratchets at 0, and the desk's old bulk GET bytes in Cloud Run at ~0 after deploy.

**5.1 Fees (five PRs).** 5.1a inventory: `lib/paymentSettlement.server.ts:47,152`,
`app/api/payments/{cashfree,razorpay}/webhook`, `parent-pay`, `attach-gateway`,
`registration-attach`, `lib/feePayLink.server.ts`, `duePayCheckout.server.ts`,
`cashfreeRefunds.server.ts`, `receiptArchive.server.ts`, `feesDeskAncillary.server.ts` and the
rest of the ~20 `lib` files + 12 routes that read or push the server fee copy (online payment
settlement today hydrates the mirror and pushes the **entire** fee desk back with "headers
last-write-wins, ancillary replace, open-dues rebuild" — the money-side twin of the 1 Sep and
6 Sep line wipes). 5.1b migration: `fee_voucher_write(header, lines[], tenders[], base_updated_at)`
— one transaction for the 3–4 tables a receipt spans, maintains `fee_desk_open_dues` for that
student, bumps `fee_desk_sync_meta`; convert settlement, parent-pay, attach-gateway, refunds and
the bulk-payment tool to it **before any browser screen**. 5.1c the fees-vouchers POST stops
"ancillary replace" and "header LWW" (ancillary rows stamped; a header older than stored
refused). 5.1d screens: counter (`FeeTakeWorkspace`, 5,108 lines — views: search 3.2, household
dues, receipt, day book), fee setup panels, defaulters, cheques/PDC, instalments, pay links.
5.1e delete `feesPersistence.ts`, `feesNormalizedClient.ts`, the whole-desk POST, the hydrate
task. Extra acceptance: "a counter receipt row-written, then an online payment webhook replayed
from a stale copy — the counter receipt, its cheque and the day-close survive."

*(5.1a built 15 Oct 2026, PR #655 — inventory only, no behaviour change.)* **What exists.**
[`evidence/fees-inventory.md`](./evidence/fees-inventory.md): the 13 `fee_desk_*` tables with
production row counts and triggers; 18 server write paths (W1–W18) with file:line, trigger, scope,
tables and whether each can overwrite a newer row; ~25 server readers; the browser write sites
that end in the whole-desk fees-vouchers POST (for 5.1d); the `fee_voucher_write` / `fee_voucher_void`
/ `fee_voucher_mark` contract on the real columns with the caller order; risks R1–R12. Ratchet
`fee_whole_desk_push` = 12 (proved to fail at 13). **What it found that changes 5.1b.** (1) The header
upsert in `replace_fee_desk_voucher_lines` is last-write-wins on **every** column including `voided_at`:
any older copy (a browser tab, or a webhook/refund instance copy up to 45 s old) un-voids a receipt and
the ledger trigger re-posts it — 5.1b should ship a "`voided_at` never returns to null" trigger first,
which protects every old writer still running. (2) `fee_desk_open_dues` is rebuilt for the whole year
from the **instance** copy, not from what was just written: proven stale for one family today
(`RCV-00698`, 14 Oct, ₹1,800 still open in the cache; cause traced in code, not proven) — the
director can refresh it with `POST /api/fees/rebuild-open-dues`; nothing rebuilds it when Masters,
transport or adjustments change, so per-student maintenance in `fee_voucher_write` (3.2's dependency)
needs the caller to pass recomputed rows. (3) Cashfree **registration** payments make an R-receipt
that is never pushed (latent; 0 such payments in production). (4) Receipt numbers are minted from the
instance copy — allocate them in the RPC. **Production frequency** (Supabase edge logs, 8–15 Oct):
25 whole-desk pushes and 25 open-dues rebuilds for 28 receipts; ~324 whole-desk server reads a day
(`ensureFeesHydratedServer` has no TTL/probe/dedupe). **Not done / not proven.** Cloud Run logs were
not read (`gcloud` needs an interactive re-login), so the per-route split of the 25 pushes is not
measured (the query is in the evidence file); the ~15 shared `lib` files that call `loadFees()` and
are reachable from server code are listed, not traced call-by-call; `voidVoucher`'s side effects
outside the fee tables (legacy desk book, admissions revert) are not traced; R9
(`sis_merge_students` vs the append-only trigger) is read from the migrations, not tried.

**5.2 Homework** (two wipes; whole-desk unversioned; `homeworkPost.server.ts:129-141` rebuilds
the whole desk from the mirror): server writers (`homeworkPost.server.ts`, WhatsApp homework
flows) first, then `HomeworkWorkspace`, then delete `homeworkPersistence.ts` /
`homeworkNormalizedClient.ts`. **5.3 Attendance**: registers per section/date, marks per
register; server writers = WhatsApp absence flows, `attendanceDeskAncillary.server.ts` policy
write (client-clock comparison today), then `AttendanceWorkspace`. **5.4 Exams**: sheets per
term/class, marks per sheet; exam subjects linked by Masters subject id, not code. The remaining
desks follow the five-step procedure; each PR names its files from the inventories in
`evidence/write-path.md` (per-desk save table) and `evidence/hydration.md` (hydrate table).

**Staff HR · Requests (ahead of 5.8, director's "fix now, separately", 15 Oct).** *(Built 15 Oct 2026,
PR #657 — no migration.)* **Found** while seeding for PR #650: with `STAFF_HR_READ_FROM_DB` on,
`staffRequests` was neither a staff_hr desk slice nor pushed to the `staff_hr_state` blob, so a
request lived only in the browser that raised it (production, 15 Oct: blob 0 requests, last written
5 Aug; no element in `staff_hr_desk_slices`; no other table holds them). Since 10 Oct that browser
copy is page memory only (`browserStorage` purge, live), so every request raised since 5 Aug is
**unrecoverable** — there is nothing on any server and nothing a new build can reach in a browser.
**What exists.** Each request is one element of a new kernel-only list slice
`staff_hr_desk_slices.staffRequests`, written by `POST /api/staff/requests` (raise — any member of
staff, for themselves; the server sets id, staff id from the session, dates, `open` — and update —
managers only, `canManageStaffLeave` with the server's saved roles, base = the element `_rev` the
screen loaded) through `desk_slice_row_write` via `repo.writeSliceElement` (the 1.5 RPC: lock,
`_rev`, `staff_hr_desk_sync_meta` bumped in the same transaction). Read by
`GET /api/data/views/staff-requests` (handlers `lib/staffRequests.server.ts`, deps
`lib/staffRequestsDeps.server.ts`: a `referenceCache` on erp_versions `staff_hr`; manager = all,
others = own; 503 on a failed read, never empty; `versions` = built-from). `StaffRequestsPanel` reads
it with `useErpQuery(…, {desk: "staff_hr"})` + `useStaffList()` for names (no `loadMasters`, no
hydrate); a failed save shows the server's error and stays; a conflict refetches. The header
WhatsApp panel's "Raise a request" posts to the route (no longer waits for the staff_hr hydrate).
`createStaffRequestTicket` / `updateStaffRequestTicket` / `listStaffRequestsForStaff` deleted.
`deskSliceRegistry` gains `kernelSlices` (counted in `row_count`, never carried by the whole-desk
push or returned by the whole-desk read), so an old-build push neither drops requests nor is judged
a shrink. No "send to the office" button: no local copy can exist on the new build. The staff app
(Flutter) never raised these requests and calls no route for them — unaffected.
**Proof.** `test:staff-requests` (15 checks; 5 mutations — view filter off, manager check off,
base dropped, failed write reported ok, `kernelSlices` not counted — each red).
`e2e/specs/staff-requests.spec.ts`: class teacher raises from the header panel, the principal's
already-open Requests tab shows it without reload (8.5–18.2 s over four runs), resolves it, the teacher sees
Resolved, the element is at `_rev` 2; a triage from an older copy gets 409 and the newer value.
On the merge base fa637423 the first fails at "B sees it" (the teacher's screen said "Request
filed"), the second at the route (404). An old-build whole-desk push carrying `staffRequests: []`
left both stored requests and wrote `row_count` 3 = 1 leave type + 2 requests (local stack).
**Not done.** The rest of staff HR (leave, balances, appraisals) is still the replica (5.8). No
notification to the raiser when a request is resolved (as before). Not measured in production.

**Admissions · Field survey team & beats (director's report, 15 Oct).** *(Built 15 Oct 2026, PR #664 —
**migration `20261015120000_admission_survey_team_rows.sql`, the director applies it before the deploy**.)*
**Found.** "Assigned in the ERP, the app says not assigned; the app asks for a 6-digit code the ERP cannot
make." Production, read-only: Cloud Run request log of 14 Oct 21:10–21:19 UTC — 15 `admissions-desk` pushes
(all 200) whose sizes rise and fall by one team member (~190 bytes) as members were added and removed, and
**every** app call `/api/public/survey-day` answered 403 with a 456-byte response = 217 header bytes + the
239-byte `not_registered` body (the `not_on_team` body is 192): the phone was never registered, so the app
showed the pairing-code screen. The only "Pair phone" button lived in the SurveyDaysBoard, which read the team
from the server once on mount (21:10:00, empty) and never again, so it said "No survey team yet" while the
Team table above it (the browser copy) showed the member — two copies on one screen. The last pushes carried
no member (named removals), hence 0 in `ops_json`. On the local stack an add in the ERP reached the server
(1 member) — the replica did not lose this write; the defect is the second copy and the unreachable code.
**What exists.** Members and beats are rows (`admission_survey_members`, `admission_survey_beats`, ids kept
from ops_json; `admission_survey_sync_meta` → erp_versions `admission_survey`), on `desk_writable_tables`,
registry `admissions.survey-members` / `admissions.survey-beats`, written one change at a time by
`lib/surveyTeam.server.ts` (rules: pure `lib/surveyTeamPlan.ts`) through `desk_write_guarded`. Doors:
`POST /api/admissions/survey-team` (office = Admissions edit or the Field survey function: every op +
`pair_start`; a signed-in team leader: add staff, remove a staff surveyor — not self, not a leader, not an
outsider — add/edit/retire/reactivate beats), `POST /api/public/survey-day` `team`/`manage` (the leader's
phone, signed `survey|manage|<op>:<target>|ts`), `GET /api/data/views/survey-team` (referenceCache on
`admission_survey`; phones; old saved outsiders). The whole-desk push keeps ops_json's stored lists for
these two keys whatever the copy says (old builds included); the desk read takes them from the rows and
fails closed when they cannot be read. ERP: `SurveyTeamCard` / `SurveyBeatsCard` (useErpQuery, versions
poll), "Get phone code" per member with expiry countdown, copy, WhatsApp share. The survey-day board and
`/api/v1/staff/survey/*` read the rows. No-day capture: `/api/v1/staff/survey/capture` takes `location`
(map pin / GPS) → lead note with a Google Maps link + a `survey_captures` point with `survey_day_id` null
(`located_by`), listed on the board for its IST date. Staff app: no-day recording always offered, home on
the map (flutter_map + OSM: no Google Maps SDK in the app), "Other area (no beat)", leader "Manage team &
beats". Deleted: the browser-copy team/beat mutators in `fieldSurvey.ts`, the web `/field/survey` leader
beat editor (points to the app).
**Proof.** `test:survey-team-plan` (planner rules; mutations: leader check off, leader-made-leader — red).
`test:admissions-field-ops-merge` updated (copy's team/beats ignored). `e2e/specs/survey-team.spec.ts`:
ERP add → phone code from the row → phone pairs → app status sees the member and the ERP row turns "registered" (pairing moves `admission_survey`); made leader in the ERP → phone
adds a beat → principal's open screen shows it without reload (18.8 s, local stack); auth matrix (teacher 403, principal 200, stale
base 409, member/outsider/unregistered phone 403, leader limits, removed member → not_on_team); old-build push
leaves rows; no-day pin on the board. Flutter `test/survey_team_app_test.dart` (5; capture without location
sent → red).
Phones are signed exactly as the app (`e2e/surveyPhone.ts`: ECDSA P-256, `survey|action|extra|ts`, r‖s). Acceptance: erp_versions now has 38 sync_meta desks. Not proven: each e2e test failing on the merge base (the routes and screen do not exist there, so they fail at the first step by construction — not run).
**Not done.** Lead callers, survey attendance/sessions and saved outsiders remain in ops_json (replica).
The web `/survey-day` page has no leader screen. Not measured in production; app release needed for the
app parts.

### Phase 6 — Delete the replica

**6.0** Re-run the 3.0 enumeration; every non-browser caller must be on `/api/export/*`.
**6.1** Delete `browserStorage.ts` memory copies and `purgeStoredModuleCopies`,
`deskHydrationSchedule.ts`, `deskHydrateGuard.ts`, `deskLazyHydrate.ts`, `deskLoadGuard.ts`,
`createDeskSlicePersistence.ts`, `domainBlobPersistence.ts`, `moduleStatePersistence.ts` (module
books become row collections), every remaining `*Persistence.ts` and `*NormalizedClient.ts`,
`sliceRevClient.ts`, `rowStampClient.ts`, `deskStampsClient.ts`, `serialSave.ts`,
`syncRetryStatus.ts`, `deskSyncStatus.ts`, `deskNamedDeletes*.ts`, the `*Guard.ts` files whose
failure modes no longer exist, `schoolDataMirror*.ts`, `schoolMirrorRemote.server.ts`,
`.data/*.json`, and the 66 source-grep self-tests. Keep (~400 lines): `rowStampWrite.server.ts`
(legacy routes until their last caller goes), `deskProbeCache.server.ts`, `pageAll.ts`,
`lib/data/*`. Acceptance: all ratchets 0; the full `e2e` suite green; `lib/` smaller by
≥ 12,000 lines; 24 h of Cloud Run logs show no `/api/school-data/*-desk` or `sis-roster` GET
from a browser user agent; the nightly BigQuery sync green.

---

## 5. Definition of done (measurable; the director checks these, not the code)

"Today" cells marked **est.** are derived from route lists × measured per-route averages; the
first true measurement comes from `budget.spec.ts` (1.1) and the beacon (1.2).

| Measure | Today (12 Oct) | Done |
|---|---|---|
| Staff / students / classes shown on every screen | sometimes 0 | always equal the database (`counts.spec.ts` on every PR; `rendered-zero-rows` beacon = 0 in production for 7 days) |
| A Masters change visible on other open screens (web) | never without reload | ≤ 30 s, no reload (`propagation.spec.ts`) |
| A Masters change visible in the app | never without restart | ≤ 2 min on resume (4.4) |
| Encoded bytes to open `/fees`, `/students`, `/attendance` | est. 3.9 MB / 4.4 MB / 3.1 MB | ≤ 300 KB each (`budget.spec.ts`) |
| `/api/*` requests to open a page | est. 21–34 | ≤ 8 |
| Data visible on a phone (4× CPU throttle) | not measured | ≤ 2 s (`counts.spec.ts` throttled profile; beacon p95) |
| `/api/v1/principal/snapshot` avg (Cloud Run) | 5.03 s | ≤ 0.8 s |
| `/api/v1/staff/approvals` avg | 1.70 s | ≤ 0.15 s |
| Whole-tenant `sis_students` selects per day (`pg_stat_statements`) | ≈ 1,260 | ≤ instances × Masters/SIS changes that day |
| Whole-desk or whole-slice POSTs from browsers | sis, fees, homework, payments, timetable, comms, notifications, student leave, 29 module books, 13 slice modules (`evidence/write-path.md`) | 0 (ratchet + the 410 stubs' log count) |
| Replica-consistency code in `lib/` | 12,682 lines | ≤ 400 (the kept server primitives) |
| Tests that only grep source | 66 | 0 |
| Live revision traceable to a commit | no | yes (`metadata.labels.commit`), deployed by trigger within 15 min of a code merge |

---

## 6. Rules for every executor

1. **One step, one PR, one worktree.** Branch from `origin/main`. Never edit the shared main
   checkout. Never base on another unmerged branch.
2. **The named acceptance test is the definition of done.** If it cannot be made to pass, say
   so and stop; do not weaken the test.
3. **Measure before and after.** Every step that touches a route or a screen reports the
   relevant §5 line from the e2e run and, after deploy, from production logs using
   `evidence/production-measurements.md`.
4. **Never write production from a laptop.** Tests run on the 1.0 stack only. `apps/web/.env.local`
   is production; a read-only dev server is fine, a test that saves is not. 4b: the e2e stack
   writes its own `.env.e2e` and asserts `127.0.0.1` before any test runs.
5. **Do not add a guard, a merge function or a client-side copy.** Server-side caches must be
   keyed on `erp_versions` (never a wall-clock TTL alone) and live in `lib/data/`; React Query's
   `staleTime` is the only client TTL. If a step seems to need a new `*Guard.ts`, a new
   `ensure*`, a new `bhb-*` event or a new merge, the step is being done inside the replica —
   stop and re-read §3.
6. **Delete as you go.** A converted screen's old loader call, listener and hydrate are removed
   in the same PR; the ratchet must fall.
7. **Report honestly.** "Done" means the test is green in CI and the numbers moved. List what
   was skipped.
8. **Migrations.** A step that adds one names it in the PR title; the director applies it to
   production and confirms before merge; code fails closed when its RPC or table is missing.
9. **Frozen files.** §7.3 is delete / no-op only, with the §0 exception.

---

## 7. Reference

### 7.1 First check for any "not showing" report

```bash
curl -s https://bhbinternational.school/api/app-version
gcloud run services describe school-erp-web --region asia-southeast1 --format="value(status.traffic[0].revisionName)"
gcloud run revisions describe "$(gcloud run services describe school-erp-web --region asia-southeast1 --format='value(status.traffic[0].revisionName)')" --region asia-southeast1 --format='value(metadata.labels.commit)'
git log --oneline origin/main -1
```
If the live commit is older than the fix's merge, the report is about code that does not
contain the fix (PR #578 on 12 Oct). Deploy first, then ask for a hard reload (until 0.5g makes
stale tabs reload themselves). After 0.3, manual `deploy-online.sh` runs are not allowed.

### 7.2 Existing pieces to build on (what each really is)

| Piece | Where | Reality | Use in |
|---|---|---|---|
| typed data kernel | `lib/data/types.ts` (`WriteOp`, `Revision`, `ReadFail` with no `rows`), `lib/data/registry.ts` (10 collections: `sis.students`, `sis.households`, `udise.*`, `site.*`, `admissions.leads`), `lib/data/server/repo.ts` (keyset `list()`, `write()` → `desk_write_guarded`), `lib/data/approvalGate.ts`, `lib/data/client/{query,mutate,useSaveMutation}.ts` | live code with a `{ops}` contract; no screen consumes it yet | 1.4, 1.5, 3.1, 3.4 |
| generic data route | `app/api/data/[collection]/route.ts` | GET keyset list, POST `{ops}`; header forbids whole-state bodies | R4 |
| row CAS RPC | `supabase/migrations/20260810010000_desk_write_guarded.sql`, `20260810050000_…`, v3 `20261014220000_…` | v3 (1.5): refuses a null base on an existing row, all-or-none, bumps the table's sync_meta; slice elements via `desk_slice_row_write` / `desk_slice_object_write` | 1.5 |
| paged reads | `lib/supabase/pageAll.ts` (`fetchAllPages`, `fetchByIds`) | | 1.3, 3.x |
| probe-gated response cache | `lib/deskProbeCache.server.ts` (`cachedDeskJson`, `deskProbe`) | `desk_probe` RPC has a fixed allowlist of data tables (`20261009090000_desk_probe_transport.sql:19-36`) with **no sync_meta, rbac or module-registry tables** and fails open on an unlisted name (9 Oct incident) | 0.5f; **not** for versions |
| slice lock + all-or-none | `supabase/migrations/20261010220000_masters_write_slices.sql` (`for update`, base = slice `updated_at`, bumps sync_meta, then `masters_sync_rows_from_slices`) | the pattern `desk_slice_row_write` copies | 1.5 |
| `lib/sliceCas.server.ts` | a TypeScript read→compute→`update … eq(updated_at)` retry loop, not a lock, not callable from SQL | replaced by the RPCs | — |
| per-row stamped writes | `lib/rowStampWrite.server.ts` (`UPDATE … WHERE updated_at = stamp`) | legacy routes only; no sync_meta bump | kept until Phase 6 |
| session cookie | `bhb_demo_session`, `signSession(session)` in `lib/sessionCookie.server.ts:58`, `DemoSession` in `lib/auth.ts:5-16` | | 1.0 logins |
| local database rehearsal | `scripts/rehearse-migrations.sh` (bare PG17, no PostgREST; `supabase/migrations` only, so 2 of 362 fail — see 1.0) | migration rehearsals only — the app cannot run against it | — (1.0 builds `scripts/e2e-stack.sh` on the same shim) |
| deploy trigger config | `cloudbuild.deploy-on-merge.yaml`, `scripts/setup-deploy-on-merge.sh` | never created; smoke test only checks `/login` | 0.3 |
| ratchets | `scripts/check-ratchets.sh` (one `case` per metric) + `scripts/ratchets.txt` (budgets) | | 1.6 |
| change-signal sources | 35 `*_sync_meta` tables in production (`sis_sync_meta`, `masters_desk_sync_meta`, …); none for staff, module books or blobs | hence `erp_versions` | 1.3 |

### 7.3 Frozen files (delete / no-op only until Phase 6; §0 exception)

`apps/web/src/lib/*Persistence.ts`, `*NormalizedClient.ts`, `deskHydrationSchedule.ts`,
`deskHydrateGuard.ts`, `deskLazyHydrate.ts`, `deskLoadGuard.ts`, `browserStorage.ts`,
`createDeskSlicePersistence.ts`, `domainBlobPersistence.ts`, `moduleStatePersistence.ts`,
`sliceRevClient.ts`, `rowStampClient.ts`, `deskStampsClient.ts`, `serialSave.ts`,
`syncRetryStatus.ts`, `deskSyncStatus.ts`, `deskNamedDeletes*.ts`, `*Guard.ts`,
`schoolDataMirror*.ts`, `schoolMirrorRemote.server.ts`, `components/shell/CoreDataGate.tsx`.

### 7.4 Inventories (in `evidence/`)

- `read-path.md` — every loader's per-read cost; screen → loads per mount; the read-once list.
- `hydration.md` — all 77 `ensure*Hydrated` functions (dedupe / mark order / snapshot-before-await
  / wipe-on-empty / push-during-hydrate); what runs on first load per route.
- `write-path.md` — per-desk save inventory (what is sent, version mechanism, server merge);
  probe-cached routes vs the tables their bodies read.
- `server-cost.md` — every `school-data` GET's server cost; mobile routes' per-request work; fixed
  per-request costs.
- `mobile-app.md` — every request each home screen fires; timers; the no-data-layer facts.
- `propagation.md` — the hop-by-hop trace of a Masters edit; the picker-screen table.
- `fees-inventory.md` — 5.1a: every server reader/writer of the fee desk, table counts, the
  `fee_voucher_write` contract, the 5.1 risks.
- `history.md` — the 98 fixes classified; recurrence; what is live.
- `harness.md` — what the 455 tests can and cannot see; the guard inventory with line counts.
- `production-measurements.md` — the numbers and the queries to re-measure.
- `review-v1.md` — the three critiques of v1 that produced this version (what changed and why).
