# harness — Tests, verification and deployment — why fixes ship green and the symptom survives

## summary
The pipeline that is believed to exist does not. Three documents (docs/DEPLOY_ON_MERGE.md:13-14, scripts/setup-deploy-on-merge.sh:80-89, cloudbuild.deploy-on-merge.yaml:1-4) describe a Cloud Build trigger that deploys every merge and smoke-tests it; `gcloud builds triggers list` returns zero triggers in asia-southeast1 and globally, deploy.yml is workflow_dispatch-only (lines 12-19), and automerge.yml:16 says in its own header "Merging does not deploy". Every one of the last 12 builds (6-12 Oct) is a manual `gcloud builds submit "$ROOT"` of a working tree (deploy-online.sh:318) with a storage tarball as its only identity and no COMMIT_SHA; cloudbuild.yaml:125-185 sets no label, so a Cloud Run revision cannot be traced to a commit. I measured what is live by blob-hashing the extracted tarball against main: revision 00856 is exactly commit 4b25d4da (PR #577 merge, 13:31 IST) with 0 differing files; the build was submitted 14:33 IST, PR #578 merged 15:46 IST, and the live mastersPersistence.ts:163 still contains the `mergeDbDeskIntoMastersState(localBefore, …)` write-back that #578 removed — so the Staff-page-0 fix is "merged" and not running. Verification is 455 `npx tsx` self-tests plus typecheck/lint/ratchets/`next build` (ci.yml, verify.sh); the dependency list has no browser, React-render, jsdom, load or web-vitals tool, no test renders a component, runs two clients, measures a load time or payload, or drives the hydration scheduler through real route handlers. Worse, 66 of 470 self-tests assert on source text with readFileSync (30 of them execute no application code at all), and the tests covering the very fixes aimed at S1/S3/S5 — deskLoadGuard.selftest.ts:58-96 (CoreDataGate, the 5 s staff wait, the bhb-masters-updated listener, and the #578 "never writes back the pre-fetch snapshot" rule) — are string matches that pass whenever the text is present, race or no race. Nothing leaves the browser: AppShell's unhandledrejection handler, deskSyncStatus and syncRetryStatus end in console/toast/CustomEvent/localStorage; there is no performance timing, sendBeacon, web-vitals or client-log route, and web requests carry no build id, so no one can tell whether a teacher's report comes from the old build or the new one. The ~12.7 k lines of replica-consistency code in lib/ (112 files) plus 6 k lines of their self-tests are therefore verified by text presence and by the director asking staff, deployed hours after merge by hand, and observed by nobody.

## findings

### 1. [root] Deploy-on-merge does not exist; production is a hand-run tarball of a working tree with no commit identity, so 'merged' is routinely not 'live' (PR #578 is absent from rev 00856)  (measured; S1,S2,S3,S4,S5,S6)
The director merges a fix (often via the automerge label) and the docs say a Cloud Build trigger deploys it in ~10 minutes with a smoke test and auto-rollback. No trigger exists. The only path to users is scripts/deploy-online.sh run by hand on a Mac, which uploads the current working tree to Cloud Build; the resulting revision carries a tarball name and no commit label. Fixes reach users hours later, in batches, only when someone runs the script — and the staff-0 fix (#578, merged 15:46 IST) is not in the revision built at 14:33 IST and serving since 14:48 IST. Every 'still broken' report after that merge is therefore a report about code that does not contain the fix.
- `scripts/deploy-online.sh:318-321, 361-363` — `gcloud builds submit "$ROOT"` uploads the working tree; the script ends with 'When green: https://bhbinternational.school/login' — a human is the smoke test
- `cloudbuild.yaml:125-185` — `gcloud run deploy` with no --labels / --set-labels; nothing names a commit on the revision
- `.github/workflows/deploy.yml:12-19` — 'Manual-run-only for now: workflow_dispatch, NO push trigger'
- `.github/workflows/automerge.yml:16` — 'Merging does not deploy. Deploy stays a manual step.'
- `docs/DEPLOY_ON_MERGE.md:13-14, 52-53` — Claims 'the deploy-on-merge trigger on every push to main' and 'a green build = live, smoke test passed' — MEASURED: `gcloud builds triggers list` (regional and global) returns nothing
- `cloudbuild.deploy-on-merge.yaml:86-114` — The only smoke test + rollback in the repo lives in the config of the trigger that was never created
- `scripts/setup-deploy-on-merge.sh:80-89` — Would create the trigger; the gcloud listing shows it never ran to completion
- `apps/web/src/lib/mastersPersistence.ts:150-163` — LIVE still has `const localBefore = loadMasters()` … `mergeDbDeskIntoMastersState(localBefore, bundle` — the exact #578 bug; HEAD lines 162-168 merge into `loadMasters()` instead
- `gcloud builds describe ca9d9a8d (MEASURED):n/a` — createTime 2026-10-12T09:03:29Z (14:33 IST), finish 09:18:17Z; source = storage tgz; no TRIGGER_NAME/COMMIT_SHA. Revision 00856 created 14:48:47 IST. `gh pr view 578` mergedAt 2026-10-12T10:16:14Z (15:46 IST)
- `blob-hash match of live tarball vs `git log --first-parent HEAD` (MEASURED):n/a` — 4b25d4da (Merge PR #577, 13:31 IST): 0 files differ, 0 missing; 2f0eb3d4 (PR #578): 3 differ. The 12 builds 6-12 Oct all have storage-tarball sources
- FIX HINT: Create the trigger (setup-deploy-on-merge.sh) or add `push: branches: [main]` to deploy.yml once WIF works; add `--labels commit=$COMMIT_SHA` (or bake BUILD_ID→commit into /api/app-version) so every revision names its commit; make `gcloud run services describe` + /api/app-version the first step of any 'is it fixed' conversation.

### 2. [major] The verification suite cannot see any of S1–S6: 455 Node self-tests, zero browser/render/two-client/timing/payload tests  (measured; S1,S2,S3,S4,S5,S6)
CI and verify.sh run typecheck, lint, ratchets, `next build` and 455 `npx tsx` scripts. None opens a page, renders a React component, runs two browsers against one server, measures a page load or an API payload against a budget, or runs AppShell→startDeskHydrationBackground→real route handlers. The symptoms are all about a screen showing nothing, showing stale data, or being slow on a phone — categories the suite has no instrument for — so a PR can be fully green while the screen behaviour is unchanged.
- `apps/web/package.json:scripts` — MEASURED: 455 test:* entries, 454 are `npx tsx …selftest.ts`; 35 dependencies total; none of playwright/puppeteer/jest/vitest/jsdom/testing-library/lighthouse/web-vitals/k6/msw
- `.github/workflows/ci.yml:50-67, 71-615, 616-667` — verify job = typecheck, lint, check-ratchets.sh, 352 `npm run test:*` steps; build job = `next build` with placeholder env
- `scripts/verify.sh:57-518, 588-601` — Same list locally; the only three tests touching a real HTTP endpoint, the real DB or a real model (wa-webhook, parent-bus-live, voice-note-live) are explicitly NOT_IN_SUITE
- `apps/web/src/lib/hydrateFailureSafety.selftest.ts:9-24` — 'Minimal window/localStorage stubs let the browser-path code run under plain Node (no jsdom)' — the pattern for the 12 tests that touch storage at all
- `apps/web/src/lib/sliceCas.selftest.ts:10-14` — CAS/stamp races are driven 'against an in-memory table' inside one process; the 5 regex hits for 'concurrent/clientA' (serialSave, sisRevision, payment-link-reuse, short-promise-cache, visiting-pay) are all single-process
- `apps/web/src/lib/deskOnDemand.selftest.ts:28-62, 77-88` — The closest thing to a scheduler test: calls priorityDeskHydrateIds()/hydrateOnFirstRead() with a counter, then readFileSync-greps the schedule for a regex. No ensure*Hydrated, no route, no screen
- `marker scan of all 455 selftests (MEASURED):n/a` — react_render 0; window.document/dispatch-based render 0; listen()/spawn 0; the 5 'timing' hits are not budgets (voice-note, app-popup-text, erp-commands)
- FIX HINT: One Playwright job against `next start` with a seeded fake-Supabase (or the fresh-DB rehearsal) that: logs in, opens /staff, /students, /masters, asserts row counts > 0, edits a class in one context and asserts it appears in a second context, and fails on a payload or LCP budget.

### 3. [major] The tests that 'proved' the S1/S3/S5 fixes assert on source text, not behaviour: 66 self-tests grep the code, 30 run no application code at all  (measured; S1,S3,S4,S5)
deskLoadGuard.selftest.ts (the test behind PRs #570/#571 and the only test for the #578 masters/staff race) reads AppShell.tsx, CoreDataGate.tsx, StaffWorkspace.tsx and mastersPersistence.ts with readFileSync and asserts strings like `setTimeout(r, 5000)`, `addEventListener("bhb-masters-updated", onMasters)` and `!mp.includes("mergeDbDeskIntoMastersState(localBefore")`. These pass the moment the text is typed, whether or not the race, the 5 s wait or the listener actually produce a populated screen. The same pattern covers the 'no-prune' family, row stamps, slice revisions and the dashboard refetch fix (S4). A green suite therefore certifies that the intended lines exist, not that the symptom is gone — which is exactly the observed pattern: ~60 green fixes, same six complaints.
- `apps/web/src/lib/deskLoadGuard.selftest.ts:58-96` — Lines 68-69 `src.includes("refuseSaveBeforeLoad(")` for 23 persistence files; 82-87 regex on AppShell/CoreDataGate/StaffWorkspace; 91-93 `mp.includes("mergeDbDeskIntoMastersState(loadMasters(), bundle")` and `!mp.includes("…(localBefore")` — the entire test of the #578 fix
- `apps/web/src/lib/dashboardNoRefetchLoop.selftest.ts:14-46` — Reads ModuleDashboardHost.tsx / SchoolHomeDashboard.tsx / attendancePersistence.ts and asserts dependency-array text `}, [moduleId]` and a regex for `dedupeHydration(MODULE, …)`; the re-fetch loop itself is never executed
- `apps/web/src/lib/sliceRevServer.selftest.ts:8-13` — 'this pins the wiring, by reading the code' — 6 self-tests say so in their header
- `grep over src/lib/*.selftest.ts (MEASURED):n/a` — 66 of 470 self-tests call readFileSync on source; 30 of those have no runtime import of any src module (accountsNoPrune, feesPaymentsNoPrune, homeworkNoPrune, mastersRevisionEverywhere, serverFallbackSaves, sisMemoryFallback, sliceRevServer, staffAttendanceRowStamps, deskSyncStatus, …)
- `grep for a behavioural test of hydrateMastersOnce (MEASURED):n/a` — No self-test names hydrateMastersOnce, staff-zero or 'Staff page showed 0'
- FIX HINT: Treat readFileSync tests as lint, not tests; for every guard, write the race as code: start hydrateMastersOnce and the staff hydrate concurrently against a fake fetch that resolves in the bad order, then assert loadMasters().staff.length > 0 and that a mounted StaffWorkspace re-renders.

### 4. [major] No client-side telemetry: hydrate durations, parse times, empty-roster renders, quota events and conflict toasts never leave the phone, so nobody can know a fix worked where the symptom lives  (measured; S1,S2,S3,S4,S5,S6)
Every failure path in the browser ends in console.*, a toast, a CustomEvent or localStorage. There is no performance.mark/measure around loadMasters()/loadSis() JSON.parse, no web-vitals, no sendBeacon, no /api/client-log, and web requests carry no build id. Cloud Run logs can show response sizes and server latency (how the 1.9 MB sis-roster was found) but nothing about what the ~30 teachers' phones do with them. The only feedback loop on S1–S6 is a staff member telling the director, with no build, device, desk or timing attached — so a fix is 'confirmed' when complaints pause and 'failed' when they resume, regardless of what changed.
- `apps/web/src/components/shell/AppShell.tsx:73-91` — unhandledrejection → console.error + pushToast; nothing posted
- `apps/web/src/lib/deskSyncStatus.ts:1-15, 122-126` — Exists because failures 'write to a console nobody has open'; its own sink is console.error + `bhb-desk-sync-failed` CustomEvent
- `apps/web/src/lib/syncRetryStatus.ts:51-63, 148` — Status to localStorage + CustomEvent; 'degrades to in-memory only' when storage is full
- `grep over apps/web/src (MEASURED):n/a` — `performance.(now|mark|measure)` once, in components/transport/TransportGoogleMap.tsx; sendBeacon/reportWebVitals/web-vitals/useReportWebVitals: 0; no api route named log/telemetry/metric/vitals/client-error for the ERP client
- `apps/web/src/lib/appMinBuild.ts:55-59` — Only the Flutter app sends X-App-Flavor/X-App-Build (cbse_school_mobile/lib/core/update/app_build.dart:42); web requests have no build header
- `cbse_school_mobile/pubspec.yaml:25-26` — firebase_core + firebase_messaging only; no crashlytics, firebase_performance or sentry — S6 has no measurement on the device
- `apps/web/src/lib/serverWorkTracker.server.ts:66, 129` — Server-side only: warns when a reply was held >cap ms; useful for S4 server half, blind to the client half
- FIX HINT: A 20-line beacon: on each desk hydrate and loadMasters()/loadSis() parse, post {buildId, desk, ms, bytes, rowsAfter, staffCount} via sendBeacon to /api/client-metrics (sampled); log 'rendered 0 rows' events; add X-Bhb-Build to fetches; put a Cloud Logging dashboard on it.

### 5. [minor] A deployed build reaches an open tab only when the user taps 'refresh' (15-min poll); nothing records which build a browser runs  (read-in-code; S1,S3,S5)
UpdateBar polls /api/app-version every 15 minutes while on screen (or on focus, min 60 s gap) and shows a bar; it never reloads by itself. sw.js is network-first so JS is not served stale, but a tab left open on a phone keeps the previous bundle until the person acts. Combined with the previous finding, a 'still broken' report after a deploy may be from the old build, and there is no way to tell.
- `apps/web/src/components/pwa/UpdateBar.tsx:7-9, 18-25, 62-66, 92` — MIN_GAP_MS 60_000, POLL_MS 15 min, 'never in the background', reload only onClick
- `apps/web/public/sw.js:45-73` — fetch → network first, cache.put on success, cache only on network failure (not a stale-JS source)
- `apps/web/src/app/api/app-version/route.ts:11-25` — Serves .next/BUILD_ID — a build id, not a commit; cannot be matched to a PR without the tarball-hash exercise above
- FIX HINT: Force-reload idle tabs on build change (e.g. on next navigation when BUILD_ID differs) and send the build id with every request.

### 6. [minor] Repo documentation contradicts the measured pipeline in both directions, so decisions are made on a false model  (measured; S1,S2,S3,S5)
verify.sh says GitHub Actions cannot run on this repo (it runs: 8 CI runs on 12 Oct alone, all completed); DEPLOY_ON_MERGE.md says merges deploy with a smoke test (no trigger exists); PRE_DEPLOY_CHECKLIST.md is a first-deploy checklist whose manual items 5-6 ('Students count > 0 in a fresh browser', 'Masters load', 'Fee Take search works') are precisely S1/S2/S3/S5 and were never automated. Someone reading the repo concludes that merge = tested = live.
- `scripts/verify.sh:5-8` — 'GitHub Actions cannot currently run on this repo — every workflow dies at startup with zero jobs' — MEASURED false via `gh run list --workflow=CI` (success on push main 10:16Z, 08:01Z, 07:33Z; PRs 09:53Z, 08:00Z, 07:31Z, 07:19Z)
- `docs/DEPLOY_ON_MERGE.md:3-6, 13-25` — Describes env/preflight/deploy/smoke steps as running 'on every push to main'
- `docs/PRE_DEPLOY_CHECKLIST.md:3, 111-146, 240-248` — 'Use this before the first production deploy'; items 5-6 are the manual smoke tests for the exact symptoms; 'Day 1 — Smoke test live URL: login, fees, one student' is the only post-deploy check ever written down
- `docs/DEPLOY_CLOUD_BUILD_TRIGGER.md:23-27, 47-62` — A second, different trigger design (deploy-main, cloudbuild.yaml direct) — also never created
- FIX HINT: Delete or correct the three documents; make verify.sh's header match ci.yml; move checklist items 5-6 into the browser test.

### 7. [minor] Twelve hand deploys in six days, each creating 4 revisions and evicting every warm instance on a min-instances=0, 1-vCPU service  (inferred; S4)
Each deploy-online.sh run produces a `run deploy` revision, then a desk-cutover `services update`, a BigQuery `services update` and a traffic switch — 4 revisions in ~75 s (00853→00856 at 14:47:32–14:48:47). With --min-instances=0 and --cpu=1 the next request after each deploy, and after every idle gap, pays a Node cold start plus the first parse of the whole-desk JSON. The deploy cadence (10 Oct 10:29, 15:17; 11 Oct 18:04, 22:21; 12 Oct 03:05, 14:33 IST) means this happens inside school hours. The contribution to S4 is inferred from the config; it was not measured here.
- `cloudbuild.yaml:137-160, 192-202` — --cpu=1, --min-instances=0, --concurrency=20, --cpu-throttling; the extra env-update step that makes a second revision
- `scripts/deploy-online.sh:324-354` — Two more `gcloud run services update --update-env-vars` after the build (desk cutover, BigQuery) — each a new revision
- `gcloud run revisions list (MEASURED):n/a` — 00853 14:47:32, 00854 14:47:52, 00855 14:48:32, 00856 14:48:47 IST; same 4-revision burst at 22:35-22:36 on 11 Oct and 03:19-03:20 on 12 Oct
- FIX HINT: Fold the env updates into the single `run deploy` (they are static committed values), deploy outside school hours or with min-instances=1 during 08:00-15:00.

## tables
### Test-category inventory (apps/web/package.json, 455 `test:*` scripts; 470 `*.selftest.ts` files in src/lib)

| Category | Count | What it actually exercises | Evidence |
|---|---|---|---|
| Static gates | 4 | `tsc --noEmit`, `eslint`, `scripts/check-ratchets.sh`, `next build` with placeholder env | ci.yml:50-67, 616-667; verify.sh:523-544 |
| Pure-function / in-process logic self-tests (Node, `npx tsx`, `node:assert`) | ≈389 (455 − 66 source-readers) | Normalisers, merge rules, WA text, fee maths, RBAC tables; no DOM, no network | package.json: 454/455 are `npx tsx src/lib/*.selftest.ts` |
| Source-text assertion tests (`readFileSync` + `includes`/regex on .ts/.tsx) | 66 (30 execute no app code at all) | Check that a string/regex is present in a component or persistence file | deskLoadGuard.selftest.ts:58-96; dashboardNoRefetchLoop.selftest.ts:14-46; sliceRevServer.selftest.ts:12 "by reading the code" |
| Fake `window`/`localStorage` stubs (no jsdom) | 12 | Browser-path functions called under Node with a stub object | hydrateFailureSafety.selftest.ts:9-24; deskLoadGuard.selftest.ts:8-19 |
| Fake `fetch` | 1 | staffRowStamps | marker scan |
| In-memory fake Supabase table (CAS / stamps / revs) | 9 | Single-process "another writer lands between read and write" | sliceCas.selftest.ts:10-14; deskStamps.selftest.ts:11-15 |
| Route handler imported directly (no HTTP server) | 33 | Calls the exported handler/helper with fake request/db | sliceRevServer, feeServerPersistence, deskSliceNoPrune, … |
| Real HTTP endpoint / real DB / real model | 3 — **NOT in CI or verify.sh** | wa-webhook (needs dev server), parent-bus-live (real DB), voice-note-live (Gemini) | verify.sh:588-601 NOT_IN_SUITE |
| Loads a page in a real browser / renders React | **0** | — | deps: no playwright/puppeteer/jsdom/testing-library; react_render matches 0 |
| Two clients against one server, convergence asserted | **0** | The 5 "concurrent/clientA" hits (serialSave, sisRevision, payment-link-reuse, short-promise-cache, visiting-pay) are single-process promise ordering | serialSave.selftest.ts:7-28 |
| Page-load time or API payload size vs a budget | **0** | 14 "KB/MB/byteLength" hits are wire-shape checks, not budgets; 5 "timing" hits are not budgets | wirePayload, dataContract selftests |
| Hydration scheduler end-to-end with real route handlers | **0** | deskOnDemand runs `priorityDeskHydrateIds()`/`hydrateOnFirstRead()` with a counter, then greps the schedule source | deskOnDemand.selftest.ts:28-62, 77-88 |
| Screen re-renders after a desk hydrates | **0** | Only a text assert that StaffWorkspace contains `addEventListener("bhb-masters-updated", onMasters)` | deskLoadGuard.selftest.ts:86-87 |
| Post-deploy smoke / canary | **0 active** | Smoke test exists only in cloudbuild.deploy-on-merge.yaml:86-114 (trigger never created); manual path ends "When green: open /login" | deploy-online.sh:361; `gcloud builds triggers list` empty |

### Guard / band-aid inventory in apps/web/src/lib (non-selftest line counts measured with wc -l)

| File | Lines | Failure it papers over (from its own header) |
|---|---|---|
| mastersWriteGuard.ts | 119 | A client push replacing the class-id generation wholesale |
| mastersRevisionGuard.ts | 59 | A stale masters push overwriting a newer save (optimistic lock pilot) |
| mastersSubjectGuard.ts (+selftest) | — | A phone replacing subjects with new ids (10 Oct wipe) |
| mastersMergePolicy.ts | 36 | Desk masters vs the older blob copy on the server disagreeing |
| mastersFreeze (selftest only, 144) | — | An empty masters desk refusing the server's data |
| deskSliceShrinkGuard.ts | 77 | A push that would delete most of a desk |
| deskLoadGuard.ts | 34 | Saving a desk this page never loaded (12 Oct) |
| deskHydrateGuard.ts (isDeskHydrated 15 s TTL, hasDeskLoaded, dedupeHydration, withHydrationSlot ≤6) | 138 | Re-fetching on every navigation; concurrent callers each fetching; too many parallel whole-desk GETs |
| deskHydrationSchedule.ts | 382 | First paint blocked by loading every desk; now route priority + idle sweep |
| deskLazyHydrate.ts | 34 | Heavy desks loading on every page (Phase 3 on-demand) |
| deskOnDemand (selftest, 97) | — | Idle sweep pulling attendance/fees/admissions on Home |
| sessionWriteGuard.ts | 48 | Writes under a header session / wrong active year |
| prodWriteGuard (selftest 75; guard in supabase/server) | — | A laptop writing to the production DB |
| paymentLinkStatusGuard.ts | 34 | A payment link's status moving backwards from a cached desk |
| studentLeaveStatusGuard (selftest 93; rule in studentLeavePushPlan) | — | An office tab reverting a decided leave to "pending" |
| rbacEditGuard.ts | 193 | Who may change whose permissions |
| transportHydrationState.ts | 51 | Transport desk pushing an empty desk over the server's (21 Aug wipe) |
| deskNamedDeletes.ts / .server.ts / Feature.server.ts | 84 / 111 / 42 | Prune-by-absence deleting rows a browser merely did not hold |
| sliceRevClient.ts / sliceRevMerge.ts | 195 / 182 | Last-write-wins on merged lists (per-row `_rev`) |
| rowStampClient.ts / rowStampWrite.server.ts | 154 / 118 | Old tabs upserting every row (per-row updated_at) |
| deskStampsClient.ts / deskStamps.server.ts | 81 / 134 | Same, for library/payroll/vault/statutory/RTE |
| sliceCas.server.ts | 81 | Two writers to one slice row (compare-and-swap) |
| serialSave.ts | 38 | Overlapping saves from one browser producing false conflicts (12 Oct) |
| moduleStateMerge.ts | 121 | A browser's whole-module save vs the server copy |
| syncRetryStatus.ts | 175 | Background push failing silently (retry ladder + status) |
| deskSyncStatus.ts | 198 | A non-ok HTTP response on push passing unnoticed |
| hydrateFailureSafety (selftest 117; rule in *NormalizedClient) | — | A failed read mistaken for "empty" and wiping local data |
| fullStorageLoaders / saveSurvivesFullCache / browserStorageQuota / sisMemoryFallback (selftests 80/128/150/168; rules in browserStorage.ts) | — | Full localStorage making a desk read as "no students" or losing a save |
| tenantDataWipe.ts | 113 | A stale wipe signal re-wiping a tenant |
| deskProbeCache.server.ts | 155 | Multi-MB Supabase egress on every desk pull (fingerprint probe) |
| shortPromiseCache.ts | 32 | The same server answer computed per caller per second |
| **Replica-consistency code in lib/ (112 files: *Persistence, *Guard, *Merge, *Stamp, sliceRev*, sliceCas, serialSave, *Hydrat*, browserStorage*, domainBlob*, deskNamedDeletes*, sync/desk status, probe cache, *Revision*)** | **12,682** | — |
| **Their self-tests (57 files)** | **6,052** | of which the behaviour-bearing ones are in-process; the wiring ones are source greps |
| Context: 47 `*Persistence*.ts`, 43 exported `ensure*Hydrated` (my grep), lib/ non-selftest total 359,736 lines | | |

## open questions
- Which commits were the 10 Oct and 11 Oct deploys (builds 7196dffd, 8b8be0b0, 7b438d3e, 092de4af, 5347cb91)? The same tarball-hash method could date exactly when #569/#570/#571 went live (they are in rev 00856; #578 is not).
- Was the 14:33 IST tarball built from a clean checkout? The 0-file difference against 4b25d4da says yes for this one; earlier manual deploys from a shared worktree could have shipped uncommitted edits (memory notes describe that risk).
- Is there any Cloud Logging query or dashboard the director actually looks at for latency/size, or is the 24 h traffic table in this task the first time those numbers were computed?
- How many teachers' phones are running a build older than 00856 right now — unanswerable until web requests carry a build id.
