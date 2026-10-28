# server-cost — SERVER-SIDE COST OF READS, AND WHY THE MOBILE API IS SLOW

## summary
The live revision 00856 and main 2f0eb3d4 are byte-identical for every server file read here (18 files diffed, 0 changed lines), so what follows is what production runs. Of the ~30 GET handlers under app/api/school-data only four (sis-roster office path, fees-vouchers, attendance-registers, admissions-desk) go through the probe-gated response cache; masters-desk's cached path is behind MASTERS_READ_FROM_ROWS, which deploy/desk-cutover-runtime.env does not set, so in production every masters-desk GET re-reads masters_desk_slices uncached with no ETag; staff-roster re-reads three tables for every browser (the cache serves only the mirror secret); sis-roster re-pulls the whole SIS (5 paged queries) uncached for every teacher-scoped request; the other ~22 desk GETs are plain per-request whole-tenant pulls with no cache and no 304. Every authenticated request that needs a teacher scope (staffSectionScope) pulls the whole timetable desk from Supabase and then discards it, because loadTimetable() returns an empty state on the server and writeTimetableLocalRaw is a no-op there. The mobile API is slow because its routes rebuild whole desks per request to answer for one person: ensureSis/Attendance/Fees/…HydratedServer have no TTL and no in-flight dedupe, ensureSchoolMirrorHydrated reads and JSON.parses a ~4 MB .data/school_mirror.json on every call and, every 45 s or whenever any of 15 probe tables changes, re-pulls the 4.13 MB legacy school_mirror_state blob plus SIS (twice), fees, payments, masters, staff, admissions and transport sequentially; each slice write-back JSON.stringifies the whole mirror to disk and the reply is held until that settles. principal/snapshot does all of that plus six more full-desk hydrates in parallel on a 1-vCPU, min-instances=0, cpu-throttled Cloud Run instance, which is the 5.03 s. The high-frequency endpoints are mostly cheap individually (fleet-edge is an external push with two inserts; domain-blob and open-dues-summary are one small query each) but each still pays the per-request auth stack, and the WhatsApp webhook (2.98 s) hydrates the mirror, calls the Graph API per delivery and holds its reply for tracked work, all on the same event loop as page loads.

## findings

### 1. [root] Mobile routes rebuild whole desks from Supabase per request, with no TTL and no in-flight dedupe (S6, the 5.03 s)  (read-in-code; S6)
principal/snapshot calls resolveApiAuth, then assertSchoolWide (staffSectionScope → timetable pull), then buildPrincipalSnapshot which runs seven server hydrates in parallel: ensureSchoolMirrorHydrated, ensureSisHydratedServer, ensureAdmissionsHydratedServer, ensurePaymentsHydratedServer, ensureExamsHydratedServer, ensureAttendanceHydratedServer, ensureStaffAttendanceHydratedServer. None of the ensure*HydratedServer helpers has a TTL, probe or in-flight guard: each call does the full desk pull (SIS = 5 paged queries ≈1.9 MB; attendance = registers paged + marks in 150-id chunks ≈685 KB; fees = headers + lines + tenders in 200-id chunks ≈1.5 MB) and writes it back into process memory. Two of them (the mirror's own ensureSisHydratedServer and the direct one) pull the same SIS concurrently. The snapshot then also runs stockReport, storeDuesSummary and the fee_open_dues_summary RPC. The same pattern answers one family's or one teacher's question in comms/feed (full comms desk), staff/approvals (scope + mirror + SIS + student-leave + complaints + staff HR), parent/attendance (every register and every mark of the school for one child), homework/feed (full homework desk), app/popups (full SIS to find one household's children). Cloud Run: 1 vCPU, concurrency 20, min-instances 0, cpu-throttling — the per-process caches are lost on every cold instance and all of this JSON work serialises on one core.
- `apps/web/src/app/api/v1/principal/snapshot/route.ts:13-20` — resolveApiAuth → assertSchoolWide → buildPrincipalSnapshot per request; Cache-Control no-store
- `apps/web/src/lib/principalSnapshot.server.ts:77-85, 96, 113, 133` — Promise.all of 7 ensure*Hydrated helpers, then stockReport, storeDuesSummary, fetchOpenDuesSummary
- `apps/web/src/lib/sisPersistence.ts:361-374` — ensureSisHydratedServer: unconditional fetchSisFromDb, no TTL, writes back via writeSisLocalRaw
- `apps/web/src/lib/attendancePersistence.ts:132-178` — ensureAttendanceHydratedServer: unconditional fetchAttendanceDeskFromDb, no TTL
- `apps/web/src/lib/sisNormalized.server.ts:648-682` — fetchSisFromDb = 5 parallel paged queries (households, students, sync_meta, tags, class_upgrades)
- `apps/web/src/lib/attendanceNormalized.server.ts:306-360` — registers paged + marks via fetchByIds in 150-id chunks
- `apps/web/src/lib/feesNormalized.server.ts:660-700, 339-366` — voucher headers paged, then lines and tenders in 200-id chunks
- `apps/web/src/app/api/v1/staff/approvals/route.ts:23-29` — staffSectionScope + ensureSchoolMirrorHydrated + ensureSisHydratedServer + ensureStudentLeaveHydratedServer per call
- `apps/web/src/app/api/v1/parent/attendance/route.ts:17-32, 51` — mirror + full attendance hydrate for one child
- `apps/web/src/app/api/v1/app/popups/route.ts:35-48` — householdChildren per call
- `apps/web/src/lib/appPopups.server.ts:49-53` — householdChildren → ensureSisHydratedServer (full SIS) then filters one householdId
- `apps/web/src/app/api/v1/comms/feed/route.ts:16-19` — ensureSchoolMirrorHydrated + ensureSchoolCommsHydratedServer per call
- `apps/web/src/lib/schoolCommsPersistence.ts:147-169` — ensureSchoolCommsHydratedServer: unconditional fetchSchoolCommsDeskFromDb
- `apps/web/cloudbuild.yaml:136-174` — --cpu=1, --min-instances=0, --max-instances=20, --concurrency=20, --cpu-throttling
- FIX HINT: Answer per-person questions with per-person queries (sis_students where household_id = …, attendance_desk_marks where student_id = …); give every ensure*HydratedServer a probe/TTL + in-flight promise like hydrateSchoolMirrorFromRemote; build principal/snapshot from SQL aggregates (RPC) instead of hydrating seven desks.

### 2. [root] ensureSchoolMirrorHydrated re-parses a ~4 MB disk file on every call and, on every re-hydrate, pulls the discarded 4.13 MB legacy blob plus SIS twice, fees, payments, masters, staff, admissions and transport sequentially  (read-in-code; S6,S4)
ensureSchoolMirrorHydrated() first calls ensureSchoolMirrorLoaded(), which has no memo guard: every call fs.readFile()s .data/school_mirror.json and JSON.parse()s it (sis+fees+payments+masters+admissions ≈ the 4.13 MB the chat route comments measure) and replaces the in-memory mirror. Then hydrateSchoolMirrorFromRemote runs when 45 s have passed since the last hydrate OR the mirror 'looks empty' OR the 15-table probe fingerprint changed. The re-hydrate is sequential: fetchServerBlob('school_mirror_state') (the whole legacy blob, whose sis/fees/payments/admissions slices are then thrown away because every *_READ_FROM_DB flag is true), ensureSisHydratedServer (full SIS), ensureFeesHydratedServer (full fee desk), ensurePaymentsHydratedServer, fetchMastersDeskFromDb, fetchStaffRemoteServer, fetchSisFromDb AGAIN (line 231), fetchAdmissionsRemoteServer, ensureFeeDuesInputsHydrated({force:true}) (transport + adjustments). Every slice write-back (writeSisLocalRaw/writeFeesLocalRaw/… → setMirrorSlice) fires diskPersist, which JSON.stringify()s the whole mirror and writes it to disk, and that write is wrapped in trackServerWork so the HTTP reply is held until it settles (cap 25 s). The probe tables include fee_desk_vouchers, sis_students, module_local_state and transport_desk_slices, so any counter receipt, roster edit or module-state save on any browser invalidates the mirror on every instance. Called from every mobile route above, the WhatsApp webhook (twice: route and bot), ptm-desk GET, events, chat fallback, and the mirror-secret auth context.
- `apps/web/src/lib/schoolDataMirror.server.ts:66-95` — ensureSchoolMirrorLoaded reads+parses the file unconditionally; ensureSchoolMirrorHydrated calls it then hydrateSchoolMirrorFromRemote
- `apps/web/src/lib/schoolDataMirror.server.ts:36-62` — persistMirrorQuiet: JSON.stringify(whole mirror) + fs.writeFile, registered as diskPersist and tracked by trackServerWork
- `apps/web/src/lib/schoolDataMirror.ts:60-71` — setMirrorSlice → diskPersist?.() on every slice write
- `apps/web/src/lib/sis.ts:1747-1749` — writeSisLocalRaw on the server = setMirrorSlice('sis')
- `apps/web/src/lib/fees.ts:1563-1564` — writeFeesLocalRaw on the server = setMirrorSlice('fees')
- `apps/web/src/lib/schoolMirrorRemote.server.ts:25-52, 84-120` — 45 s TTL, mirrorLooksEmpty bypass, 15 probe tables incl. module_local_state / fee_desk_vouchers / sis_students
- `apps/web/src/lib/schoolMirrorRemote.server.ts:121-123, 159-183, 193-198, 216, 230-231, 245-247, 259-263` — sequential: legacy blob, SIS hydrate, fees, payments, masters desk, staff, fetchSisFromDb again, admissions, fee-dues inputs (force)
- `apps/web/src/lib/serverWorkTracker.server.ts:33, 54-66` — HOLD_CAP_MS 25 000: reply waits for tracked work
- `apps/web/src/app/api/chat/route.ts:90-93` — comment measuring school_mirror_state at 4.13 MB
- `apps/web/deploy/desk-cutover-runtime.env:50-51, 60-61, 83, 90` — FEES/MASTERS/PAYMENTS/SIS READ_FROM_DB=true, so the blob's slices are discarded after being fetched
- `apps/web/src/lib/waUnifiedBotServer.ts:2297` — bot calls ensureSchoolMirrorHydrated again per inbound message
- FIX HINT: Memoise ensureSchoolMirrorLoaded (load the disk file once per process, or drop the disk file on Cloud Run entirely); stop fetching school_mirror_state when every slice is READ_FROM_DB; remove the second fetchSisFromDb; make diskPersist debounced and untracked; narrow the probe table list per consumer.

### 3. [root] Only 4 of ~30 school-data GET handlers are cached; masters-desk's cache is dead in production, staff-roster and teacher sis-roster re-pull per request, and no uncached route sends an ETag (S4)  (read-in-code; S4,S2,S1)
cachedDeskJson (probe RPC every ≤5 s + in-process body cache + ETag/304) is used only by sis-roster (office branch), fees-vouchers, attendance-registers and admissions-desk; cachedBlobJson by domain-blob. masters-desk reaches cachedDeskJson only when readFromRowTables() is true, i.e. MASTERS_READ_FROM_ROWS=true; that variable is absent from deploy/desk-cutover-runtime.env, so production takes the final branch: fetchMastersDeskFromDb (masters_desk_slices select * + meta) on every one of the 196 daily calls, no cache, no ETag, and updatedAt defaulted to new Date() when meta is missing. staff-roster: every non-mirror caller (i.e. every browser) hits fetchStaffRemoteServer (3 paged tables) then redacts, with Cache-Control no-store; the cachedDeskJson block is reachable only via the mirror secret. sis-roster: a staff session without students.edit whose scope is restricted takes the teacher branch — full fetchSisFromDb (5 paged queries, the whole school) per request, then filters, no cache, no-store. The remaining desk GETs (accounts, exams, gallery, homework, library, news, notifications, payment-links, payroll, rte, school-comms, statutory, student-leave, timetable, transport, trust, vault, wa-threads, desk-slice/*, curriculum, admissions blob, masters-parity) each run their fetchXDeskFromDb per request with no cache layer and no If-None-Match handling. Attendance for teachers re-JSON.parses the whole cached 685 KB body and filters on every request. Combined with the client hydrating whole desks on every page (sweep of 24 desk ids), the server does whole-tenant reads for routes that need a few rows.
- `apps/web/src/lib/deskProbeCache.server.ts:17-39, 57-94, 123-154` — probe cached 5 s per key; responseCache keyed by cacheKey, max 80 entries, ETag = probe; cachedBlobJson = 1 updated_at select
- `apps/web/src/app/api/school-data/masters-desk/route.ts:45-48, 120-141, 175-187` — readFromRowTables gate; cached path; uncached fallback used in prod
- `apps/web/deploy/desk-cutover-runtime.env:1-93` — MASTERS_READ_FROM_ROWS and LEAN_WIRE_PAYLOAD not present
- `apps/web/src/app/api/school-data/staff-roster/route.ts:34-52, 55-67` — per-browser fetchStaffRemoteServer + no-store; cache only for mirror secret
- `apps/web/src/lib/staffPersistence.ts:228-241` — fetchStaffRemoteServer = 3 tables, fetchAllPages each
- `apps/web/src/app/api/school-data/sis-roster/route.ts:33-62, 65-115` — teacher branch uncached full pull + filter; office branch cachedDeskJson
- `apps/web/src/app/api/school-data/attendance-registers/route.ts:120-157` — scoped callers: ifNoneMatch null, JSON.parse(result.body) + scopeDeskBody per request
- `apps/web/src/app/api/school-data/desk-slice/[module]/route.ts:97-112` — fetchDeskSliceFromDb per request, no cache
- `apps/web/src/app/api/school-data/fees-vouchers/route.ts:58-78` — cachedDeskJson probe 4 tables
- `apps/web/src/app/api/school-data/admissions-desk/route.ts:103` — cachedDeskJson (per classification grep)
- FIX HINT: Set MASTERS_READ_FROM_ROWS (or make the cached path unconditional); wrap staff-roster, masters-desk and every fetchXDeskFromDb GET in cachedDeskJson with per-role variants (cacheKey + ':teacher:' + staffId) and honour If-None-Match; cut the teacher sis-roster branch to a WHERE class_id/section_id IN (...) query.

### 4. [major] Every teacher-scoped request pulls the whole timetable desk from Supabase and throws it away (server loadTimetable is always empty)  (read-in-code; S2,S4,S6)
staffSectionScope() (called by sis-roster teacher branch, attendance-registers, module-state student books, ptm-desk, staff-attendance-registers, homework/feed via assertSectionScope, staff/approvals, principal/snapshot via assertSchoolWide, and the deskFeatureGate class-scoped path) awaits ensureTimetableHydratedServer() when the session has a staffId. That function fetches timetable_desk_slices (select *) + timetable_desk_sync_meta, merges, and calls writeTimetableLocalRaw — which returns immediately when window is undefined. loadTimetable() likewise returns emptyTimetableState() on the server, so grids is always [] in teachingSectionsFor: the network round trip is pure cost, and timetable-derived sections never count toward a teacher's server-side scope (only classTeacherLinks and subjectTeachingLinks do). A teacher whose only link to a section is the timetable gets scope.sections empty → sis-roster returns zero students (S2) and attendance registers filter to nothing.
- `apps/web/src/lib/api/v1/staffScope.ts:77-96` — ensureTimetableHydratedServer awaited per call; grids passed to teachingSectionsFor
- `apps/web/src/lib/timetablePersistence.ts:111-151` — fetchTimetableDeskFromDb every call; writeTimetableLocalRaw(state)
- `apps/web/src/lib/timetable.ts:471-472, 497` — loadTimetable returns emptyTimetableState() on server; writeTimetableLocalRaw returns when window undefined
- `apps/web/src/lib/timetableNormalized.server.ts:272-275` — timetable_desk_slices select * + sync meta
- `apps/web/src/lib/staffTeachingScope.ts:126-150` — sections from classTeacherLinks, subjectTeachingLinks, then grids (empty on server)
- `apps/web/src/app/api/school-data/sis-roster/route.ts:34-36, 45-47` — scope.sections decides which students a teacher receives
- FIX HINT: Keep a server-side timetable memory copy (like serverAttendanceCache) with a probe/TTL, or compute scope from timetable rows in SQL; cache the scope per staffId for the request lifetime.

### 5. [major] Per-request fixed cost: 0–8 Supabase round trips before any route work, with a thundering-herd masters/staff load on cold instances  (read-in-code; S4,S6)
resolveApiAuth on every authenticated call: getDemoSession (cookie verify, no DB), then loadServerMasters (30 s module cache; a miss = fetchMastersDeskFromDb [2 queries] + fetchStaffRemoteServer [3 paged tables], and there is no in-flight promise, so N concurrent misses on a fresh instance issue N×5 queries) and loadServerRbacIfKnown (30 s cache re-validated by one rbac_desk_sync_meta select every 5 s; a miss = fetchDeskSliceFromDb('rbac')), plus getServerTenantContext (tenants select once per process, then cached; a new service client object per call). Parents add readFamilyRollStatus (cached per household with TTL). Routes that need scope add the timetable pull above. deskReadGate/deskFeatureGateFor call requireStaffApi a second time (another resolveApiAuth, served from the 30 s caches when warm). deskProbe adds one RPC per cache key per 5 s. On a cold instance (min-instances 0) the first request pays tenants + masters(2) + staff(3) + rbac(1–2) ≈ 7–8 round trips before its own work.
- `apps/web/src/lib/api/v1/auth.ts:316-346` — resolveApiAuth: loadServerMasters + loadServerRbacIfKnown in parallel, parent roll-status check
- `apps/web/src/lib/api/v1/auth.ts:189-223` — MASTERS_CACHE_TTL_MS 30 000; no in-flight dedupe; fetchMastersDeskFromDb + fetchStaffRemoteServer on miss
- `apps/web/src/lib/api/v1/auth.ts:55-158` — RBAC_CACHE_TTL_MS 30 000, RBAC_PROBE_MS 5 000, fetchDeskSliceFromDb('rbac') on miss
- `apps/web/src/lib/serverTenant.ts:9-29` — tenantId cached per process; createServiceSupabase per call
- `apps/web/src/lib/auth.ts:28-31` — getDemoSession = cookie verify only
- `apps/web/src/lib/parentFamilyStatus.server.ts:41-63` — readFamilyRollStatus cache with TTL
- `apps/web/src/lib/deskFeatureGate.server.ts:72-79, 105-120` — featureGate re-runs requireStaffApi after authorizeSchoolDataDesk
- `apps/web/src/lib/apiRouteAuth.server.ts:134-174, 313-323` — requireStaffApi → resolveApiAuth; authorizeSchoolDataDesk → requireStaffPermission
- FIX HINT: Coalesce loadServerMasters/loadServerRbac behind an in-flight promise; cache the resolved ApiAuthContext per request (AsyncLocalStorage or pass ctx) so gates do not re-resolve; consider min-instances=1 during school hours.

### 6. [major] The WhatsApp webhook (837/day, 2.98 s) hydrates the school mirror twice, calls the Graph API per delivery and holds its reply for tracked background work — on the same vCPU as page loads  (read-in-code; S6,S4)
POST /api/whatsapp/webhook re-exports /api/wa/webhook. Each delivery: verify signature, await ensureSchoolMirrorHydrated() (disk parse + possibly the full sequential re-hydrate from the finding above), trackServerWork(ensureWabaWebhookSubscription()) which does a GET https://graph.facebook.com/…/subscribed_apps on every delivery (no once-per-process guard), then synchronous claim/log/bot dispatch; handleWaUnifiedInbound calls ensureSchoolMirrorHydrated again and sends the outbound reply inline. Because --cpu-throttling is on, lib/serverWorkTracker holds res.end until every trackServerWork task settles (cap 25 s), so Graph API latency and the mirror disk write land inside the measured request time. Any bot write to a probe table (module_local_state is in MIRROR_PROBE_TABLES) invalidates the mirror for every instance, so the next mobile call re-hydrates in full.
- `apps/web/src/app/api/whatsapp/webhook/route.ts:1-6` — re-export of /api/wa/webhook
- `apps/web/src/app/api/wa/webhook/route.ts:94-101` — await ensureSchoolMirrorHydrated(); trackServerWork(ensureWabaWebhookSubscription())
- `apps/web/src/lib/waMeta.server.ts:161-186` — listWabaSubscribedApps + possible subscribe POST to graph.facebook.com per call, no memo
- `apps/web/src/lib/waUnifiedBotServer.ts:2297` — second ensureSchoolMirrorHydrated inside the bot
- `apps/web/src/lib/serverWorkTracker.server.ts:33, 54-66, 121` — reply held until tracked work settles, cap 25 s
- `apps/web/cloudbuild.yaml:161-174` — --cpu-throttling with the explanation that replies wait for tracked work
- `apps/web/src/lib/schoolMirrorRemote.server.ts:32-52` — module_local_state and transport_desk_slices in the probe list
- FIX HINT: Guard ensureWabaWebhookSubscription with a per-process 'checked' stamp; let the bot read the rows it needs instead of hydrating the mirror; move slow bot work to a queue (Cloud Tasks) so the webhook replies in <500 ms.

### 7. [minor] Dashboard pollers: /api/inventory/sales and /api/fees/open-dues-summary are re-fetched on every bhb-* desk event, /api/chat every 30 s per tab, domain-blob by the idle sweep  (read-in-code; S4)
ModuleDashboardHost re-runs its figure effect on every bhb-masters-updated, bhb-sis-updated and bhb-desk-hydrated event (the idle sweep emits one per desk, 24 desk ids) and on mastersTick; for the fees dashboard that calls patchFeeDashWithStoreDues → fetchOpenDuesSummary (GET /api/fees/open-dues-summary) and the store dues summary (GET /api/inventory/sales?view=dues-summary), each behind a 15 s shortCached window — so a fee dashboard open fires several pairs across the sweep, which is the 1,559 + 1,578 calls/day from a few office PCs. FeeTakeWorkspace also hits /api/inventory/sales?view=dues per student search. StaffInternalChatButton is mounted in AppShell and polls GET /api/chat every 30 s per open tab; its fast path is one sis_households select + an in-memory chat state (first read from .data/erp_chat.json per instance), the fallback hydrates the mirror (with a forced second hydrate if masters are missing). domain-blob (1,406/day) is the idle sweep over the fees_state/payments_state/… blob tables plus erp_chat_state; the server answers with one updated_at select on a cache hit. Server cost per call is small (RPC fee_open_dues_summary; aggregate queries over inv_sales) but every call pays the resolveApiAuth fixed cost and shares the event loop. POST /api/transport/fleet-edge/live (2,309/day) is Tata Fleet Edge pushing telemetry, not a browser poller: IP allow-list, no session, one or two inserts into fleet_edge_events / fleet_vehicle_positions; it does not touch a mirror probe table.
- `apps/web/src/components/dashboard/ModuleDashboardHost.tsx:32-42, 81-111` — listeners for bhb-masters-updated / bhb-sis-updated / bhb-desk-hydrated; fees effect imports feeStoreDuesKpi on every run
- `apps/web/src/lib/feeStoreDuesKpi.ts:23, 37, 74-96` — DASH_FIGURES_TTL_MS 15 000; fetches /api/inventory/sales?view=dues-summary and /api/fees/open-dues-summary
- `apps/web/src/components/fees/FeeTakeWorkspace.tsx:704` — /api/inventory/sales?view=dues&studentIds=… per search
- `apps/web/src/app/api/fees/open-dues-summary/route.ts:24-34` — requireStaffPermission + fetchOpenDuesSummary, no-store
- `apps/web/src/lib/feesDeskAncillary.server.ts:663` — RPC fee_open_dues_summary
- `apps/web/src/lib/inventory/sales.server.ts:756-780, 917-930` — counterSummary / storeDuesSummary aggregate over inv_sales
- `apps/web/src/components/shell/StaffInternalChatButton.tsx:134, 155-161` — GET /api/chat every 30 000 ms per tab
- `apps/web/src/components/shell/AppShell.tsx:437` — StaffInternalChatButton mounted globally
- `apps/web/src/app/api/chat/route.ts:66-78, 85-108` — lite actor path vs mirror fallback with forced re-hydrate
- `apps/web/src/lib/erpChatServer.ts:15-29` — chat state cached in memory after one disk read per instance
- `apps/web/src/lib/domainBlobPersistence.ts:14-25, 122` — blob table list; GET /api/school-data/domain-blob?table=
- `apps/web/src/lib/erpChatPersistence.ts:49` — erp_chat_state also read through domain-blob
- `apps/web/src/lib/deskHydrationSchedule.ts:40-44, 113-119, 128-240` — 24 desk ids in the sweep, IDLE_BATCH_SIZE 4
- `apps/web/src/app/api/transport/fleet-edge/live/route.ts:31-50` — IP allow-list, ingestFleetEdgePush, no auth stack
- `apps/web/src/lib/fleetEdge.server.ts:583, 622` — inserts into fleet_edge_events and fleet_vehicle_positions
- FIX HINT: Debounce the dashboard figure refresh (one fetch after the sweep settles, not per event); raise the chat poll to 60–90 s and pause when document.hidden; keep fleet-edge as is.

### 8. [minor] Server masters/mirror freshness lags and empty-mirror retry storms can show stale or missing classes to server consumers (S3/S5, server side)  (inferred; S3,S5)
Server-side RBAC and scope use loadServerMasters (30 s cache), the mirror's masters are refreshed at most every 45 s unless a probe table changed, and the principal snapshot/WhatsApp bot read masters from the mirror. A Masters save therefore reaches server consumers up to 30–45 s late. Conversely mirrorLooksEmpty() returns true whenever masters.classes is empty, which bypasses the 45 s TTL and re-hydrates on every call until classes appear — the comment at lines 72-80 records this exact failure (a cold instance's masters read lagging) and the chat route comment records the disk file overwriting good in-memory masters with nothing. Staff without masters.view get teachingMastersResponse, which is an uncached fetchMastersDeskFromDb per request and a 503 when it fails. These are freshness/availability edges of the server copies, not the browser's desk memory; the browser-side S3/S5 mechanism is outside this lens.
- `apps/web/src/lib/schoolMirrorRemote.server.ts:62-82, 89-95` — mirrorLooksEmpty → TTL bypass; classes absent = empty
- `apps/web/src/app/api/chat/route.ts:56-66` — comment: disk file overwrote in-memory masters with nothing; 45 s TTL kept returning the empty mirror
- `apps/web/src/lib/api/v1/auth.ts:189-200` — 30 s masters cache for RBAC/scope
- `apps/web/src/app/api/school-data/masters-desk/route.ts:72-105` — teachingMastersResponse: uncached fetchMastersDeskFromDb, 503 on readFailed
- FIX HINT: Invalidate the server masters/mirror caches from the masters-desk POST handler (same process) and bump the probe; never let the disk snapshot replace a non-empty in-memory mirror.

## tables
### School-data GET routes — server cost (read from code; wire sizes/call counts MEASURED from Cloud Run logs where given)

| Route (GET) | Auth / scope work per call | Tables read | Paged | Reads whole tenant? | Server cache | ETag/304 | Wire (24 h) |
|---|---|---|---|---|---|---|---|
| sis-roster (office) | authorizeSchoolDataDesk + staffSectionScope (timetable pull) | sis_households, sis_students, sis_sync_meta, sis_student_tags, sis_class_upgrades | yes (fetchAllPages) | yes | cachedDeskJson key `sis-roster`, probe 4 tables / 5 s | yes | 205 calls, avg 1,903 KB |
| sis-roster (teacher branch) | same | same 5 queries | yes | yes, then filtered in Node | NONE (no-store) | no | part of the 205 |
| fees-vouchers | deskReadGate (auth ×1–2) | fee_desk_vouchers + lines + tenders (200-id chunks) + open_dues ancillary + meta | yes | yes | cachedDeskJson, probe 4 tables | yes | 265 calls, avg 1,482 KB |
| attendance-registers | authorize + optional featureGate + staffSectionScope (timetable pull) | attendance_desk_registers + marks (150-id chunks) + sync meta + ancillary | yes | yes; teacher = JSON.parse whole body + filter per call | cachedDeskJson, probe 2 tables | office yes; scoped no | 141 calls, avg 685 KB |
| masters-desk | authorizeSchoolDataDesk (403 → teaching subset) | masters_desk_slices (select *), masters_desk_sync_meta | n/a (slices) | yes | NONE in prod (cached path needs MASTERS_READ_FROM_ROWS, not set) | no | 196 calls, avg 235 KB |
| staff-roster | requireStaffApi | sis_staff, sis_departments, sis_designations | yes | yes, redacted per caller | NONE for browsers (cache only via mirror secret) | no (no-store) | 257 calls, avg 148 KB |
| domain-blob?table= | requireStaffPermission | one row of the named *_state table | n/a | one blob | cachedBlobJson (1 updated_at select on hit) | yes | 1,406 calls (GET+POST) |
| admissions-desk | authorize | admission_desk_households, leads, registration_payments, field_ops, meta | yes | yes | cachedDeskJson | yes | — |
| desk-slice/[module] | requireStaffPermission (+ featureGate for staff_hr) | <module>_desk_slices + meta | n/a | yes | NONE | no | — |
| module-state/[module] | bookAuth (+ staffSectionScope for student books, complaintScopeFilter) | module_local_state one row | n/a | one row, filtered in Node | NONE | no | — |
| ptm-desk | staffSectionScope + ensureSchoolMirrorHydrated + ensureSisHydratedServer + loadSis | ptm desk + the whole mirror hydrate | — | yes | NONE (no-store) | no | — |
| staff-attendance-registers | authorize + staffSectionScope | staff attendance desk | yes | yes | NONE | no | — |
| accounts-desk, exams-desk, gallery-desk, homework-desk, library-desk, news-desk, notifications-desk, payment-links, payroll-desk, rte-desk, school-comms-desk, statutory-desk, student-leave-desk, timetable-desk, transport-desk, trust-desk, vault-desk, wa-threads-desk | authorize (some deskReadGate) | each desk's row tables via fetchXDeskFromDb | mostly fetchAllPages | yes | NONE | no | — |
| admissions (legacy) | requireStaffPermission | admissions_state blob | n/a | one blob | NONE | no | — |
| curriculum | requireStaffPermission | curriculum tables (fetchCurriculumRemoteServer) | — | yes | NONE | no | — |
| masters-parity | requireStaffPermission | masters_desk_slices | n/a | yes | NONE | no | diagnostic |
| mirror | none to DB | process memory | — | — | — | — | — |
| ensure-desk, sis-promote | POST-only workflows | — | — | — | — | — | — |

### Mobile API routes — what one request rebuilds (MEASURED averages from Cloud Run logs)

| Route | Per-request work (in order) | Whole desks rebuilt | In-process cache & TTL | Measured avg |
|---|---|---|---|---|
| GET /api/v1/principal/snapshot | resolveApiAuth → assertSchoolWide (timetable pull) → Promise.all[mirror hydrate, SIS, admissions, payments, exams, attendance, staff attendance] → stockReport → storeDuesSummary → fee_open_dues_summary RPC | SIS (×2 with the mirror), fees, payments, admissions, exams, attendance (all marks), staff attendance, masters, staff, transport | mirror 45 s TTL + 15-table probe; ensure*HydratedServer: NONE; masters/rbac auth caches 30 s | 242 calls, 5.03 s |
| GET /api/v1/comms/feed | resolveApiAuth → ensureSchoolMirrorHydrated → ensureSchoolCommsHydratedServer | mirror (if due) + whole comms desk | comms: NONE | 1.86 s |
| GET /api/v1/staff/approvals | resolveApiAuth → staffSectionScope (timetable) → mirror → SIS + student-leave → complaints → staff HR slice | mirror + SIS + student leave + complaints + staff_hr | NONE except mirror | 1.70 s |
| GET /api/v1/parent/summary | resolveApiAuth (+ roll-status cache) → mirror → loadSis → per-child open-dues cache reads → parent_app_presence upsert → schoolWhatsAppContact | mirror (if due); otherwise reads process memory | mirror 45 s; presence upsert every call | 1.46 s |
| GET /api/v1/app/popups | resolveApiAuth → householdChildren → ensureSisHydratedServer (full SIS) → readAppPopups (1 row) + readPopupEvents | whole SIS for one household | NONE | 0.96 s |
| GET /api/v1/homework/feed | resolveApiAuth → mirror → ensureHomeworkHydratedServer → assertSectionScope (timetable) | mirror + whole homework desk | NONE | — |
| GET /api/v1/parent/attendance | resolveApiAuth → mirror → ensureAttendanceHydratedServer | mirror + all registers + all marks for one child | NONE | — |

### Per-request fixed cost (read from code)

| Step | Where | Round trips (warm / cold instance) |
|---|---|---|
| Session cookie verify | lib/auth.ts:28-31 | 0 / 0 |
| Tenant id | lib/serverTenant.ts:9-29 | 0 / 1 (then cached) |
| loadServerMasters | lib/api/v1/auth.ts:189-223 | 0 (30 s) / 5 (masters 2 + staff 3), no in-flight dedupe |
| loadServerRbac | lib/api/v1/auth.ts:55-158 | 0–1 (probe every 5 s) / 1–2 |
| Parent roll status | lib/parentFamilyStatus.server.ts:41-63 | 0 (TTL) / 1 |
| staffSectionScope (when used) | lib/api/v1/staffScope.ts:77-89 → timetablePersistence.ts:111-151 | 2 every call (result discarded on server) |
| deskProbe (cached routes) | lib/deskProbeCache.server.ts:23-39 | 1 RPC per key per 5 s |
| Feature gate second auth | lib/deskFeatureGate.server.ts:72-79 | 0 warm (re-uses 30 s caches) |

### High-frequency endpoints (MEASURED counts; cost read from code)

| Endpoint | Calls/day | Who calls | Server cost per call | Competes for the vCPU? |
|---|---|---|---|---|
| POST /api/transport/fleet-edge/live | 2,309 | Tata Fleet Edge push (external), not a browser | IP check + JSON parse + 1–2 inserts; no auth stack; not a probe table | low |
| GET+POST /api/chat | ~2,600 | StaffInternalChatButton in AppShell, 30 s per open tab | fast path: cookie + 1 sis_households select + in-memory chat state; fallback: full mirror hydrate (+forced second) | low (fast path) / high (fallback) |
| GET /api/inventory/sales | 1,578 | fees dashboard effect on every bhb-* desk event (15 s shortCached) + Fee Take per student | resolveApiAuth + aggregate queries on inv_sales | medium (auth stack) |
| GET /api/fees/open-dues-summary | 1,559 | same dashboard effect | resolveApiAuth + RPC fee_open_dues_summary | medium (auth stack) |
| /api/school-data/domain-blob | 1,406 | idle hydration sweep (fees_state…staff_advances_state) + erp_chat_state | resolveApiAuth + 1 updated_at select on hit | medium (auth stack) |
| POST /api/whatsapp/webhook | 837 (avg 2.98 s) | Meta | mirror hydrate ×2, Graph API call, claims/logs, bot, outbound send; reply held for tracked work | HIGH |

## open questions
- Does the live Cloud Run env (Secret Manager / service env, not deploy/desk-cutover-runtime.env) set MASTERS_READ_FROM_ROWS, LEAN_WIRE_PAYLOAD or SIS_IDENTITY_SPLIT? The deploy file in the repo does not; if the service env does, the masters-desk cached path is live and that row of the table changes.
- What share of the 205 daily sis-roster calls take the teacher branch (uncached, no-store) versus the office branch (cached)? Cloud Run logs with the X-Desk-Cache header (absent on the teacher branch) would answer it.
- How many cold starts per school day does min-instances=0 / max 20 produce, and how often do the 15 mirror probe tables change during office hours? Together they decide how often the 45 s TTL actually saves a full re-hydrate.
- Size and age of .data/school_mirror.json and .data/erp_chat.json on a running instance (both are per-instance; staff chat state therefore differs between instances — off-lens but worth confirming).
- Is the 5.03 s principal/snapshot average dominated by cold instances or also seen on warm ones? A per-instance breakdown would separate the cold-start cost from the per-request desk rebuild cost.
