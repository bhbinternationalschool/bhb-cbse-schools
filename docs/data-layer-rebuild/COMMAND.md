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
as an expected failure (XFAIL) that turns red the day it is fixed. CI: job `e2e-stack`
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

**1.3 Server read kernel.** New migration `erp_versions(p_tenant uuid) returns jsonb`
(SECURITY DEFINER, `service_role` only — remember the explicit grant) that returns, in one round
trip, `{<desk>: {updated_at, count}}` for every `*_sync_meta` table (read the list from
`information_schema` at creation time; verify against §0.6) plus `max(updated_at)` of
`sis_staff`, `sis_departments`, `sis_designations`, `masters_desk_settings`, per-module
`module_local_state`, and each `*_state` blob table. `GET /api/data/views/versions` serves it,
cached in-process for 2 s, and returns `ok:false` (not `{}`) when the RPC fails.
`lib/data/server/referenceCache.ts`: `referenceCache(name, deskKey, build)` — per-process,
in-flight-deduped, rebuilt only when that desk's `erp_versions` value moved, previous value kept
with `stale:true` when a rebuild fails, never an empty value from a failed read. Convert
`loadServerMasters` / `mastersCache` and `loadServerRbac` (`lib/api/v1/auth.ts:55-224`) to it in
this PR (they are the code it replaces; the `defaultMasters()` fallback was deleted in 0.5c).
Acceptance: unit tests on the local stack — cold instance = one read; version moved = rebuild;
failure = previous value + `stale:true`; `versions` answers in < 50 ms warm with one DB request
per poll.

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

**1.6 Ratchets.** `scripts/check-ratchets.sh` defines each metric in a `case` block and
`scripts/ratchets.txt` carries the budget — add both for: `loadMasters(` files in
`components/` + `app/(erp)/` (today 109), `loadSis(` (77), `ensure[A-Za-z]+Hydrated(` in
components (70), `readCache(` files in `src` (69), `readFileSync` inside `*.selftest.ts` (66),
`ensureSchoolMirrorHydrated` files under `app/api/v1` (100), and two **all-of-src** counts used as
the Phase 2.3b / 3.4 gates: `loadMasters(` occurrences (476) and `loadSis(` occurrences (426),
selftests and definitions excluded. Acceptance: CI fails when any count rises.

**1.7 Teacher scope from SQL (own step; 3.1 and 4.2 depend on it).** `staffSectionScope`
(`lib/api/v1/staffScope.ts:77-96`) computes sections from `sis_staff.profile` links **and
timetable rows read from `timetable_desk_slices` on the server** (today it awaits a timetable
hydrate whose result is always empty on the server, `lib/timetable.ts:471`), cached per request.
The sis-roster teacher branch answers `{ok:true, scoped:true, sections:[…], students:[…]}` so
"no sections" is distinguishable from "unknown". Acceptance: `teacher.spec.ts` passes, including
the timetable-only teacher.

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

**5.2 Homework** (two wipes; whole-desk unversioned; `homeworkPost.server.ts:129-141` rebuilds
the whole desk from the mirror): server writers (`homeworkPost.server.ts`, WhatsApp homework
flows) first, then `HomeworkWorkspace`, then delete `homeworkPersistence.ts` /
`homeworkNormalizedClient.ts`. **5.3 Attendance**: registers per section/date, marks per
register; server writers = WhatsApp absence flows, `attendanceDeskAncillary.server.ts` policy
write (client-clock comparison today), then `AttendanceWorkspace`. **5.4 Exams**: sheets per
term/class, marks per sheet; exam subjects linked by Masters subject id, not code. The remaining
desks follow the five-step procedure; each PR names its files from the inventories in
`evidence/write-path.md` (per-desk save table) and `evidence/hydration.md` (hydrate table).

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
| row CAS RPC | `supabase/migrations/20260810010000_desk_write_guarded.sql`, `20260810050000_…` | applies ops with base checks; **accepts null base; bumps no sync_meta; hard-deletes** — fixed in 1.5 | 1.5 |
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
- `history.md` — the 98 fixes classified; recurrence; what is live.
- `harness.md` — what the 455 tests can and cannot see; the guard inventory with line counts.
- `production-measurements.md` — the numbers and the queries to re-measure.
- `review-v1.md` — the three critiques of v1 that produced this version (what changed and why).
