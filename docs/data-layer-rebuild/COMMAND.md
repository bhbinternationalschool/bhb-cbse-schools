# The data-layer rebuild — the command

**Status:** approved plan, 12 Oct 2026. Written after an eight-lens investigation of
origin/main `2f0eb3d4` and the live revision `school-erp-web-00856-bdn`, plus production
measurement (Cloud Run logs, Supabase edge logs, `pg_stat_statements`). Evidence with
file:line citations is in [`evidence/`](./evidence/); production numbers in
[`evidence/production-measurements.md`](./evidence/production-measurements.md).

**Who this is for.** The director reads §1–§3 and §6. A model executing a step reads §0,
§3, its own step in §4, and §7 — nothing else is needed to start.

---

## 0. How to use this document

For the director:

- Give an executor **one step** at a time, by number (e.g. "do step 2.3 of
  docs/data-layer-rebuild/COMMAND.md"). Steps inside a phase are ordered; phases are ordered.
- Merge a step only when its **acceptance test** (listed under the step) is green in CI.
  Not "the model says it works" — the named test.
- A report that something is "still not showing" is answered first with the build
  check in §7.1, before anyone reads code.
- Until Phase 6 is done, **no PR may touch** `apps/web/src/lib/*Persistence.ts`,
  `deskHydrationSchedule.ts`, `deskHydrateGuard.ts`, `browserStorage.ts` or any `*Guard.ts`
  except to delete code (§7.3). Symptom patches on the replica are over.

For an executor (a Claude session of any size):

```
You are executing step <N.M> of docs/data-layer-rebuild/COMMAND.md in this repo.
Read §0, §3, step <N.M> and §7 of that file first. Do only that step.
Work in a fresh worktree branched from origin/main. One PR per step, titled
"data-layer <N.M>: <goal>". The acceptance test named in the step must exist
and pass in CI before you report done. Report: what changed, the test output,
the before/after numbers the step asks for, and anything you could not do.
Never run apps/web/scripts/*.ts (they write production). Never start a dev
server against apps/web/.env.local for a test that writes.
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
| S1 | "sometimes staff is not showing" | The Masters hydrate snapshots the page copy, awaits the network, and writes the snapshot back — erasing the staff roster the parallel staff hydrate just wrote. Fixed as PR #578 (third time: 18 Aug, 19 Sep, 12 Oct) and **not deployed**: live rev 00856 = PR #577. Also: CoreDataGate releases the page after 5 s without staff; 63 screens read Masters once on mount and never again. | `lib/mastersPersistence.ts:150-171` (live :163), `components/shell/CoreDataGate.tsx:31-55` | hydration, history, harness |
| S2 | "students are not loading" | The roster hydrate never announces itself (`bhb-sis-updated` fires only on an edit); screens that read `loadSis()` in a mount effect keep the empty copy. An empty-but-200 roster is accepted as fact on every fresh page. For teachers the server scope is computed from a timetable copy that is always empty on the server. | `lib/sisPersistence.ts:261-358`, `lib/sis.ts:1680-1708`, `lib/api/v1/staffScope.ts:77-96` + `lib/timetable.ts:471` | read-path, hydration, server-cost |
| S3 | "changes in Masters do not reach modules" | There is no server→client change signal of any kind (no realtime, no versions poll, no ETag round trip, no refetch on focus). Route hydration runs **once per tab** (`AppShell.tsx:220 if (bootReady) return`). After that a desk is re-read only when one of 13 screens calls `ensureMastersHydrated` after a 15 s TTL. Only 8 component files listen to `bhb-masters-updated`. Other tabs and other devices hold the morning's Masters until a full reload. | `components/shell/AppShell.tsx:205-270`, `lib/deskHydrateGuard.ts:6-27`, `lib/deskHydrationSchedule.ts:361-368` | propagation, write-path |
| S4 | "slow loading" | Every page downloads whole modules (sis-roster 1.9 MB, fees 1.5 MB, attendance 0.7 MB, masters 235 KB — none ever 304). Every `loadMasters()` JSON-parses and re-normalises the whole desk; every `loadSis()` calls `loadMasters()`, parses 1.9 MB, normalises 713 students, **re-serialises the whole roster to compare strings**, and may write Masters and dispatch events — on every read, from 484 + 430 call sites, including per keystroke in the search bar and 713× per home-dashboard tick (`computeStudentDues` re-parses transport per student). Any row conflict re-downloads **every** desk (`ensureAllDeskHydrated`). p99 of desk GETs is 11.9 s on a 1-vCPU, min-instances-0 service with 126 cold starts a day. | `lib/sis.ts:1578-1660`, `lib/masters.ts:2015-2060`, `lib/sliceRevClient.ts:180-195`, `lib/fees.ts:2358`, `components/shell/UniversalSearchBar.tsx:101-244` | read-path, hydration, server-cost |
| S5 | "classes and subjects vanish" | Same as S3 plus: a failed Masters read is served as `ok:true` with zero classes and marked hydrated (latent, not seen in 7 days of logs); the mobile API caches a failed Masters read as "no classes" for 30 s and falls back to demo Masters with random ids; teacher phones push the class-subject slice from a snapshot ~20×/day ("function-only push"), ~25 "unversioned push accepted (legacy client)" a day, 1–2 refused empty-Masters pushes a day. | `app/api/school-data/masters-desk/route.ts:176-188`, `lib/api/v1/auth.ts:189-224`, Cloud Run app logs 8–10 Oct | hydration, propagation, write-path |
| S6 | "the app slows down" | The Flutter app has no cache and paints a spinner until the server answers; the server answers one person's question by rebuilding whole modules per request with no TTL: `principal/snapshot` runs seven whole-desk hydrates (5.03 s avg), `staff/approvals` re-pages the roster + timetable + leave + complaints on every return to the home screen (1.70 s), `app/popups` loads all 717 students to find one household. Supabase sees 3,525 full roster reads and 7,904 attendance-mark page reads a day against 205 browser roster downloads. Each of 63 instances a day starts cold with empty copies. | `lib/principalSnapshot.server.ts:77-85`, `lib/sisPersistence.ts:361-374`, `lib/schoolMirrorRemote.server.ts:84-247`, `cbse_school_mobile/lib/core/api/api_client.dart:3243-3311` | server-cost, mobile-app |

Three facts make this a system problem rather than six bugs:

1. **98 data-layer fixes since 1 Aug (119 PRs), 66 % of them follow-ups to an earlier fix
   of the same class on another desk.** Prune-by-absence was fixed on seven desks over nine
   weeks before the 18-desk series of 9 Oct; browser quota eight times before PR #526 moved
   copies to memory — which created the read-once / placeholder / lost-update wave of 10–12
   Oct (#569, #570, #571, #578) within 72 hours. See `evidence/history.md`.
2. **12,682 lines of replica-consistency code** (47 persistence files, 77 hydrate functions,
   a dozen guards, revisions, stamps, CAS, named deletes, serial saves) and 6,052 lines of
   their tests — of which 66 tests assert on **source text** with `readFileSync`, including
   the only test of the #578 race. Zero tests render a screen, run two clients, or measure a
   payload. A PR can be entirely green while the screen behaviour is unchanged. See
   `evidence/harness.md`.
3. **The project already diagnosed this on 10 Aug** (`docs/ENTERPRISE_UPGRADE_PLAN.md:43-47`,
   `docs/TODO.md` Phase 1: unified data-access layer, delta pushes, two-device convergence
   exit test) and never built it. Every week since has been spent on the replica instead.

The old ERP the director compares against (SStudy: server-truth, ~5 KB per screen call,
160 ms) does not have these problems because it does not have copies.

---

## 2. Why another round of guards cannot end it

A guard checks one write against one copy. It cannot know that another copy exists, that a
screen already read the old copy, or that a copy was built from a failed read. Making copies
converge needs a real synchronisation engine (server-driven subscriptions or CRDTs) with
instruments to prove convergence — this project has neither, and does not need them: the
school has 35 staff, ~250 current students, and a 60 KB Masters. Nothing here needs offline
copies. The cheapest correct system is the one the old ERP already is: **the server answers
each screen's question from SQL, the browser keeps a short-lived query cache, and every
write is one row with a version check.**

What must become impossible, by construction:

| Replica failure | Made impossible by |
|---|---|
| lost update after an await (S1) | no client-side merge exists; a write is one row to the server |
| screen read the copy before it landed (S1/S2/S5) | screens subscribe to a query, they never "read once" |
| copies never learn of changes (S3/S5) | one versions signal invalidates every subscriber within 30 s; refetch on focus |
| multi-MB downloads and parse-per-read (S4) | per-screen endpoints return the rows the screen shows; one parse per response |
| server copies rebuilt per request (S6) | server routes query SQL scoped to the request; no process mirror |
| failed read becomes a copy (S2/S5) | a query is `loading | error | data`; an error never renders as zero rows |
| stale phone pushing old Masters (S5) | no whole-slice pushes from the browser; row writes carry `updated_at` and are refused when stale |

---

## 3. The target architecture — seven rules

These are the law for every PR from now on. They are enforced by ratchets (§4.1.6) so a
model cannot drift back.

**R1 — The server is the only truth.** No module copy lives in the browser or in a Cloud
Run process. The only client-side state is React Query's cache (short `staleTime`,
invalidated by R3) and form state.

**R2 — Screens read through one hook, scoped to what they show.**
`useErpQuery(key, path)` → `GET /api/data/<view>?…` returns only the rows and columns the
screen renders (paged ≤ 200 rows, server-filtered by year/class/section/query). Reference
data — masters, staff list, rbac, module registry — are the only whole-desk reads, through
`useMasters()`, `useStaffList()`, `useRbac()`, and are read-only on the client.

**R3 — One change signal.** `GET /api/school-data/versions` returns `{desk: updated_at}` for
every `*_sync_meta` row (35 tiny rows, probe-cached). The client polls it every 20 s and on
tab focus; a moved version invalidates that desk's query keys. Every server write already
bumps its `*_sync_meta.updated_at`; a write that does not is a bug.

**R4 — Writes are single rows with a version.** `useErpMutation` → `POST /api/data/<collection>`
with `{row, baseUpdatedAt}`; the server does `UPDATE … WHERE updated_at = base` (the
`rowStampWrite.server.ts` / `desk_write_guarded` pattern that already exists) and returns
the new row; on a mismatch the client refetches and tells the person. For data stored inside
a `*_desk_slices` jsonb array, one generic RPC `desk_slice_row_write(desk, slice, row, base_rev)`
locks the slice, replaces/inserts/deletes **one element** by id, bumps `_rev` and
`sync_meta`. No whole-desk or whole-slice POST leaves the browser, ever.

**R5 — The server answers from SQL, not from a copy.** An API route reads the tables it
needs with the request's scope in the `WHERE` clause (`household_id`, `student_id`,
`section_id`, `academic_year_code`). Reference data is served from a per-process cache keyed
on `masters_desk_sync_meta.updated_at` (probe), with an in-flight promise so a cold instance
reads it once. `ensureSchoolMirrorHydrated`, `.data/school_mirror.json` and every
`ensure*HydratedServer` are deleted by Phase 6.

**R6 — Unknown is never empty.** A read failure is `{ok:false}` → the query is in `error`
state → the screen shows "could not load, retry". A `200` with zero rows for a tenant whose
`sync_meta` count says otherwise is a server bug caught by the versions endpoint (counts
travel with versions). `defaultMasters()` and every `seed*IfEmpty` are deleted.

**R7 — Nothing ships without a behavioural gate.** The Playwright suite (§4.1.1) runs on every
PR against a seeded local database: counts equal the database, a Masters change made in
context A appears in context B within 30 s, every page stays under its byte and request
budget. Text-grep self-tests are lint, not proof.

---

## 4. Phases and steps

Order is mandatory inside a phase. Each step is one PR. "Executor brief" is the prompt to
hand a model, verbatim, together with the header in §0.

### Phase 0 — Today, no code (director + one small session)

**0.1 Deploy main.** Live is PR #577; the Staff-0 fix (#578) is merged and not running.
Run `scripts/deploy-online.sh` from a clean `git archive origin/main` export (the
`erp-production-deploy` recipe). Verify with `curl https://bhbinternational.school/api/app-version`
changing and the Staff page showing 34 on a hard-reloaded browser.

**0.2 Stop the cold-start storm.** `gcloud run services update school-erp-web --region asia-southeast1 --min-instances=1`.
Then put `--min-instances=1` into `cloudbuild.yaml` (today it says 0; every deploy resets it).
Cost ≈ US$8–10/month idle. This alone removes most of the 126 cold rebuilds a day.

**0.3 Create the deploy-on-merge trigger** that the docs claim exists: run
`scripts/setup-deploy-on-merge.sh`; confirm `gcloud builds triggers list` shows it; add
`--labels=commit=$COMMIT_SHA` to the `gcloud run deploy` step so a revision names its commit.
Until this exists, "merged" means nothing to users.

**0.4 Freeze the replica.** Tell every session: no edits to the files in §7.3 except deletions.

### Phase 1 — The kernel (one executor, ~5–8 sessions; nothing user-visible yet)

**1.1 The gate that can see the symptoms.**
Add Playwright (`apps/web/e2e/`), a seeded local database for tests
(`scripts/e2e-db.sh`: the throwaway local PG17 + Supabase shim from the migration rehearsal
recipe, migrations applied, fixtures = 15 classes, 13 sections, 44 subjects, 34 staff, 250
students in `2026-27`, 1 office login, 1 teacher login), and a CI job `e2e` that builds,
starts `next start` against it and runs:
- `counts.spec.ts` — open `/staff`, `/students`, `/masters`, `/attendance`, `/timetable`,
  `/homework` as office; assert staff = 34, students = 250, classes = 15, subjects = 44 **from
  the DOM**, within 5 s, on desktop and on a 375 px viewport with CPU throttling 4×.
- `propagation.spec.ts` — context A adds subject "Computer" to Class 5; context B (open on
  `/homework` since before the edit, no reload) shows it in the picker within 30 s; same for
  a staff record and a section rename.
- `teacher.spec.ts` — teacher login sees exactly her sections' students on `/attendance` and
  `/students`, never zero, never the whole school.
- `budget.spec.ts` — per page: ≤ 8 API requests on open, ≤ 300 KB transferred (gzip), no
  single response > 150 KB except explicit exports. Fails on regression.
- `error.spec.ts` — with the API forced to 503 for masters, the page shows "could not load /
  retry", not empty pickers.
Acceptance: the job runs on this PR and **fails** on today's code for `propagation` and
`budget` (prove the gate sees the disease), passes `counts` on desktop. Record which specs
fail; they are the scoreboard for the phases below.
> Executor brief: build the e2e harness described in step 1.1. Do not fix the app to make
> specs pass; the point of this step is a gate that fails today. Use the local PG recipe in
> memory/docs (`erp-fresh-db-migration-rehearsal`), never the production database.

**1.2 Observability.** (a) Every browser `fetch` to `/api/*` sends `X-Bhb-Build` (the
`.next/BUILD_ID`); the server logs it. (b) `POST /api/client-metrics` (sampled 1-in-5,
`navigator.sendBeacon`): `{build, route, event, ms, bytes, rows}` for `page-ready`,
`query:<key>` durations, `rendered-zero-rows:<screen>`, and `query-error`. (c) A Cloud
Logging-based query in `evidence/production-measurements.md` style that prints p50/p95 of
`page-ready` per route per build. Acceptance: a dashboard query shows the numbers for the
office PC and a phone within an hour of deploy.

**1.3 Server read kernel.** `lib/data/readKernel.server.ts`:
`tenantSelect(table, columns, filters, {page})` (always paged through `fetchAllPages` /
`fetchByIds`; never `select('*')` for a screen), `referenceCache(name, probeTables, build)`
(per-process, in-flight deduped, keyed on `desk_probe` of the named tables — the existing
`deskProbeCache.server.ts` primitive), and `GET /api/school-data/versions` (R3) returning
`{sis:{updated_at,count}, masters:{…}, staff:{…}, …}` from the 35 `*_sync_meta` tables plus
`sis_staff` max(updated_at), probe-cached 2 s. Delete the disk mirror on Cloud Run
(`schoolDataMirror.server.ts` `diskPersist` → no-op when `NODE_ENV=production`). Acceptance:
unit tests for the cache (cold instance = one read; probe change = rebuild; failure = previous
value kept and `ok:false`, never empty), and `versions` returns within 50 ms warm.

**1.4 Client query kernel.** Add `@tanstack/react-query`; `QueryClientProvider` in
`AppShell`; `lib/data/useErpQuery.ts` (`useErpQuery(key, path, {desk})`), `useErpMutation`,
`useVersionsPoll()` (20 s + `visibilitychange→visible`, invalidates by `desk`), and the
reference hooks `useMasters()`, `useStaffList()`, `useRbac()`, `useModuleRegistry()` reading
`/api/data/masters`, `/api/data/staff-list` (redacted list: id, name, code, designation,
department, status, links), `/api/data/rbac`, `/api/data/module-registry`. `staleTime` 60 s;
`refetchOnWindowFocus` true; `retry` 2 with backoff; errors surface through one `<QueryError>`
component. Acceptance: a demo screen `/__kernel` (dev-only) lists classes via `useMasters()`,
and `propagation.spec.ts` passes for that screen in two contexts.

**1.5 Write kernel.** `/api/data/<collection>` row write (the inert Stage-1 route) wired to
`rowStampWrite.server.ts` for row tables and to a new RPC `desk_slice_row_write` for
jsonb-slice desks (migration + explicit `service_role` grant; rehearse on the local DB first).
Every write bumps `*_sync_meta.updated_at`. `useErpMutation` invalidates the desk's keys on
success and refetches + toasts on `409`. Acceptance: two Playwright contexts edit the same
subject; the second gets the conflict toast and sees the first's value; `sync_meta.updated_at`
moved.

**1.6 Ratchets.** Add to `scripts/ratchets.txt` (the existing count-only-falls mechanism):
`loadMasters(` in `components/` + `app/(erp)/` (today 109 files), `loadSis(` (today ~90),
`ensure[A-Za-z]+Hydrated(` in components, `JSON.parse(readCache(`, `fetch("/api/school-data/`
in components, `readFileSync` inside `*.selftest.ts` (today 66 — these are lint; new ones are
refused). Acceptance: CI fails when any count rises.

### Phase 2 — Reference data: fixes S1, S3, S5 on the web (~3–5 sessions)

**2.1 Pickers read `useMasters()` / `useStaffList()`.** Convert every component that reads
`loadMasters()` for classes/sections/subjects/teachers/fee heads — the 109 files listed in
`evidence/propagation.md` (picker table) and `evidence/read-path.md` (read-once list) — to the
hooks. Mechanical rule: a `useState(loadMasters())` / `useEffect(() => setMasters(loadMasters()))`
pair becomes `const { data: masters } = useMasters()`; render the loading/error state from
the hook; delete the mount-time read, the `bhb-masters-updated` listener and the
`ensureMastersHydrated` call. Do it in batches of ~10 files per PR, highest-traffic screens
first: Attendance, Timetable, Homework, Students, Staff/Allocate teaching, Exams, Fee Take,
Masters, Teaching, PTM. Acceptance per batch: `propagation.spec.ts` and `counts.spec.ts` pass
for every screen in the batch; the `loadMasters(` ratchet count falls by the batch size.

**2.2 Masters editing writes rows.** `MastersWorkspace` and its panels write through
`useErpMutation` to `desk_slice_row_write` (one subject, one class-subject link, one section at
a time); delete `saveMasters()`'s whole-book push path, `mastersSectionSave`, the function-only
push branch of `masters-desk/route.ts` (teacher phones never push Masters again; their
subject requests already go through PR #520's request flow). Acceptance: the Cloud Run log
lines `function-only push by stf_` and `unversioned push accepted` stop; `propagation.spec.ts`
passes end to end through the real editor.

**2.3 Remove masters/staff/rbac/moduleRegistry from the hydration schedule and CoreDataGate.**
With every reader on hooks, delete the four `CORE_IDS` tasks, `CoreDataGate` (React Query's
loading state replaces it), `useAccessData`'s desk listeners (it reads `useRbac()` +
`useStaffList()`), and the `bhb-masters-updated` / `bhb-rbac-updated` events. Acceptance: the
`ensure*Hydrated` ratchet falls by 4; `counts.spec.ts` on the 375 px throttled profile shows
classes/staff within 2 s.

### Phase 3 — Students: fixes S2 and most of S4 (~5 sessions)

**3.1 Per-screen student endpoints.** `GET /api/data/students?ay=&class=&section=&status=&q=&page=`
returns the list projection (id, admission no, name, class, section, roll, household id,
guardian name, phone, status, photo key) — ≤ 200 rows a page, year-scoped **by default**
(one row per child: the 717-row table holds 4 academic years; `evidence/production-measurements.md`).
`GET /api/data/students/:id` returns the full record for the form. `GET /api/data/households/:id`
returns one family with its children. Teacher sessions are scoped in SQL from
`classTeacherLinks` + `subjectTeachingLinks` + **timetable rows read from
`timetable_desk_slices` on the server** (today the server's `loadTimetable()` is always empty,
so timetable-only teachers get no sections — `evidence/server-cost.md` §4). Acceptance:
`teacher.spec.ts` passes; p95 of `/api/data/students` < 300 ms on the local DB.

**3.2 Fee counter search on the server.** `GET /api/data/fee-search?q=` returns ≤ 40 matches
with dues from `fee_desk_open_dues` (the table exists and is maintained) and transport dues
from one query — replacing `searchFeeStudents` + `computeStudentDues` in the browser (which
parse the roster and the transport desk per result). Acceptance: `budget.spec.ts` for `/fees`
passes (today it downloads 3+ MB); search results within 400 ms on the throttled phone profile.

**3.3 Convert the student readers.** The ~90 component files that call `loadSis()` (`evidence/read-path.md`
tables) move to `useErpQuery` against 3.1/3.2 — Students workspace and its 9 sub-panels,
Attendance register roster, Homework parent contacts, Fee panels' student pickers, PTM, RTE,
Events, Certificates, Library, WA pickers, Exams rosters. Same batch rule as 2.1. The whole-roster
`sis-roster` GET stays only for exports and the UDISE robot, behind an explicit `?export=1`.
Acceptance per batch: `counts.spec.ts` + `budget.spec.ts` for the batch's screens; the
`loadSis(` ratchet falls.

**3.4 Student writes.** Student form and bulk actions write single rows through
`useErpMutation` → `sis_students` with `updated_at` CAS (the `sis_push_guarded` RPC already
does per-row version checks; call it with one row). Delete `saveSis()`'s whole-roster push and
`alignSisToMasters`'s read-time rewrite (it silently re-files children into a class's first
section when a copy is stale — `evidence/propagation.md` §2). Acceptance: two contexts edit two
different students concurrently; both persist; a stale edit of the same student gets the toast.

### Phase 4 — Mobile API: fixes S6 (~4–6 sessions, can run in parallel with Phase 3)

**4.1 Per-person queries.** Rewrite, in this order, each route to read SQL scoped to the
caller and nothing else, with timings logged per phase (auth / query / build):
`app/popups` (one household's children by `household_id`), `parent/attendance` (marks by
`student_id` and date range), `parent/summary`, `homework/feed` (posts by section ids), `comms/feed`
(latest N notices), `staff/approvals` (counts by `status='pending'` and scope, no desk
hydrates), `staff/summary`, `staff/features`, `principal/snapshot` (one SQL function
`principal_snapshot(tenant, ay, today)` returning the aggregates the screen shows; cache its
result per process for 30 s keyed on the versions probe). Reference data via `referenceCache`
(1.3). Acceptance: on the local DB each route p95: popups < 100 ms, attendance < 150 ms,
summary < 300 ms, approvals < 150 ms, snapshot < 800 ms; `ensureSchoolMirrorHydrated` call
count under `app/api/v1` falls from 200 files to 0 (ratchet).

**4.2 Teacher scope from SQL.** `staffSectionScope` computes sections from `sis_staff.profile`
links and `timetable_desk_slices` rows read on the server (fixes the empty-grid bug) and is
cached per request. Acceptance: a teacher whose only link is the timetable sees her sections in
the app and on the web.

**4.3 WhatsApp webhook off the request path.** The webhook verifies, stores the inbound row,
returns 200 in < 300 ms, and a Cloud Tasks (or `/api/wa/process` self-call with a job guard)
does the bot work; `ensureWabaWebhookSubscription` runs once per process. Acceptance:
webhook p95 < 500 ms in Cloud Run logs; bot replies unchanged in the WA self-tests.

**4.4 Flutter client hygiene.** One long-lived `http.Client` with keep-alive; 15 s timeout on
every call; a tiny JSON cache (path → last body, in memory + file) so every home paints the
last payload instantly and refreshes in the background; refetch summary/features on resume if
older than 2 min; `WaitingCard` refreshes only when a pushed screen returns `true`; `RunningStrip`
polls only while the home route is current. Acceptance: cold open of the staff home paints
cached data < 200 ms; the approvals call count per session drops to ≤ 2 (telemetry 1.2).

### Phase 5 — Transactional desks, one PR per desk (~10–15 sessions)

For each desk, in this order (traffic × pain): **fees → attendance → homework → admissions →
exams → transport → staff attendance → staff HR → accounts → payroll → PTM → student leave →
comms/news/gallery → notifications → library → vault/statutory/RTE/trust → timetable → exam papers
→ certificates → automation/WA templates → chats**:

1. Enumerate the desk's screens and the exact views each renders (table → columns, filters).
2. Add `GET /api/data/<view>` endpoints for those views (paged, scoped, probe-cached where the
   view is shared) and `POST /api/data/<collection>` row writes (R4). Lines/children (voucher
   lines, marks) write with their parent id; "day close"-style batch actions are one RPC in a
   transaction.
3. Convert the desk's screens to `useErpQuery`/`useErpMutation`.
4. Delete the desk's `*Persistence.ts`, its hydrate task in `deskHydrationSchedule.ts`, its
   `*NormalizedClient.ts` push, its `ensure*HydratedServer`, and its source-grep self-tests.
5. Acceptance: the desk's screens pass `counts`, `budget` and a desk-specific `propagation`
   case (an edit in context A shows in B ≤ 30 s); the desk's ratchet counts reach 0; the
   24 h Cloud Run bytes for the desk's old bulk GET drop to ~0.

Fees first because it is 1.5 MB per page and its save is still whole-desk and unversioned
(`evidence/write-path.md` §6). Attendance second because it is 7,904 DB reads a day.

### Phase 6 — Delete the replica (~3 sessions)

Delete `browserStorage.ts` memory copies and `purgeStoredModuleCopies`, `deskHydrationSchedule.ts`,
`deskHydrateGuard.ts`, `deskLazyHydrate.ts`, `deskLoadGuard.ts`, `createDeskSlicePersistence.ts`,
`domainBlobPersistence.ts`, `moduleStatePersistence.ts` (module books become row collections),
every remaining `*Persistence.ts`, `sliceRevClient.ts`, `rowStampClient.ts`, `deskStampsClient.ts`,
`serialSave.ts`, `syncRetryStatus.ts`, `deskSyncStatus.ts`, `deskNamedDeletes*.ts`, the
`*Guard.ts` files whose failure modes no longer exist, `schoolDataMirror*.ts`,
`schoolMirrorRemote.server.ts`, `.data/*.json`, `loadServerMasters`'s `defaultMasters()` fallback,
and the 66 source-grep self-tests. Keep: `rowStampWrite.server.ts`, `sliceCas.server.ts` (used by
the RPC), `deskProbeCache.server.ts`, `pageAll.ts`, `lib/data/*`. Acceptance: ratchets at 0;
`lib/` shrinks by ≥ 12,000 lines; the full e2e suite green; 24 h Cloud Run shows no
`/api/school-data/*-desk` or `sis-roster` bulk GETs from browsers.

---

## 5. Definition of done (measurable; the director checks these, not the code)

| Measure | Today (12 Oct) | Done |
|---|---|---|
| Staff / students / classes shown on every screen | sometimes 0 | always equal the database (`counts.spec.ts` on every PR; `rendered-zero-rows` beacon = 0 in production for 7 days) |
| A Masters change visible on other open screens and devices | never without reload | ≤ 30 s, no reload (`propagation.spec.ts`) |
| Bytes downloaded to open `/fees`, `/students`, `/attendance` | 3.6 MB / 2.7 MB / 1.5 MB | ≤ 300 KB each (`budget.spec.ts`) |
| API requests to open a page | 21–34 | ≤ 8 |
| Data visible on a phone (4× CPU throttle, 4G) | 3–9 s | ≤ 2 s |
| `/api/v1/principal/snapshot` avg | 5.03 s | ≤ 0.8 s |
| `/api/v1/staff/approvals` avg | 1.70 s | ≤ 0.15 s |
| Server whole-roster reads per day | 3,525 | 0 (reference cache: ≤ instances × changes) |
| Whole-desk POSTs from browsers per day | all saves | 0 (ratchet + log check) |
| Replica-consistency code in `lib/` | 12,682 lines | 0 |
| Tests that only grep source | 66 | 0 |
| Live revision traceable to a commit | no | yes (label), deployed by trigger within 15 min of merge |

---

## 6. Rules for every executor

1. **One step, one PR, one worktree.** Branch from `origin/main`. Never edit the shared main
   checkout. Never base on another unmerged branch.
2. **The named acceptance test is the definition of done.** If it cannot be made to pass,
   say so and stop; do not weaken the test.
3. **Measure before and after.** Every step that touches a route or a screen reports the
   relevant line from §5 (bytes, requests, p95) from the e2e run, and after deploy from
   production logs using `evidence/production-measurements.md`.
4. **Never write production from a laptop.** Tests run on the seeded local database.
   `apps/web/.env.local` is production; a read-only dev server is fine, a test that saves is not.
5. **Do not add a guard.** If a step seems to need a new `*Guard.ts`, a new `ensure*`, a new
   event, a new TTL or a new merge function, the step is being done inside the replica — stop
   and re-read §3.
6. **Delete as you go.** A converted screen's old loader call, listener and hydrate are removed
   in the same PR; the ratchet must fall.
7. **Report honestly.** "Done" means the test is green in CI and the numbers moved. List what
   was skipped.

---

## 7. Reference

### 7.1 First check for any "not showing" report

```bash
curl -s https://bhbinternational.school/api/app-version
gcloud run services describe school-erp-web --region asia-southeast1 --format="value(status.traffic[0].revisionName)"
git log --oneline origin/main -1
```
If the live revision is older than the fix's merge, the report is about code that does not
contain the fix (this is what happened with PR #578 on 12 Oct). Deploy first, then ask the
person to hard-reload.

### 7.2 Existing pieces to build on (do not reinvent)

| Piece | Where | Use in |
|---|---|---|
| paged reads | `lib/supabase/pageAll.ts` (`fetchAllPages`, `fetchByIds`) | 1.3 |
| probe-gated response cache + ETag | `lib/deskProbeCache.server.ts` (`cachedDeskJson`, `deskProbe` RPC with table allowlist) | 1.3, 1.4 |
| per-row CAS write | `lib/rowStampWrite.server.ts` (`writeStampedRows`) | 1.5 |
| slice lock + all-or-none | `supabase/migrations/20261010220000_masters_write_slices.sql`, `lib/sliceCas.server.ts` | 1.5 RPC |
| inert Stage-1 data route | `app/api/data/[collection]` + `desk_write_guarded` (docs/TODO.md Phase 1) | 1.5 |
| typed read failure | `lib/data/types.ts` (`ReadFail` has no `rows`) | 1.3, R6 |
| server-scoped hook precedent | `components/staff/useMyTeaching.ts` | 1.4 |
| deploy trigger config + smoke + rollback | `cloudbuild.deploy-on-merge.yaml`, `scripts/setup-deploy-on-merge.sh` | 0.3 |
| ratchets | `scripts/check-ratchets.sh`, `scripts/ratchets.txt` | 1.6 |
| local throwaway DB | memory `erp-fresh-db-migration-rehearsal` (PG17 + Supabase shim) | 1.1 |
| change signal source | the 35 `*_sync_meta` tables (`updated_at`, counts) | 1.3 |

### 7.3 Frozen files (delete-only until Phase 6)

`apps/web/src/lib/*Persistence.ts`, `*NormalizedClient.ts`, `deskHydrationSchedule.ts`,
`deskHydrateGuard.ts`, `deskLazyHydrate.ts`, `deskLoadGuard.ts`, `browserStorage.ts`,
`createDeskSlicePersistence.ts`, `domainBlobPersistence.ts`, `moduleStatePersistence.ts`,
`sliceRevClient.ts`, `rowStampClient.ts`, `deskStampsClient.ts`, `serialSave.ts`,
`syncRetryStatus.ts`, `deskSyncStatus.ts`, `deskNamedDeletes*.ts`, `*Guard.ts`,
`schoolDataMirror*.ts`, `schoolMirrorRemote.server.ts`, `components/shell/CoreDataGate.tsx`.

### 7.4 Inventories (in `evidence/`)

- `read-path.md` — every loader's per-read cost; screen → loads per mount; the read-once list
  (which screens never re-render).
- `hydration.md` — all 77 `ensure*Hydrated` functions with dedupe / mark order / snapshot-before-await
  / wipe-on-empty / push-during-hydrate; what runs on first load per route.
- `write-path.md` — per-desk save inventory (what is sent, version mechanism, server merge);
  probe-cached routes vs the tables their bodies read.
- `server-cost.md` — every `school-data` GET's server cost; mobile routes' per-request work; fixed
  per-request costs.
- `mobile-app.md` — every request each home screen fires; timers; the no-data-layer facts.
- `propagation.md` — the hop-by-hop trace of a Masters edit; the picker-screen table.
- `history.md` — the 98 fixes classified; recurrence; what is live.
- `harness.md` — what the 455 tests can and cannot see; the guard inventory with line counts.
- `production-measurements.md` — the numbers and the queries to re-measure.
