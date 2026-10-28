# hydration — HYDRATION, SCHEDULING AND RACES (web client desk hydration; server-side hydrate paths where they feed the same symptoms)

## summary
Two mechanisms explain most of S1/S2/S3/S5 and neither is a merge race on origin/main. (1) The live revision 00856 still carries the PR #578 lost update (live lib/mastersPersistence.ts:150 snapshots loadMasters() before the await at :151 and writes `localBefore` back at :162-165; main differs from live ONLY on that line among the six extracted files), so the staff roster written by the parallel staff hydrate is erased and, because the staff desk is already marked loaded, never re-read: that is S1 on every device today. (2) On BOTH live and main the full-rights masters-desk GET drops `readFailed` (app/api/school-data/masters-desk/route.ts:176-188 returns ok:true with an empty bundle and updatedAt=now when the Supabase read failed); the browser then computes hasRemote=false → shouldTake=false → {changed:false, ok:true} (lib/mastersNormalizedClient.ts:394-441), hydrateMastersOnce marks the desk hydrated at :154 with the page's memory copy still the empty shell, CoreDataGate opens, and every screen shows no classes/sections/subjects for the life of the tab with no toast and no retry (S5, S3, and S2 via empty class pickers); the same `readFailed` drop in lib/api/v1/auth.ts:203-207 caches an empty masters for 30 s for every mobile/API request, which empties the teacher section scope and makes /api/school-data/sis-roster return students:[] with ok:true for teachers, which the browser accepts as fact on a fresh page (lib/sisPersistence.ts:319-321). The SIS hydrate itself is still the #578 class on main (lib/sisPersistence.ts:269 → :288 → :326/:344), as are 19 of the 22 server-side ensure*HydratedServer functions, which also have no TTL and are run seven at a time per principal-snapshot request (lib/principalSnapshot.server.ts:78-84) — the 5.03 s endpoint that PrincipalCockpit re-fetches on focus, visibility and every bhb-desk-hydrated/bhb-masters-updated event with no in-flight dedupe (S4, S6). Scheduling facts: route-priority hydration runs only once per tab at boot (AppShell effect returns when bootReady, skipRouteHydrateRef is unused), the priority tier runs twice on first load (bootstrapWorkspaceSession and runBackgroundHydration both call ensureDeskHydratedPriority), nothing re-hydrates on tab focus, and the 15 s TTL is consulted only inside explicit ensure* calls (50 workspace call sites) — a /home tab never re-reads masters, so Masters edits made elsewhere never arrive (S3). Any row conflict on any desk calls ensureAllDeskHydrated() after resetDeskHydrated(), which clears the tab-wide dedupe map and re-downloads every desk older than 15 s including the four heavy ones (S4). loadSis() and loadMasters() are reads that parse, normalise, re-serialise, may write back and broadcast bhb-masters-updated on every call (226/277 call sites), and the roster client never sends If-None-Match so the 1.9 MB body is sent even when the server's ETag cache would 304 (S4). Failure handling is uneven: masters/fees/sis/admissions toast ("showing your last saved data", false since 10 Oct), all other desks silently show the empty placeholder as fact until the next ensure call; no fetch has a timeout, so a stalled GET pins one of the six hydration slots indefinitely.

## findings

### 1. [root] LIVE rev 00856 still has the #578 lost update: masters hydrate writes back a pre-await snapshot and erases the staff roster  (read-in-code; S1,S3)
hydrateMastersOnce reads loadMasters() into localBefore, awaits the masters-desk GET, then writes mergeDbDeskIntoMastersState(localBefore, bundle) into bhb_masters_v5. The staff hydrate runs in the same priority tier and writes the roster into the same key while that GET is out; the masters write-back restores staff/departments/designations to [] and the staff desk — already marked hydrated and hasDeskLoaded-sticky — is not re-read until a workspace explicitly calls ensureStaffHydrated after the 15 s TTL. It also erases any saveMasters or syncSisIntoMasters projection written during the fetch. Diff of the six extracted live files vs origin/main shows this single line is the only difference, so main's fix (#578, loadMasters() at write time) is not deployed.
- `apps/web/src/lib/mastersPersistence.ts:150-151, 162-165` — `const localBefore = loadMasters();` → `await hydrateMastersDeskFromDb(readFromDb)` → `writeMastersLocalRaw(mergeDbDeskIntoMastersState(localBefore, bundle, { preferDb: readFromDb }))`
- `apps/web/src/lib/mastersPersistence.ts:150-171` — origin/main: same shape but :168 passes loadMasters() at write time; comment :162-166 documents the Staff-page-0 effect
- `apps/web/src/lib/staffPersistence.ts:741-800` — staff hydrate writes roster into masters (:792) then markDeskHydrated (:800); never re-reads on its own
- `apps/web/src/lib/deskHydrateGuard.ts:17-27, 41-55` — hasDeskLoaded sticky; isDeskHydrated 15 s TTL
- FIX HINT: Deploy main (PR #578). Longer term: make every hydrate a read-modify-write against the copy at write time, never a snapshot taken before an await (see also SIS and all *Server hydrates below).

### 2. [root] A failed masters DB read is served as ok:true + empty bundle; the browser marks masters hydrated on the empty shell and nothing retries  (read-in-code; S5,S3,S2)
fetchMastersDeskFromDb reports readFailed=true with an empty bundle when the Supabase slice/meta read errors. The full-rights GET branch of the masters-desk route destructures only {bundle, meta, sliceStamps} and returns ok:true, classCount 0, sliceCount 0, updatedAt = new Date() (only teachingMastersResponse and POST honour readFailed). In the browser hydrateMastersDeskFromDb sees res.ok, computes hasRemote=false (remoteDeskHasData) → shouldTake=false → returns {changed:false, ok:true}; hydrateMastersOnce then markDeskHydrated("masters") while the memory copy is still the cold-start emptyMastersShell (no classes). CoreDataGate's hasDeskLoaded("masters") turns true and the workspace renders; every loadMasters() reader sees no classes/sections/subjects/feeHeads; loadSis()'s alignSisToMasters takes the total-drift branch so students keep their ids but every class picker is empty. No toast is raised (the masters path has no reportLoadFailure), the 15 s TTL blocks a re-read, and on /home nothing calls ensureMastersHydrated again, so the tab stays empty until reload. The identical readFailed drop in lib/api/v1/auth.ts loadServerMasters caches defaultMasters-shaped empty masters for 30 s for every API request (teacher scope → empty sections → sis-roster teacher branch returns students:[] ok:true).
- `apps/web/src/app/api/school-data/masters-desk/route.ts:176-188` — `const { bundle, meta, sliceStamps } = await fetchMastersDeskFromDb();` then `NextResponse.json({ ok: true, ...bundle, classCount: bundle.classes.length, ... updatedAt: meta?.updatedAt || new Date().toISOString() })` — readFailed ignored; compare :79-85 (teaching path returns 503 on readFailed) and :215-242 (POST checks it)
- `apps/web/src/lib/mastersNormalized.server.ts:362-421` — readFailed contract and the 2026-08-10 incident note; returns {bundle: empty, meta: null, readFailed: true} on sliceErr/metaErr
- `apps/web/src/lib/mastersNormalizedClient.ts:394-441 (esp. 36-41, 60-62, 72)` — hasRemote via remoteDeskHasData (:140-157); shouldTake false → `return { bundle: empty, changed: false, ok: true }`
- `apps/web/src/lib/mastersPersistence.ts:151-154` — `if (!ok) return false;` only guards res.ok; `markDeskHydrated(MODULE)` runs on changed:false
- `apps/web/src/lib/masters.ts:2049-2053` — cold browser on a real tenant returns emptyMastersShell() without storing it
- `apps/web/src/components/shell/CoreDataGate.tsx:24, 31-34, 42-55` — gate opens on hasDeskLoaded("masters") regardless of content
- `apps/web/src/lib/api/v1/auth.ts:189-222` — `const [{ bundle }, staffBundle] = await Promise.all([fetchMastersDeskFromDb(), fetchStaffRemoteServer()])` — readFailed dropped, cached 30 s
- `apps/web/src/lib/api/v1/staffScope.ts:8-20, 32-35` — teacher sections derived from ctx.masters classSubjects/sections + timetable
- `apps/web/src/app/api/school-data/sis-roster/route.ts:10-40` — teacher branch returns students filtered by scope.sections with ok:true even when the set is empty
- FIX HINT: Return 503 on readFailed in the full-rights GET and in loadServerMasters (never cache a failed read); in the client treat classCount 0 + sliceCount 0 on a populated school as a failed load (do not markDeskHydrated, raise reportLoadFailure, retry). Verify in Cloud Run logs how often '[masters-desk] stored-state read FAILED' fires.

### 3. [major] Empty-but-200 roster is accepted as fact on every fresh page (local copy is always empty since 10 Oct)  (read-in-code; S2)
hydrateSisOnce refuses an empty remote only when the browser already holds students (:304-317). Since module copies live in page memory, every page load starts with an empty local copy, so an empty bundle with ok:true (teacher scope with no sections, a partial/scoped read, or any server bug returning []) is marked hydrated and left empty with no toast and no retry for 15 s; hasDeskLoaded stays sticky. Combined with the previous finding (empty server masters → empty teacher scope) this is the teacher-side 'students are not loading'.
- `apps/web/src/lib/sisPersistence.ts:301-321` — guard only when next.students.length > 0; `markDeskHydrated(MODULE); if (readFromDb && remoteEmpty) { /* leave empty */ }`
- `apps/web/src/lib/sisNormalizedClient.ts:354-398, 422-429` — fetchSisDeskFromApi returns bundle with [] when body arrays are empty; shouldTake true under sisReadFromDbClientEnabled()
- `apps/web/src/lib/browserStorage.ts:65-117, 254-305` — bhb_sis_v* is MEMORY_ONLY; readCache returns undefined on a fresh page
- FIX HINT: Server must send studentCount from a COUNT independent of the scoped filter plus an explicit `scopedToTeacher`/`empty-by-scope` marker; client should treat count>0 with students.length 0 as a failed read, and never mark hydrated on an empty roster for a tenant known to have students (school profile / masters.students projection).

### 4. [major] SIS hydrate (main) and 19 server-side *HydratedServer hydrates are still the #578 snapshot-before-await class  (read-in-code; S2,S3)
hydrateSisOnce takes `next = loadSis()` before awaiting the 1.9 MB roster GET and writes `next` (merged) back afterwards. Any write to bhb_sis_v1 during that fetch — a saveSis from the UI, the push-response revisionAt adoption in sisNormalizedClient (:273-287), profileDocVerification, or a second hydrateSisOnce started after resetDeskHydrated cleared the dedupe map — is overwritten by the stale snapshot: the edit disappears from the screen and the next push carries a stale revision and conflicts. On the server, 19 of the 22 ensure*HydratedServer functions do `let state = loadX()` → `await fetchXDeskFromDb()` → `writeXLocalRaw(state)` against a process-shared mirror, so concurrent requests on one Cloud Run instance overwrite each other's copies (mostly wasted work since there is no TTL, but a server write path that reads the mirror in that window pushes a stale copy).
- `apps/web/src/lib/sisPersistence.ts:269, 288-290, 326-329, 343-345` — `let next = loadSis();` … `await hydrateSisDeskFromDb(readFromDb)` … `next = mergeSisRemoteIntoState(next, bundle, …)` … `writeSisLocalRaw(next)`
- `apps/web/src/lib/sisNormalizedClient.ts:273-287` — push response rewrites the SIS copy (revisionAt adoption) — a concurrent writer during hydrate
- `apps/web/src/lib/attendancePersistence.ts:144, 155, 176` — server: state=loadAttendance() → await fetchAttendanceDeskFromDb() → writeAttendanceLocalRaw(state); same shape in exams :134/:149/:166, fees.server :46/:57/:88, homework :127/:142/:157, payments :224/:239/:249, ptm :140/:155/:169, rte :118/:133/:146, schoolComms :154/:169/:182, staffAttendance :134/:147/:167, studentLeave :132/:149/:159, timetable :121/:136/:149, transport :127/:142/:155, trust :116/:131/:144, vault :118/:133/:142, library :115/:130/:138, notifications :118/:135/:144, payroll :102/:117/:125, accounts :159/:174/:187, admissions :272/:283/:293
- `apps/web/src/lib/schoolMirrorRemote.server.ts:88, 121-224` — mirror hydrate snapshots `cur` then awaits five reads before building `next` from `cur`
- FIX HINT: Same rule as #578 everywhere: read the copy at write time and merge the remote bundle into it; server hydrates need a per-desk TTL + in-flight dedupe like feeAdjustmentsPersistence.server.ts:31-32.

### 5. [major] Any row conflict triggers a full re-hydrate of every desk and clears the tab-wide dedupe map  (read-in-code; S4,S2)
onSaveConflicts (slice revs) and onStampConflicts (row stamps) call resetDeskHydrated(module) and then ensureAllDeskHydrated(). resetDeskHydrated clears `inFlight` for ALL modules, so hydrations already in flight can be started a second time (duplicate GETs; SIS lost-update window reopened). ensureAllDeskHydrated runs all 24 desk tasks, bypassing HEAVY_ON_DEMAND, so every desk whose 15 s TTL has lapsed — in practice all of them — is re-downloaded (sis 1.9 MB, fees 1.5 MB, attendance 0.7 MB, masters 0.2 MB…). With ~30 staff editing, 'someone else changed that entry first' is routine, so one conflict on a phone costs ~5 MB and tens of seconds. sisNormalizedClient does the same after any merge push.
- `apps/web/src/lib/sliceRevClient.ts:180-195` — `guard.resetDeskHydrated(hydrateModule); return sched.ensureAllDeskHydrated();`
- `apps/web/src/lib/rowStampClient.ts:124-135` — identical
- `apps/web/src/lib/sisNormalizedClient.ts:250-257` — resetDeskHydrated() with no argument (all desks) then ensureAllDeskHydrated()
- `apps/web/src/lib/deskHydrateGuard.ts:57-69` — resetDeskHydrated always does `inFlight.clear()`
- `apps/web/src/lib/deskHydrationSchedule.ts:375-382, 112-117` — ensureAllDeskHydrated runs allDeskHydrateTasks() ignoring HEAVY_ON_DEMAND_IDS
- FIX HINT: Reload only the conflicting desk (ensure<Module>Hydrated after resetDeskHydrated(module)); make resetDeskHydrated(module) delete only that module's inFlight entry.

### 6. [major] Route-priority hydration runs once per tab, twice on first load, never on navigation or focus; the 15 s TTL is only consulted by explicit ensure* calls  (read-in-code; S3,S4,S5)
First load: AppShell → bootstrapWorkspaceSession → ensureDeskHydratedPriority(pathname) (CORE rbac, masters, moduleRegistry, sis + ROUTE_IDS + route module states, cap 6 concurrent) → ensureStaffHydrated → then startDeskHydrationBackground → runBackgroundHydration → ensureDeskHydratedPriority AGAIN (a no-op only if each desk finished < 15 s ago; on a slow phone the whole priority tier is fetched twice) → idle sweep of ~16 non-heavy desks in batches of 4 → ensureDeskCutoverClient. In parallel CoreDataGate, useAccessData (rbac+staff), NotificationBell, CommsRunningStrip, StaffInternalChatButton (+30 s poll with a POST on every poll) and the workspace's own ensure calls all contend for the same 6 slots. In-app navigation: the boot effect returns early when bootReady and skipRouteHydrateRef is declared but never used, so neither startDeskHydrationBackground nor ensureDeskHydratedPriority runs again; only workspaces that call ensure* (50 call sites) and hydrateOnFirstRead for heavy desks load anything. visibilitychange only flushes pending pushes on hidden; no focus re-hydrate exists except PrincipalCockpit's snapshot refetch. A desk loaded 20 minutes ago is re-read only when a workspace mounts and calls its ensure*; /home dashboards never call ensureMastersHydrated, so Masters edits from another PC never reach an open tab.
- `apps/web/src/components/shell/AppShell.tsx:58, 219-269, 205-216, 274-292` — skipRouteHydrateRef unused; effect `if (bootReady) return;` with pathname in deps; visibilitychange → flushAllDeskSyncPending only; bhb-masters-updated/bhb-desk-hydrated → alignFromMasters (GET /api/session/ay)
- `apps/web/src/lib/workspaceSession.ts:88-108` — ensureDeskHydratedPriority + ensureStaffHydrated at boot
- `apps/web/src/lib/deskHydrationSchedule.ts:40-80, 87-104, 119, 302-368` — CORE_IDS, ROUTE_IDS, ROUTE_MODULE_STATES, IDLE_BATCH_SIZE 4, runBackgroundHydration calls ensureDeskHydratedPriority again at :344
- `apps/web/src/lib/deskHydrateGuard.ts:6-7, 23-27, 122-138` — 15 s TTL; MAX_CONCURRENT_HYDRATIONS = 6
- `apps/web/src/components/shell/useAccessData.ts:36-57` — rbac + staff hydrate per page
- `apps/web/src/components/shell/StaffInternalChatButton.tsx:96-97, 123-165` — ensureErpChatHydrated on mount; every 30 s pollErpChatRemote + GET /api/chat + POST /api/chat sync of the merged state
- `apps/web/src/components/shell/NotificationBell.tsx:50-51` — ensureNotificationsHydrated on mount
- `apps/web/src/components/shell/CommsRunningStrip.tsx:26, 78-83` — ensureSchoolCommsHydrated on mount; loadSchoolComms() on every render
- `apps/web/src/lib/deskLazyHydrate.ts:17-29` — heavy desks load on first read, dispatch bhb-desk-hydrated
- FIX HINT: Call ensureDeskHydratedPriority(pathname) on every pathname change (the ref was meant for this) and on visibilitychange→visible after N minutes; remove the duplicate priority pass in runBackgroundHydration; give dashboards a masters re-read.

### 7. [major] PrincipalCockpit refetches the 5 s principal snapshot on every hydration/masters event, focus and visibility with no in-flight dedupe; the snapshot runs seven un-cached server hydrates per request  (read-in-code; S6,S4)
PrincipalCockpit listens to bhb-desk-hydrated, bhb-desk-synced, bhb-masters-updated, window focus and visibilitychange and calls fetchSnapshot each time; fetchSnapshot has no in-flight guard. On the director's /home a single load emits bhb-desk-hydrated (AppShell :258 and per lazy desk), bhb-masters-updated (masters hydrate, staff hydrate, CoreDataGate, every loadSis() whose students projection changed) — 4–8 snapshot requests per load. Server side buildPrincipalSnapshot runs ensureSchoolMirrorHydrated (sis+fees+payments+masters+staff) plus ensureSisHydratedServer (full roster again), admissions, payments (again), exams, attendance and staff-attendance hydrates in parallel, none with a TTL, then loadSis()/loadMasters(). staffFees.ts does the same (mirror + sis + payments + fees). /api/chat (polled every 30 s per tab) calls ensureSchoolMirrorHydrated and can force it.
- `apps/web/src/components/dashboard/PrincipalCockpit.tsx:66-92, 128-154` — fetch `/api/v1/principal/snapshot?…&_t=Date.now()`; listeners incl. focus + visibilitychange
- `apps/web/src/lib/principalSnapshot.server.ts:78-86, 163` — Promise.all of seven server hydrates then loadMasters()/loadSis()
- `apps/web/src/lib/sisPersistence.ts:361-374` — ensureSisHydratedServer: no guard, full fetchSisFromDb every call
- `apps/web/src/lib/schoolMirrorRemote.server.ts:27, 84-120, 159-216` — 45 s TTL + probe; each refresh re-reads sis, fees, payments, masters desk and staff
- `apps/web/src/lib/api/v1/staffFees.ts:26-28` — mirror + sis + payments + fees per request
- `apps/web/src/app/api/chat/route.ts:71-74` — ensureSchoolMirrorHydrated(), forced at :74
- FIX HINT: Dedupe fetchSnapshot in flight and debounce the event fan-in; give every *HydratedServer a per-process TTL + inFlight (pattern in feeAdjustmentsPersistence.server.ts:27-56); build the snapshot from one mirror hydrate instead of re-fetching desks the mirror just loaded.

### 8. [major] loadSis()/loadMasters() are reads that parse, normalise, re-serialise, write back and broadcast on every call  (read-in-code; S4,S6)
loadSis() calls loadMasters() (JSON.parse ~235 KB + fee-setup + staff normalisation, writing back if anything changed), JSON.parses the ~1.9 MB roster, normalises every household/student, runs alignSisToMasters, re-serialises the whole roster via slimSisJson to compare with the cached string, writes back on difference, calls syncSisIntoMasters (which may writeMastersLocalRaw and dispatch bhb-masters-updated), and schedules mergeAndPersistFeeDiscountSeed. 226 call sites call loadSis() and 277 call loadMasters(); StaffInternalChatButton alone calls loadSis() in five memos. bhb-masters-updated has 8 direct listeners plus useAccessData's array; each listener re-reads via loadMasters()/loadSis(), and PrincipalCockpit re-fetches the 5 s snapshot. On a phone this is the per-interaction CPU cost behind 'slow loading'.
- `apps/web/src/lib/sis.ts:1578-1655` — loadSis: loadMasters (:1579), parse+normalise (:1595-1617), alignSisToMasters (:1630), slimSisJson compare+write (:1635-1636), syncSisIntoMasters (:1637), fee seed (:1639-1643)
- `apps/web/src/lib/sis.ts:1400-1449` — syncSisIntoMasters writes bhb_masters_v5 and dispatches bhb-masters-updated when the projection differs
- `apps/web/src/lib/masters.ts:2015-2060` — loadMasters parses, ensureFeeSetup, migrateDemoStaffToTeacherRoster, normalizeMastersStaffRoster, writes back on change
- `apps/web/src/components/shell/StaffInternalChatButton.tsx:79, 90, 172, 187, 347, 384` — loadSis()/loadMasters() in memos of a globally mounted button
- FIX HINT: Memoise the parsed object per cache string (parse once per write, not per read); move alignSisToMasters/syncSisIntoMasters/fee-seed out of the read path into the hydrate/write path.

### 9. [minor] Failure handling: most desks show the empty placeholder as fact; the toast text is wrong since 10 Oct; no fetch has a timeout  (read-in-code; S2,S5,S4)
On a non-OK GET: masters returns false without marking (CoreDataGate polls 6 s, retries once, then shows 'Could not load… Try again'); sis/fees/admissions toast reportLoadFailure 'Couldn't load X — showing your last saved data' (false: the page holds nothing), leave the desk unmarked and retry on the next ensure call; every other desk `return false` silently and the screen renders the empty/default copy; blob desks reset hydratedOnce and retry; module states 'unknown ≠ empty' retry. curriculum marks hydrated BEFORE its fetch and salarySetup/teaching mark after the blob call regardless of its result, so a failed GET passes the save guard (hasDeskLoaded sticky). No fetch passes an AbortSignal, so a stalled 1.9 MB roster GET pins its dedupe promise and one of six hydration slots indefinitely and callers awaiting it hang.
- `apps/web/src/components/shell/CoreDataGate.tsx:27-56, 62-83` — retry loop and failed state
- `apps/web/src/components/shell/Toast.tsx:35-40` — 'showing your last saved data'
- `apps/web/src/lib/sisPersistence.ts:292-299` — reportLoadFailure on !ok, no mark
- `apps/web/src/lib/curriculumPersistence.ts:233-239` — markDeskHydrated before fetch
- `apps/web/src/lib/salarySetupPersistence.ts:43-48` — markDeskHydrated after blob.ensureHydrated regardless
- `apps/web/src/lib/teachingPersistence.ts:90-95` — same
- `apps/web/src/lib/createDeskSlicePersistence.ts:102-147` — factory: `if (!ok) return false;` silent; no dedupeHydration
- `apps/web/src/lib/sisNormalizedClient.ts:362-366` — fetch without signal/timeout (same in mastersNormalizedClient :401-404, staffPersistence :192-196, deskSliceNormalizedClient :289-292)
- FIX HINT: One shared loader with AbortSignal.timeout, a per-desk 'unknown' state surfaced by screens, and a single retry/backoff; fix the toast copy.

### 10. [minor] Roster client never sends If-None-Match, so the server's ETag cache cannot 304; full 1.9 MB bodies on every GET  (measured; S4,S6)
cachedDeskJson computes an ETag from the table probe and returns not_modified when the request carries a matching If-None-Match. fetchSisDeskFromApi (and masters/staff/desk-slice clients) fetch with cache:'no-store' and no ETag header, so the probe cache only saves the DB read; the body is still serialised and downloaded (205 GET /sis-roster × 1,903 KB per day measured).
- `apps/web/src/lib/deskProbeCache.server.ts:cachedDeskJson 1-48 (relative)` — 304 only when opts.ifNoneMatch === cached.etag
- `apps/web/src/lib/sisNormalizedClient.ts:362-365` — no If-None-Match
- `apps/web/src/app/api/school-data/sis-roster/route.ts:43-86` — cachedDeskJson with ifNoneMatch from request
- FIX HINT: Keep the last ETag per desk in memory and send If-None-Match; on 304 just markDeskHydrated.

### 11. [minor] Parallel writers of bhb_masters_v5 on origin/main are all read-modify-write in one tick; no lost update among them after #578; legacy mirror path is dead  (read-in-code; S1,S5)
Writers: masters hydrate (reads loadMasters() at write time), staff hydrate (reads after its only await, writes synchronously), syncSisIntoMasters (reads at write time), saveMasters, protectLocalClasses. JS is single-threaded and none of these holds a masters snapshot across an await on main, so pairs cannot lose updates. Two residual hazards: (a) resetDeskHydrated clears inFlight for all desks, so two hydrateMastersOnce/hydrateStaffOnce can overlap and double-write meta/stamps; (b) with a populated masters but a different sections generation, loadSis()'s alignSisToMasters remaps sectionId and writes the roster back (read-that-writes against half-hydrated masters). hydrateMastersFromMirror and ensureClientSchoolMirrorHydrated never execute in the browser: deskSkipMirrorBlobSliceClient returns true unconditionally and ensureClientSchoolMirrorHydrated has no callers.
- `apps/web/src/lib/mastersPersistence.ts:39-71, 167-171` — protectLocalClasses + write-time loadMasters()
- `apps/web/src/lib/staffPersistence.ts:745-792` — single await at :745 then synchronous merge/write
- `apps/web/src/lib/sis.ts:1441-1448, 1489-1495, 1636` — syncSisIntoMasters re-reads at write time; alignSisToMasters remap + write-back
- `apps/web/src/lib/deskCutover.ts:413-415` — `deskSkipMirrorBlobSliceClient(): return true`
- `apps/web/src/lib/mastersPersistence.ts:130-147` — mirror branch guarded by that function → dead
- `apps/web/src/lib/schoolDataMirrorClientHydrate.ts:35-87` — no callers found in src (grep)

### 12. [minor] Staff hydrate wipes the local roster to [] on an empty-but-ok reply  (read-in-code; S1)
If /api/school-data/staff-roster answers ok:true with no staff, departments or designations, hydrateStaffOnce sets all three to [] and dispatches bhb-masters-updated. The route returns 503 on a DB error (fetchStaffRemoteServer null), so this needs a genuinely empty or fully filtered reply; low likelihood but it is the only client path that can produce Staff=0 on main.
- `apps/web/src/lib/staffPersistence.ts:753-767` — remoteEmpty → `next = { ...next, staff: [], departments: [], designations: [] }`
- `apps/web/src/app/api/school-data/staff-roster/route.ts:15-34` — 503 on null bundle

## tables
### A. Inventory of every exported ensure*Hydrated (origin/main 2f0eb3d4; selftests excluded)

Legend — dedupe: uses dedupeHydration (shared in-flight promise). mark: when markDeskHydrated runs relative to the fetch and the local write. #578 class: snapshots shared state before an await and writes that snapshot back. wipe: writes [] / empty over a populated local copy when remote is empty. push: schedules a push during hydrate. seed: placeholder/default data handed out before hydrate. "factory" = createDeskSlicePersistence.ts:102-147 (no dedupe; mark :117 then write :119 same tick; loadLocal() read after the await; mergeDeskSliceBundle preferDb; push only if !readFromDb :145; no event). "blob" = domainBlobPersistence.ts:218-263 (hydratedOnce flag, second caller returns false immediately; local read after await; takes remote when newer/local empty; no push; no event). "server" = Node, process-shared mirror; no TTL, no dedupe, no mark unless noted.

| # | file:line | desk key | dedupe | mark | #578 class | wipe on empty remote | push during hydrate | seed before hydrate | event |
|---|---|---|---|---|---|---|---|---|---|
| 1 | lib/mastersPersistence.ts:119 ensureMastersHydrated | bhb_masters_v5 | yes :122 | after fetch, before write (:154 / :167, same tick) | main NO (:168 loadMasters() at write); LIVE YES (:150→:151→:162-165) | no (preferDb merge skips staff slices; protectLocalClasses :39-61 keeps classes) | only if !readFromDb or mastersDeskPushPending :174-180 | emptyMastersShell on cold (masters.ts:2053) | bhb-masters-updated :186 when changed |
| 2 | lib/staffPersistence.ts:733 ensureStaffHydrated | bhb_masters_v5 (staff/departments/designations) | yes :738 | AFTER write :800 | no (loadMasters :750 after await :745) | YES :759-767 | pushStaffSlice only if !readFromDb :783 | – | bhb-masters-updated :794 |
| 3 | lib/sisPersistence.ts:253 ensureSisHydrated | bhb_sis_v1 (+masters.students projection) | yes :258 | after fetch, before write (:319 / :344) | YES :269→:288→:326/:344 | keeps when local populated :304-317; accepts empty when local empty :320 | pushSisState only if !readFromDb :339 | emptySisState | none direct (loadSis→syncSisIntoMasters dispatches bhb-masters-updated); toast on fail :295/:313 |
| 4 | lib/curriculumPersistence.ts:233 ensureCurriculumHydrated | bhb_sis_v1 + template key | no | BEFORE fetch :236 | no (loadSis after await :244) | no | no | – | none |
| 5 | lib/admissionsPersistence.ts:141 ensureAdmissionsHydrated | bhb_admissions_v1 | NO | after desk fetch, before write :177 | no (re-reads :180/:187) | YES :179-185 (readFromDb & desk empty) | scheduleAdmissionsSync if !readFromDb :195 | defaultAdmissionsState | bhb-admissions-hydrated :210; toast :172 |
| 6 | lib/attendancePersistence.ts:85 ensureAttendanceHydrated | bhb_attendance_v* | yes :87 | :103 / :114 | no (:110) | merge preferDb | if !readFromDb :125 | – | none |
| 7 | lib/feesPersistence.ts:54 ensureFeesHydrated | bhb_fees_v1 | yes :58 | :78 / :93 | no (:89) | merge preferDb | if !readFromDb :105 | – | none; toast :73 |
| 8 | lib/paymentsPersistence.ts:79 ensurePaymentsHydrated | bhb_payments_v* | yes :82 | :96 / :103 | no (:99) | merge | if !readFromDb :110 | – | none |
| 9 | lib/paymentsPersistence.ts:142 ensurePaymentLinkHydrated | one link spliced | n/a | – | no | no | no | – | none |
| 10 | lib/examsPersistence.ts:86 ensureExamsHydrated | bhb_exams_v* | NO | :98 / :109 | no (:105) | merge | if !readFromDb :119 | – | none |
| 11 | lib/homeworkPersistence.ts:82 ensureHomeworkHydrated | bhb_homework_v* | NO | :94 / :103 | no | merge | if !readFromDb :110 | – | none |
| 12 | lib/notificationsPersistence.ts:76 ensureNotificationsHydrated | bhb_notifications_v* | NO | :90 / :92 | no | merge | if !readFromDb :102 | – | none |
| 13 | lib/ptmPersistence.ts:92 ensurePtmHydrated | bhb_ptm_v* | NO | :106 / :115 | no | merge | if !readFromDb :125 | – | none |
| 14 | lib/rtePersistence.ts:75 ensureRteHydrated | bhb_rte_ews_v* | NO | :89 / :98 | no | merge | if !readFromDb :106 | – | none |
| 15 | lib/staffAttendancePersistence.ts:83 ensureStaffAttendanceHydrated | bhb_staff_attendance_v* | NO | :98 / :105 | no | merge | if !readFromDb :115 | punch settings defaults (deskLoadGuard note) | none |
| 16 | lib/studentLeavePersistence.ts:86 ensureStudentLeaveHydrated | bhb_student_leave_v* | NO | :100 / :105 | no | merge | not seen | – | none |
| 17 | lib/timetablePersistence.ts:76 ensureTimetableHydrated | bhb_timetable_v* | NO | :90 / :97 | no | merge | if !readFromDb :107 | – | none |
| 18 | lib/transportPersistence.ts:75 ensureTransportHydrated | bhb_transport_v2 | yes :78 | :94 / :101 | no | merge | if !readFromDb :113 | – | none |
| 19 | lib/trustPersistence.ts:75 ensureTrustHydrated | bhb_trust_v* | NO | :89 / :94 | no | merge | if !readFromDb :104 | – | none |
| 20 | lib/vaultPersistence.ts:78 ensureVaultHydrated | bhb_vault_v* | NO | :92 / :97 | no | merge | if !readFromDb :104 | – | none |
| 21 | lib/galleryPersistence.ts:24 ensureGalleryHydrated | bhb_school_comms_v* (albums) | NO | :33 / :36 | no | skips empty when !readFromDb :34 | if !readFromDb :42 | – | none |
| 22 | lib/newsPersistence.ts:24 ensureNewsHydrated | bhb_school_comms_v* (news) | NO | :33 / :36 | no | same :34 | if !readFromDb :42 | – | none |
| 23 | lib/schoolCommsPersistence.ts:83 ensureSchoolCommsHydrated | bhb_school_comms_v* | NO | :97 / :105 | no | merge | – | – | none |
| 24 | lib/libraryPersistence.ts:49 ensureLibraryHydrated | bhb_library_v* | NO | :63 / :65 | no | merge | if !readFromDb :71 | – | none |
| 25 | lib/payrollPersistence.ts:49 ensurePayrollHydrated | bhb_payroll_v* | NO | :63 / :65 | no | merge | – | – | none |
| 26 | lib/accountsPersistence.ts:74 ensureAccountsHydrated | bhb_accounts_v* | yes :76 | AFTER write :108 | no (:89) | merge | if !readFromDb :105; repairOrphanCashLedger writes :98-100 | – | none |
| 27 | lib/statutoryPersistence.ts:22 ensureStatutoryHydrated | bhb_statutory_remit_v* | NO | :31 / :38 | no | skips empty when !readFromDb :33 | no | – | none |
| 28 | lib/salarySetupPersistence.ts:43 ensureSalarySetupHydrated | bhb_salary_* (blob) | NO | after blob call regardless of result :45-46 | no | blob rule | no | salary structure defaults (deskLoadGuard note) | none |
| 29 | lib/teachingPersistence.ts:90 ensureTeachingHydrated | bhb_teaching_v* (blob) | NO | same :92-93 | no | blob rule | no | – | none |
| 30 | lib/rbacPersistence.ts:22 ensureRbacHydrated | bhb_rbac_v* | factory | factory | no | factory | factory | – | bhb-rbac-updated :25 |
| 31 | lib/feeRecoveryTasksPersistence.ts:29 (= desk.ensureHydrated) | bhb_fee_recovery_tasks_v* | factory | factory | no | factory | factory | – | none |
| 32 | lib/examPapersPersistence.ts:24 | bhb_exam_papers_v* | factory | factory | no | factory | factory | – | none |
| 33 | lib/certificatesPersistence.ts:20 | bhb_certificates_v* | factory | factory | no | factory | factory | – | none |
| 34 | lib/staffAgreementPersistence.ts:22 | bhb_staff_agreements_v* | factory | factory | no | factory | factory | – | none |
| 35 | lib/staffChatPersistence.ts:25 | bhb_staff_chat_v* | factory | factory | no | factory | factory | – | none |
| 36 | lib/moduleRegistryPersistence.ts:21 | bhb_module_registry_v* | factory | factory | no | factory | factory | – | none |
| 37 | lib/staffAdvancesPersistence.ts:22 | bhb_staff_advances_v* | factory | factory | no | factory | factory | – | none |
| 38 | lib/waTemplatesPersistence.ts:21 | bhb_wa_templates_v* | factory | factory | no | factory | factory | – | none |
| 39 | lib/erpChatPersistence.ts:40 | bhb_erp_chat_v* | factory | factory | no | factory | factory (+ StaffInternalChatButton POSTs merged state every 30 s poll :143-147) | – | none |
| 40 | lib/staffHrPersistence.ts:24 | bhb_staff_hr_v* | factory | factory | no | factory | factory | default CL/EL/ML/LWP leave types (deskLoadGuard.ts:5-8) | none |
| 41 | lib/automationPersistence.ts:20 | bhb_automation_v* | factory | factory | no | factory | factory | – | none |
| 42 | lib/localModulesPersistence.ts:251 ensureModuleStateHydrated | bhb_module_state:* (moduleStatePersistence.ts:106-137) | no (TTL only) | after fetch :122, before write :133 | no | takes remote when newer/local empty | no | – | MODULE_STATE_UPDATED_EVENT :135 |
| 43 | lib/localModulesPersistence.ts:255 ensureModuleStatesHydrated | n keys via #42 | – | – | – | – | – | – | per key |
| 44 | lib/localModulesPersistence.ts:259 ensureAllModuleStatesHydrated | all keys via #42 | – | – | – | – | – | – | per key |
| 45 | lib/waChatbotPersistence.ts:7 ensureWaChatbotFlowsHydrated | wa_chatbot_flows | n/a (only calls loadWaChatbotFlows :9) | – | – | – | – | – | none |
| 46 | lib/holdDecisionsCache.ts:80 ensureHoldDecisionsHydrated | /api/fees/hold-decisions :88 | not inspected | – | – | – | no | – | none |
| 47 | lib/schoolDataMirrorClientHydrate.ts:35 ensureClientSchoolMirrorHydrated | legacy mirror | hydratedOnce | – | – | – | no | – | DEAD: no callers; deskSkipMirrorBlobSliceClient always true (deskCutover.ts:413) |
| 48 | lib/deskHydrationSchedule.ts:324 ensureDeskHydratedPriority | orchestrator (CORE + route) | per task | – | – | – | – | – | bhb-admissions-hydrated :310 |
| 49 | lib/deskHydrationSchedule.ts:375 ensureAllDeskHydrated | orchestrator (all 24, ignores HEAVY_ON_DEMAND) | per task | – | – | – | – | – | same |
| 50 | lib/sisPersistence.ts:361 ensureSisHydratedServer | mirror.sis (server) | none | – | no (:368 after await :365) | returns false on empty :366 | no | – | none |
| 51 | lib/accountsPersistence.ts:151 ensureAccountsHydratedServer | server | none | – | YES :159→:174→:187 | ? | no | – | none |
| 52 | lib/admissionsPersistence.ts:262 ensureAdmissionsHydratedServer | server | none | – | YES :272→:283→:293 | ? | no | – | none |
| 53 | lib/attendancePersistence.ts:132 ensureAttendanceHydratedServer | server | none | – | YES :144→:155→:176 | ? | no | – | none |
| 54 | lib/examsPersistence.ts:126 ensureExamsHydratedServer | server | none | – | YES :134→:149→:166 | ? | no | – | none |
| 55 | lib/feesPersistence.server.ts:40 ensureFeesHydratedServer | server | none | – | YES :46→:57→:88 | ? | no | – | none |
| 56 | lib/homeworkPersistence.ts:117 ensureHomeworkHydratedServer | server | none | – | YES :127→:142→:157 | ? | no | – | none |
| 57 | lib/libraryPersistence.ts:107 ensureLibraryHydratedServer | server | none | – | YES :115→:130→:138 | ? | no | – | none |
| 58 | lib/notificationsPersistence.ts:106 ensureNotificationsHydratedServer | server | none | – | YES :118→:135→:144 | ? | no | – | none |
| 59 | lib/paymentsPersistence.ts:213 ensurePaymentsHydratedServer | server | none | – | YES :224→:239→:249 | ? | no | – | none |
| 60 | lib/payrollPersistence.ts:94 ensurePayrollHydratedServer | server | none | – | YES :102→:117→:125 | ? | no | – | none |
| 61 | lib/ptmPersistence.ts:132 ensurePtmHydratedServer | server | none | – | YES :140→:155→:169 | ? | no | – | none |
| 62 | lib/rtePersistence.ts:110 ensureRteHydratedServer | server | none | – | YES :118→:133→:146 | ? | no | – | none |
| 63 | lib/schoolCommsPersistence.ts:144 ensureSchoolCommsHydratedServer | server | none | – | YES :154→:169→:182 | ? | no | – | none |
| 64 | lib/staffAttendancePersistence.ts:122 ensureStaffAttendanceHydratedServer | server | none | – | YES :134→:147→:167 | ? | no | – | none |
| 65 | lib/staffHrPersistence.ts:49 ensureStaffHrHydratedServer | server | none | – | not inspected (:63 fetch, :80 write) | ? | no | – | none |
| 66 | lib/studentLeavePersistence.ts:120 ensureStudentLeaveHydratedServer | server | none | – | YES :132→:149→:159 | ? | no | – | none |
| 67 | lib/teachingPersistence.ts:98 ensureTeachingHydratedServer | server | none | – | no (:103 after await) | no | no | – | none |
| 68 | lib/timetablePersistence.ts:111 ensureTimetableHydratedServer | server | none | – | YES :121→:136→:149 | ? | no | – | none |
| 69 | lib/transportPersistence.ts:117 ensureTransportHydratedServer | server | none | – | YES :127→:142→:155 | ? | no | – | none |
| 70 | lib/trustPersistence.ts:108 ensureTrustHydratedServer | server | none | – | YES :116→:131→:144 | ? | no | – | none |
| 71 | lib/vaultPersistence.ts:110 ensureVaultHydratedServer | server | none | – | YES :118→:133→:142 | ? | no | – | none |
| 72 | lib/feeAdjustmentsPersistence.server.ts:27 ensureFeeAdjustmentsHydratedServer | server | TTL_MS + inFlight :31-32 (the only server hydrate with both) | – | no | writes rows :42 | no | – | none |
| 73 | lib/feeDuesInputs.server.ts:35 ensureFeeDuesInputsHydrated | server (transport + fee adjustments) | TRANSPORT_TTL_MS :42 | – | – | – | no | – | none |
| 74 | lib/schoolDataMirror.server.ts:89 ensureSchoolMirrorHydrated | whole server mirror | 45 s TTL + probe + inFlight (schoolMirrorRemote.server.ts:27, 89-99) | – | snapshot `cur` :88 then awaits (inferred lost-update vs concurrent writeSchoolMirror) | – | no | – | none |

(Rows 31-41 and 30 are const-form exports; function-form 62 + const-form 15 = 77 definitions found; three further grep hits were selftests.)

### B. What runs on first page load, per route (AppShell.tsx:219-263 → workspaceSession.ts:88-108 → deskHydrationSchedule.ts:324-368; cap 6 concurrent; then the SAME priority tier again from runBackgroundHydration :344; then idle sweep in batches of 4 of every non-heavy, non-priority desk; plus shell widgets rbac+staff (useAccessData), notifications (bell), school_comms (strip), erp_chat (chat button); plus the workspace's own ensure* calls)

| route | priority desks (CORE first: rbac, masters, moduleRegistry, sis) | route module_local_state keys | heavy desks (lazy, on first read) |
|---|---|---|---|
| /home | + sis, staff (+ staff again from bootstrap :100) | – | fees/payments/attendance/admissions only if a dashboard reads them (hydrateOnFirstRead) |
| /fees | + fees, payments, feeRecoveryTasks, transport | fee_holds, fee_adjustments | attendance, admissions |
| /students | + fees, payments, attendance | udise_compliance, fee_holds, birthday_settings, compliance_facts | admissions |
| /staff | + staff, staffHr, staffAdvances, staffAgreements, staffAttendance, salarySetup | duty_roster, staff_attendance_rules | all four |
| /masters | + salarySetup, staffHr, staff, staffAttendance | wa_chatbot_flows, staff_attendance_rules, salary_increment | all four |

In-app navigation: none of the above re-runs (AppShell effect returns on bootReady; skipRouteHydrateRef unused). Tab focus: nothing re-hydrates (AppShell :205-216 flushes pushes on hidden only); PrincipalCockpit re-fetches the principal snapshot on focus/visible. A desk loaded 20 min ago is re-read only when a workspace mounts and calls its ensure* (50 call sites), when a conflict triggers ensureAllDeskHydrated, or when a 409 on a blob/module-state push re-pulls that one desk.

## open questions
- How often does '[masters-desk] stored-state read FAILED — reporting unknown, not empty' appear in Cloud Run logs, and what fraction of the 196 GET /api/school-data/masters-desk per day returned classCount 0 / sliceCount 0 with 200? (That is the direct test of the root finding.)
- Is MASTERS_READ_FROM_ROWS set in production? (The row path has the same readFailed drop after its fallback.)
- How many bhb-desk-conflict events per day (each one triggers ensureAllDeskHydrated)? Not measurable from server logs; needs a client beacon.
- What condition forces ensureSchoolMirrorHydrated({force:true}) in /api/chat (route :72-74 not read in full)?
- Does the task's '63 ensure*Hydrated' count include const-form exports? My grep found 62 function-form + 15 const-form exported definitions (77 rows below, selftests excluded).
