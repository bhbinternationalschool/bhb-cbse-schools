# mobile-app — Flutter apps (parent + staff flavours) — why "the app slows down" (S6)

## summary
The Flutter app has no data layer at all: every screen calls the ERP directly with package:http's top-level get/post, which opens and closes a fresh Client (new TCP+TLS) per call, with no client cache, no stale-while-revalidate, no retry and no timeout (pubspec has no shared_preferences/hive/sqflite; only flutter_secure_storage for the cookie). Every home screen paints a spinner until its first payload lands, so the phone's perceived speed IS the server's /api/v1 latency. That latency is explained on the server, not the phone: every /api/v1 request runs resolveApiAuth (masters desk + staff roster + RBAC reads behind 30 s per-instance caches) and then the route's own ensure*HydratedServer calls, most of which have NO TTL or probe — ensureSisHydratedServer re-pages all of sis_households + sis_students (`select *`, the 1.9 MB roster) on every call, ensureTimetableHydratedServer runs inside staffSectionScope on every staff request, and /api/v1/principal/snapshot awaits seven whole-desk hydrates per call. Only the school-mirror hydrate has a 45 s TTL + probe. Live revision 00856 files for these routes/libs are byte-identical to main (diffed). On top of that the app multiplies calls: opening a staff home fires 6–7 requests (summary/snapshot → features serially; comms/feed, approvals, popups, push/register, app-version in parallel), and the "Waiting for you" card re-fetches /api/v1/staff/approvals (1.7 s, re-pulls SIS + timetable + student-leave + complaints) every time the user returns from ANY inner screen. Cloud Run runs 1 vCPU, concurrency 20, min-instances 0, cpu-throttling, so ~30 staff phones span 2+ instances that each hold their own cold caches and re-pull the same multi-MB desks; mid-day bursts therefore look like "the app slowing down". I found no in-app growth that would make the app slower after hours of use (timers, listeners, static lists and WebViews are bounded or disposed); the slowdown pattern is load-dependent server latency. The app embeds no ERP page in a WebView — the three WebViews are Smart Teach, the e-book reader and a video HTML string — so the web desk hydration never runs inside the Flutter app; it only runs when teachers open the web ERP in a phone browser. Separately, nothing in the app refetches on resume (only AppUpdateGate and the Fees screen observe lifecycle), so an app left open shows the class/subject list from its last load until a pull-to-refresh or restart, which is how Masters changes "do not show" on phones (S3/S5 from the phone's side).

## findings

### 1. [root] Every mobile API request re-pulls whole desks from Supabase with no TTL or probe (sis, timetable, student-leave, comms, and 7 desks for the principal snapshot)  (read-in-code; S6,S4)
The /api/v1 routes the homes depend on call server-side ensure*HydratedServer helpers that unconditionally fetch the full desk from Supabase and merge it into the per-instance memory mirror. ensureSisHydratedServer has no TTL/probe and calls fetchSisFromDb, which pages all sis_households + sis_students with select('*') on every call (the measured 1.9 MB roster). staffSectionScope — used by staff/summary, staff/features, staff/approvals and principal/snapshot (via assertSchoolWide) — awaits ensureTimetableHydratedServer every call, which does a blob fetch plus the whole timetable desk fetch. staff/approvals additionally hydrates SIS + student leave and lists all complaint tickets. app/popups → householdChildren → ensureSisHydratedServer. comms/feed → ensureSchoolCommsHydratedServer (blob + desk fetch, no TTL). principal/snapshot awaits seven whole-desk hydrates in Promise.all (mirror, sis, admissions, payments, exams, attendance, staff attendance) then stockReport, storeDuesSummary, fetchOpenDuesSummary and computeFeeKpis. Only hydrateSchoolMirrorFromRemote has a 45 s TTL + desk_probe fingerprint. This is the server cost behind snapshot 5.03 s, comms/feed 1.86 s, approvals 1.70 s, parent/summary 1.46 s, popups 0.96 s — and the phone shows all of it as a spinner.
- `apps/web/src/lib/sisPersistence.ts:361-374` — ensureSisHydratedServer: no TTL/probe; fetchSisFromDb every call, then merge + writeSisLocalRaw
- `apps/web/src/lib/sisNormalized.server.ts:620-680` — fetchSisFromDb pages sis_households, sis_students, tags, class_upgrades with select('*') (1,000-row pages)
- `apps/web/src/lib/api/v1/staffScope.ts:84-89` — staffSectionScope awaits ensureTimetableHydratedServer for every staff request with a staffId
- `apps/web/src/lib/timetablePersistence.ts:111-151` — ensureTimetableHydratedServer: fetchServerBlob + fetchTimetableDeskFromDb every call, no TTL
- `apps/web/src/lib/principalSnapshot.server.ts:77-85, 96, 113, 133, 141-163` — Promise.all of 7 ensure*HydratedServer, then stockReport, storeDuesSummary, fetchOpenDuesSummary, computeFeeKpis, loadFees, loadSis per call
- `apps/web/src/app/api/v1/staff/approvals/route.ts:27-29, 53` — staffSectionScope + ensureSchoolMirrorHydrated + ensureSisHydratedServer + ensureStudentLeaveHydratedServer + listAllComplaintTickets per call
- `apps/web/src/lib/appPopups.server.ts:49-52` — householdChildren awaits ensureSisHydratedServer (parent popups GET)
- `apps/web/src/lib/schoolCommsPersistence.ts:144-184` — ensureSchoolCommsHydratedServer: blob + desk fetch every call, no TTL
- `apps/web/src/lib/schoolMirrorRemote.server.ts:25-31, 87-119` — the ONLY hydrate with a TTL (45 s) and a desk_probe fingerprint
- `apps/web/src/lib/api/v1/auth.ts:189-223, 316-346` — resolveApiAuth on every request: loadServerMasters (masters desk + staff roster, 30 s per-instance cache) + loadServerRbac (30 s TTL, 5 s probe)
- FIX HINT: Give every ensure*HydratedServer the same probe-gated short TTL the school mirror has (deskProbe on the desk's tables, lib/deskProbeCache.server.ts), and make the home endpoints read from the probe-validated in-memory copy rather than re-pulling; cache the principal snapshot per instance behind the same probe.

### 2. [major] Cloud Run sizing turns per-request re-hydration into bursty, load-dependent latency (1 vCPU, concurrency 20, min-instances 0, cpu-throttling)  (inferred; S6,S4)
The service runs one Node process per instance on 1 vCPU with 20 concurrent requests, scales from zero and only has CPU while a request is in flight. All the caches above (mirror 45 s, masters/RBAC 30 s, probe 5 s) are module-level, i.e. per instance; with ~30 staff phones a burst spans 2+ instances that each start with an empty mirror (mirrorLooksEmpty → full pull) and each re-pull desks independently. When the home screens' 6–7 parallel requests from several phones land on one 1-vCPU instance that is JSON-parsing multi-MB desk pulls, every request on that instance queues behind the same CPU — this is the 'the app slows down at certain times' shape. Inference as to timing; the configuration and the cold-start behaviour are read.
- `cloudbuild.yaml:136-174` — --memory=2Gi --cpu=1 --min-instances=0 --max-instances=20 --concurrency=20 --cpu-throttling
- `apps/web/src/lib/schoolMirrorRemote.server.ts:62-82, 87-95, 216-247` — mirrorLooksEmpty forces a full pull (staff roster + fetchSisFromDb + admissions) on a cold instance; TTL is module-level
- `apps/web/src/lib/api/v1/auth.ts:55-63, 189-190` — rbacCache and mastersCache are module-level (per instance)
- FIX HINT: min-instances=1 for school hours (or a scheduler warm ping) plus the TTL fix above; alternatively a shared cache (Supabase materialised snapshot row) for the home payloads so new instances do not re-derive them.

### 3. [major] The app has no data layer: fresh connection per request, no cache, no timeout, no retry, secure-storage read per call  (read-in-code; S6)
ApiClient uses package:http's top-level http.get/http.post for every call. In http 1.6.0 those functions create a new Client() and close it in finally, so each request opens a new TCP+TLS connection to the ERP (no keep-alive across calls). There is no response cache, no stale-while-revalidate, no retry/backoff, and no .timeout() on any ApiClient call (the only timeout is the 10 s on /api/public/app-version). _authHeaders awaits FlutterSecureStorage.read for the cookie on every request (a platform-channel/Keystore round-trip), and imageHeaders() does the same per image. pubspec has no shared_preferences/hive/sqflite/isar, so nothing survives between opens except the session cookie, locale and the punch key. Consequence: every open and every pull-to-refresh is a cold fetch that waits the full server time, and a hung server request hangs the screen indefinitely.
- `cbse_school_mobile/lib/core/api/api_client.dart:3243-3251, 3262-3274, 3292-3311` — fetchParentSummary / fetchStaffSummary / _getData / _postData use http.get/http.post directly, no timeout
- `/Users/ashishsingh/.pub-cache/hosted/pub.dev/http-1.6.0/lib/http.dart:51-52, 167-173` — top-level get() → _withClient: `var client = Client(); try {...} finally { client.close(); }`
- `cbse_school_mobile/lib/core/api/api_client.dart:3003-3010, 3895-3899` — _authHeaders awaits _storage.read on every request; imageHeaders() wraps it per image
- `cbse_school_mobile/lib/core/update/app_update_gate.dart:109` — the only .timeout(10 s) in the app
- `cbse_school_mobile/pubspec.yaml:9-39` — no local cache package; flutter_secure_storage only
- FIX HINT: One long-lived http.Client (or IOClient) on ApiClient, a per-call timeout, a small JSON cache keyed by path (memory + file) so homes paint the last payload instantly and refresh in the background, and a cached cookie string refreshed on login.

### 4. [major] Home screens block on the slowest endpoint and fan out 6–7 requests per open; features are fetched serially after the first payload  (read-in-code; S6)
PrincipalHome shows a CircularProgressIndicator until fetchPrincipalSnapshot (5.03 s avg) returns, then calls fetchStaffFeatures serially; TeacherHome blocks on fetchStaffSummary then fetchStaffFeatures; parent HomeScreen blocks on fetchParentSummary (1.46 s) then fires attendance-history + homework-feed per child in Future.wait. In parallel the home mounts RunningStrip (comms/feed, 1.86 s), WaitingCard (staff/approvals, 1.70 s) and AppPopups.maybeShow (app/popups, 0.96 s), while the shell posts push/register and AppUpdateGate GETs app-version. Every one of those server calls runs resolveApiAuth + its own desk hydrates (finding 1). Nothing is painted from a previous load.
- `cbse_school_mobile/lib/features/staff/principal_home_screen.dart:197-233, 242-268, 335-352` — _load: guardianName → fetchPrincipalSnapshot → fetchStaffFeatures (serial); spinner while _snap == null; RunningStrip + StaffCommandBar + WaitingCard in the body
- `cbse_school_mobile/lib/features/staff/teacher_home_screen.dart:204-212, 275-305, 456-487, 574-581, 699-703` — same pattern: summary → features; spinner until summary; RunningStrip and WaitingCard
- `cbse_school_mobile/lib/features/home/home_screen.dart:211-273, 375-389, 480-483` — parent: summary blocks paint; then per-child attendance + homework in Future.wait; AppPopups after summary; RunningStrip
- `cbse_school_mobile/lib/features/staff/desk_home_screen.dart:219-259, 373-388` — desk home: summary → features serial; RunningStrip; WaitingCard for office
- `cbse_school_mobile/lib/app/cbse_school_app.dart:87-94, 112-118, 145-153` — push.registerWithServer on every sign-in/resume; AppUpdateGate wraps the app
- FIX HINT: Paint the last cached payload first; fetch summary/snapshot, features, approvals and feed in one Future.wait (or one combined /api/v1/home endpoint built from the probe-validated server copy).

### 5. [major] The 'Waiting for you' card re-fetches /api/v1/staff/approvals every time the user returns from any inner screen  (read-in-code; S6)
PrincipalHome._pushScreen and TeacherHome._pushScreen await Navigator.push and then setState(_refresh += 1); WaitingCard.didUpdateWidget sees the new refreshKey and calls fetchApprovals again. The homes' _load also bumps _refresh. So a teacher who opens five screens in a row causes five extra approvals calls (each 1.7 s server-side: staffSectionScope → timetable hydrate, SIS re-page, student-leave hydrate, all complaint tickets). Across ~30 phones this is a large share of the day's server load for a count that rarely changes, and it competes on the same 1-vCPU instances with the requests the user is actually waiting for.
- `cbse_school_mobile/lib/features/staff/principal_home_screen.dart:74-78, 206-216, 348-352` — _pushScreen bumps _refresh after every pushed screen; _load bumps it too; WaitingCard(refreshKey: _refresh)
- `cbse_school_mobile/lib/features/staff/teacher_home_screen.dart:270-273, 278-283, 699-703` — same _pushScreen / _refresh pattern
- `cbse_school_mobile/lib/features/staff/waiting_card.dart:38-51` — didUpdateWidget → _load → api.fetchApprovals()
- `cbse_school_mobile/lib/core/api/staff_api.dart:1397-1398` — fetchApprovals → GET /api/v1/staff/approvals
- FIX HINT: Refresh the counts only when a decision was made (the pushed screen returns true) or at most once per N minutes; serve approvals from a cheap count query instead of hydrating four desks.

### 6. [minor] Periodic timers and resume behaviour: three polling timers, two lifecycle observers, and no refetch on resume (stale classes/subjects on an open app)  (read-in-code; S6,S3,S5)
Measured timers: RunningStrip polls comms/feed every 10 min for as long as a home screen is mounted (homes are GoRouter routes and stay mounted under pushed screens, so this runs all day on every phone: ~30 phones × 6/h = ~180 comms/feed calls/h, each re-hydrating the comms desk, matching the 1.86 s route); BusLiveMap polls transport/live every 15 s while open; the teacher's online-class Q&A wall polls every 8 s while live/scheduled. AppUpdateGate re-checks app-version on resume at most every 30 min. The only other WidgetsBindingObserver is FeesScreen, which reloads only after a payment/autopay browser round-trip. No home or module screen refetches on resume, so an app left open keeps the class list, sections and subjects from its last staff/summary until a pull-to-refresh or restart — which is how a Masters change made on the web 'does not show' on a phone (S3/S5 from the phone's side), and conversely why a stale subject list on a phone could be saved back (the 10 Oct subject wipe).
- `cbse_school_mobile/lib/core/ui/running_strip.dart:33-38, 47-49` — Timer.periodic 10 min → fetchCommsFeed
- `cbse_school_mobile/lib/features/modules/bus_live_map_screen.dart:45-55` — Timer.periodic 15 s → fetchBusLive
- `cbse_school_mobile/lib/features/staff/online_class_qa_teacher_screen.dart:33-49` — Timer.periodic 8 s → fetchOnlineClassWall while live/scheduled
- `cbse_school_mobile/lib/core/update/app_update_gate.dart:52, 73-80, 103-116` — didChangeAppLifecycleState resumed → /api/public/app-version at most every 30 min
- `cbse_school_mobile/lib/features/modules/fees_screen.dart:34, 55-89` — the only other WidgetsBindingObserver; reloads only when awaiting a payment/autopay return
- `cbse_school_mobile/lib/features/staff/teacher_home_screen.dart:275-284` — _summary (classes/sections/teaching) held in state; replaced only by _load (pull-to-refresh/open)
- FIX HINT: Refetch summary/features on resume when older than a few minutes; make RunningStrip poll only while the home is visible (route-aware) and cache comms/feed server-side behind the probe.

### 7. [minor] No evidence of in-app growth over hours of use; memory-related slow-down is unlikely to be client-side  (read-in-code; S6)
I looked for the classic 'slow after hours' causes and found them bounded: ScreenGuides' static _errors list is pruned to a 10-minute window and _stack is balanced by enter/leave in ScreenGuideButton's initState/dispose; _reported is a Set of distinct screen|message keys. FCM listeners are registered once in PushService.init; onOpenRoute is a single broadcast stream. AppPopups shows at most once per process. The three WebViews (Smart Teach, e-book reader, tutor video HTML) are created per screen and go away with it; Cashfree checkout opens the external browser, not a WebView. Only two growth points exist and both are small: the tutor chat keeps every turn in _messages and sends the whole history with each ask (payload grows with the conversation), and gallery/class-gallery decode full-resolution photos with Image.network and no cacheWidth/cacheHeight (Flutter's imageCache caps at 100 MB/1000 entries, so this causes jank on an album, not a leak). The user-visible 'slows down' therefore tracks server latency, not client state.
- `cbse_school_mobile/lib/core/guide/screen_guides.dart:61-72, 77-87, 134-145` — _stack add/removeWhere balanced; _errors pruned at 10 min; _reported Set
- `cbse_school_mobile/lib/core/push/push_service.dart:59, 137-158` — listeners registered once in init(); one broadcast StreamController
- `cbse_school_mobile/lib/core/popups/app_popups.dart:48-60` — _shownThisRun static — one pop-up fetch per process
- `cbse_school_mobile/lib/features/modules/tutor_screen.dart:106, 217-232` — _messages grows per chat; full history sent on each ask
- `cbse_school_mobile/lib/features/modules/gallery_screen.dart:99-105, 152-155, 278-283` — a tile per photo in the album, Image.network full-size, no cacheWidth
- `cbse_school_mobile/lib/features/staff/class_gallery_screen.dart:298-313, 820-833` — Image.network full-size thumbnails with a FutureBuilder on imageHeaders() per tile
- `cbse_school_mobile/lib/features/modules/smart_teach_screen.dart:7-38, 45-52, 84` — WebView for pinnaclelearning.in / leadschool.in only
- `cbse_school_mobile/lib/features/modules/video_player_screen.dart:24, 54-72` — WebView loads an HTML string for a tutor video; not the ERP shell
- `cbse_school_mobile/lib/core/billing/open_checkout.dart:7-9` — checkout is the external browser, not a WebView
- FIX HINT: Add cacheWidth/cacheHeight to gallery thumbnails and cap tutor history sent per ask; otherwise nothing to fix on the client for growth.

### 8. [minor] The Flutter app embeds no ERP page; the web desk hydration only runs when staff open the web ERP in a phone browser  (read-in-code; S4,S6)
None of the app's WebViews load the Next.js app (Smart Teach is the publisher's site, the e-book reader loads a CDN EPUB URL, the video player loads an HTML string). So CoreDataGate / startDeskHydrationBackground and the memory-copy desks never run inside the Flutter app. When teachers use the web ERP in a phone browser (memory: they do), that tab runs the full CORE + route-desk hydration (sis-roster 1.9 MB, masters-desk 235 KB, staff-roster 148 KB per load) on a phone browser with the same 1-vCPU instances behind it — this is the other half of what staff call 'the app' and belongs to the web lens.
- `cbse_school_mobile/lib/features/modules/ebook_reader_screen.dart:45-52, 77` — WebViewController loadRequest(widget.url) — e-book URL
- `cbse_school_mobile/lib/app/routes_staff.dart:25-64` — routes: /login /staff /principal /desk /driver /wrong-app — no ERP web route
- FIX HINT: Keep it that way; the mobile-API fix is the TTL/probe on the server hydrates, not a WebView.

## tables
### Requests fired by each home screen on open (all GET unless noted; all go through resolveApiAuth)

| Home | Order | Endpoint | Blocks first paint? | Prod avg (24 h) | Server work per call (read) |
|---|---|---|---|---|---|
| Principal (`/principal`) | 1 (serial) | `/api/v1/principal/snapshot` | YES (spinner until it returns) | 5.03 s | resolveApiAuth + assertSchoolWide→staffSectionScope→timetable hydrate + 7 desk hydrates (mirror, sis, admissions, payments, exams, attendance, staff-attendance) + stockReport + storeDuesSummary + fetchOpenDuesSummary + computeFeeKpis |
| Principal | 2 (after 1) | `/api/v1/staff/features` | no | — | resolveApiAuth + mirror + staffSectionScope (timetable hydrate) |
| Principal | parallel | `/api/v1/comms/feed` (RunningStrip) | no | 1.86 s | resolveApiAuth + mirror + comms desk hydrate (no TTL) |
| Principal | parallel | `/api/v1/staff/approvals` (WaitingCard) | no | 1.70 s | staffSectionScope + mirror + SIS re-page + student-leave hydrate + all complaint tickets |
| Principal | parallel | `/api/v1/app/popups` (AppPopups) | no | 0.96 s | resolveApiAuth + readAppPopups + popup events (staff: no SIS) |
| Principal | parallel | POST `/api/v1/push/register`, GET `/api/public/app-version` | no | — | — |
| Principal | on tap (Marks/pick section) | `/api/v1/staff/summary` | n/a | — | mirror + timetable + attendance hydrates + staffSectionScope |
| Teacher (`/staff`) | 1 (serial) | `/api/v1/staff/summary` | YES | — | mirror + timetable + attendance hydrates + staffSectionScope (timetable again) |
| Teacher | 2 (after 1) | `/api/v1/staff/features` | no | — | as above |
| Teacher | parallel | `/api/v1/comms/feed`, `/api/v1/staff/approvals`, `/api/v1/app/popups`, push/register, app-version | no | 1.86 / 1.70 / 0.96 s | as above |
| Desk/office (`/desk`) | 1→2 serial | `/api/v1/staff/summary` → `/api/v1/staff/features` | summary gates the name/kind | — | as above |
| Desk/office | parallel | comms/feed, approvals (office only), popups, push/register, app-version | no | — | as above |
| Driver (`/driver`) | 1 | `/api/v1/transport/routes` | YES | — | — |
| Driver | parallel | comms/feed, popups, push/register, app-version | no | — | — |
| Parent (`/home`) | 1 (serial) | `/api/v1/parent/summary` | YES | 1.46 s | resolveApiAuth (+ family-status read) + mirror + loadSis/loadMasters + dues cache per child (compute fallback) + stampParentAppPresence (≤1.5 s, hourly) + schoolWhatsAppContact |
| Parent | 2 (after 1, per child, parallel) | `/api/v1/parent/attendance?studentId&days`, `/api/v1/homework/feed?…` | no (tiles show "—") | — | mirror hydrate each |
| Parent | after 1 | `/api/v1/app/popups` | no | 0.96 s | householdChildren → SIS re-page |
| Parent | parallel | comms/feed (RunningStrip), push/register, app-version | no | 1.86 s | as above |

### Repeat triggers (timers, lifecycle, navigation)

| Trigger | Where (file:line) | Interval / condition | Endpoint |
|---|---|---|---|
| Timer.periodic | core/ui/running_strip.dart:37 | every 10 min while any home is mounted (all session) | `/api/v1/comms/feed` |
| Timer.periodic | features/modules/bus_live_map_screen.dart:48 | every 15 s while the bus map is open | `/api/v1/transport/live` |
| Timer.periodic | features/staff/online_class_qa_teacher_screen.dart:40 | every 8 s while a live/scheduled class wall is open | `/api/v1/staff/online-classes/{id}/questions` |
| Lifecycle resume | core/update/app_update_gate.dart:74-80 | on resume, at most every 30 min (10 s timeout) | `/api/public/app-version` |
| Lifecycle resume | features/modules/fees_screen.dart:67-89 | only after a payment/autopay browser round-trip | `/api/v1/autopay` + `/api/v1/fees/ledger/{id}` |
| Return from any pushed screen | principal_home_screen.dart:74-78, teacher_home_screen.dart:270-273 → waiting_card.dart:38-42 | every Navigator.pop back to the home | `/api/v1/staff/approvals` |
| Pull-to-refresh / Retry | all homes (RefreshIndicator onRefresh: _load) | user action; bumps _refresh → approvals again | home's primary + features + approvals |
| Sign-in / session resume | app/cbse_school_app.dart:87-94 | once per app start | POST `/api/v1/push/register` |
| FCM token refresh | core/push/push_service.dart:156-158 | on token rotation | POST `/api/v1/push/register` |
| Position stream | features/staff/self_attendance_screen.dart:58-111 | only during a punch; cancelled on dispose | — (local GPS) |

### Client data-layer inventory (read)

| Concern | State | Evidence |
|---|---|---|
| HTTP client | top-level `http.get/post` → new `Client()` per call, closed in `finally` (no keep-alive) | api_client.dart:3244,3263,3293,3303; http-1.6.0/lib/http.dart:167-173 |
| Timeout | none on any ApiClient call; 10 s only on app-version | app_update_gate.dart:109 |
| Retry/backoff | none | — |
| Client cache / SWR | none; no shared_preferences/hive/sqflite/isar in pubspec | pubspec.yaml:9-39 |
| Per-request secure-storage read | cookie read from FlutterSecureStorage on every request and every image | api_client.dart:3003-3010, 3895-3899 |
| WebViews | Smart Teach (publisher site), e-book reader (CDN URL), tutor video (HTML string) — no ERP page | smart_teach_screen.dart:24-38,84; ebook_reader_screen.dart:77; video_player_screen.dart:72 |

## open questions
- No server-side timing breakdown exists per phase (auth vs hydrate vs compute) — the 5 s / 1.7 s averages are route totals from Cloud Run logs; a per-phase timer around resolveApiAuth and each ensure*HydratedServer would confirm which pull dominates.
- How many Cloud Run instances are live during school hours and how often they cold-start (min-instances=0) — this decides how often the 45 s mirror TTL and 30 s masters/RBAC caches are effectively zero.
- Whether the phones' 'slows down' is ever measured on the device (no client telemetry; the app reports nothing about request durations), so the correlation with server load is inferred from code, not measured.
- Whether sis_students select('*') on every ensureSisHydratedServer still carries the wide profile column (memory says it was dropped) — the 1.9 MB measured sis-roster payload suggests the row set is still heavy.
- Does the Play-published build (1.0.32+33 in pubspec) match this source for the WaitingCard/RunningStrip behaviour, or are older builds (1.0.2x) still common on staff phones?
