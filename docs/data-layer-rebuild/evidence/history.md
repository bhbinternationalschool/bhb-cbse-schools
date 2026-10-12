# history — Incident history as evidence of a defect class (git log 1 Aug–12 Oct 2026, docs/TODO.md, docs/ENTERPRISE_UPGRADE_PLAN.md, live rev 00856 vs origin/main 2f0eb3d4)

## summary
I read 592 merge commits and 497 non-merge "fix" commits since 1 Aug, the bodies of ~60 of them, and the diffs/stats of ~20, then classified the 98 data-loading/storage/sync fixes (about 118 PRs once the batched no-prune/stale-guard series are expanded). The counts are MEASURED from the log: UF unknown-became-fact 17, PA prune-by-absence 16 rows (23 PRs), SR stale replica 15 rows (29 PRs), PQ quota 13, OT 10, PL perf 8, LU lost update 7, RO read-once 5, HE echo 4, UP unpaged 2, PH 1 (plus 3 secondary). 65 of the 98 rows are explicit follow-ups to an earlier fix of the same class on the same desk or "all desks"; the commit messages themselves say so ("FIFTH CAUSE, FOURTH REPLAY", "same class of loss as the 2026-08-21 transport wipe", "PR #404 ... but only masters read through readCache", "the #570 guard ... would have refused every save made more than 15 s after a page loaded", "with the old prune ... after #469 it adds duplicate masters"). The same three mechanisms recur across every desk: (a) a per-browser whole-module copy is treated as truth and pushed back (PA/SR/HE), (b) an empty or failed read of that copy is indistinguishable from "no data" (UF/PQ), and (c) two async writers of the same in-memory copy clobber each other (LU/PH: ccb42628 on 18 Aug, #278 on 19 Sep and #578 on 12 Oct are the identical snapshot-before-await bug on masters-vs-staff). The project's own plan admitted this on 10 Aug (ENTERPRISE_UPGRADE_PLAN.md:43-47: "the underlying model — localStorage as truth, whole-state pushes — remains, and per-device truth is why two devices show different class counts") and TODO.md:42-68 predicted on 11 Aug that "a client holding 3 of 900 rows still prunes 897 ... the other 18 need the same treatment" — those 18 were fixed eight weeks later in #469–#480 after further wipes (fee lines 26 Aug/6 Sep, exam papers 18 Sep, homework 9 Oct). PR #526 (10 Oct) moved the copies from localStorage to page memory, which removed the PQ class but immediately created a new wave (RO: 63 screens read Masters once on mount; UF: placeholder defaults saved over real data; LU: parallel hydrates). Live revision 00856 is origin/main minus exactly one PR: #578 (mastersPersistence.ts:168 `localBefore` → `loadMasters()`, masters.ts staff-slice keep, deskLoadGuard.selftest.ts). Everything merged before 13:31 IST on 12 Oct — #569 serial saves, #570/#571 load guards + CoreDataGate, #574–#577 RBAC — is live. The data say these are not ~60 independent bugs: the same failure modes have been fixed per-desk, one desk at a time, on the same architecture (one hand-merged replica of every module per browser), and each structural change has produced the next class.

## findings

### 1. [root] The fix history is one defect family: a per-browser whole-module replica merged by hand, producing PA/SR/UF/PQ/LU repeatedly across desks  (read-in-code; S1,S2,S3,S4,S5,S6)
Every module is held as one JSON copy per browser (localStorage until 10 Oct, page memory since). Saves push the copy back; the server originally deleted whatever the copy lacked (PA), later refused or merged by stamp/revision (SR); hydration merged into a snapshot taken before the await (LU/PH); an empty or failed read of the copy reads as 'no data' and gets stored or pushed (UF); the copy overflowed the 5 MB quota and whichever desk lost the write rendered 0 (PQ). 65 of 98 classified fixes are follow-ups to an earlier fix of the same class; the same mechanism was fixed on sis (Aug 6/8), all 20 modules (Aug 11), transport (Aug 21, Sep 13, Sep 14), fees (Aug 26, Sep 7), exam papers (Sep 18), homework (Sep 30, Oct 9), then 18 desks at once (Oct 9).
- `docs/ENTERPRISE_UPGRADE_PLAN.md:43-47` — 10 Aug: 'the underlying model — localStorage as truth, whole-state pushes — remains, and per-device truth is why two devices show different class counts'
- `docs/TODO.md:42-68` — 11 Aug: deleteStale copy-pasted into 20 modules, 91 call sites, 86 unguarded; 'a client holding 3 of 900 rows still prunes 897 ... The other 18 need the same treatment ... The real fix is per-record writes with explicit deletes'
- `git: 5defacca, d3b95cbe, fb73f1b1, 904576b6, 3a70fe4f (PRs #469-#473, 9 Oct):commit subjects` — 'desk saves never delete rows they do not hold' on accounts, fees/payments, payroll/statutory/vault, admissions/library/rte/ptm/exams, comms/attendance/leave — the 18 desks TODO.md named 8 weeks earlier
- `git: a433abc6 (PR #328, 26 Sep):body` — 'FIFTH CAUSE, FOURTH REPLAY. With all four earlier fixes live ... the 10:48 replay ... recorded fee_link.already_paid / ignored' — stale cached pay-link copy
- `git: 8f7b4a9a (26 Aug):body` — 'Same class of loss as the 2026-08-21 transport wipe; same cure: the server keeps what the client omits'
- `git: 88016c23 (PR #474, 9 Oct):body` — 'with the old prune that erased the real masters; after #469 it adds duplicate masters' — a fix to a fix
- FIX HINT: Stop holding whole modules per browser. Screens query the rows they show (paged, server-filtered) and write single rows with explicit deletes; a hydrate never merges into a client snapshot; 'empty' and 'unread' are different types. This is the unfinished Phase 1 of the project's own plan (TODO.md:241-277: delta pushes, unified data-access layer, two-device convergence exit test — all still unchecked).

### 2. [root] Snapshot-before-await in hydrateMastersOnce has been fixed three times (18 Aug, 19 Sep, 12 Oct); the third fix (#578) is not in the live revision  (read-in-code; S1,S5)
hydrateMastersOnce reads the page's masters copy, awaits the fetch, then merges the reply into the pre-fetch copy and writes it back. Staff hydrate runs in parallel and writes the roster into the same copy ~0.2 s earlier, so the write-back erases it; the staff desk is already marked loaded and never re-reads. ccb42628 (18 Aug) fixed the same pattern in syncSisIntoMasters (cold-start copy captured earlier overwrote real classes), db56501b (#278, 19 Sep) fixed the masters hydrate writing [] staff over the roster, #578 fixes the snapshot itself.
- `apps/web/src/lib/mastersPersistence.ts:150-170` — main: `const localBefore = loadMasters()` before the await; line 168 now merges into `loadMasters()`; live-src copy still has `mergeDbDeskIntoMastersState(localBefore, bundle` (diff live→main, 1 hunk)
- `git: ccb42628 (18 Aug):body` — 'on a fresh page load that landed after masters hydration and overwrote the real classes with the cold-start copy captured earlier, so every student read as Unassigned'
- `git: db56501b (PR #278, 19 Sep):body` — 'each masters hydrate wrote those three empty arrays over the roster and persisted the result ... an empty array reads as an answer while a missing key reads as a question'
- `git: 5c11abcc (PR #578, 12 Oct 15:46 IST):body` — 'Every refresh lost the same race (roster lands ~0.9 s, masters ~1.1 s), and the staff desk, already marked loaded, never re-read'
- `scratchpad diff live-src vs wt-main:apps/web/src` — only mastersPersistence.ts, masters.ts, deskLoadGuard.selftest.ts differ (+ api/inventory/assets absent from tarball) — i.e. live 00856 = main minus #578
- FIX HINT: Deploy #578, but the structural fix is that a hydrate must never read-modify-write the shared copy; each desk owns its slice and writes only that slice (or the copy is replaced by per-row queries).

### 3. [major] Browser quota (PQ) was fixed eight times on different desks before PR #526 moved the copies to page memory — which then spawned the RO/UF/LU wave of 10–12 Oct  (read-in-code; S1,S2,S3,S4,S5)
7.56 M chars of module copies against Chrome's ~5.2 M origin cap: whichever desk's write lost rendered 0 (students 6 Sep, transport 13–14 Sep, exam papers 24 Sep, HR staff 6 Oct, attendance on phones 9 Oct). Each fix widened one helper to one more desk (masters-only eviction → all desks; masters-only readCache → 62 loaders). #526 removed localStorage, so every reload re-downloads every desk and nothing is in the browser before the page opens; the next three days produced 'screens read Masters once on mount' (#571), 'placeholder defaults saved over real data' (#570/#571), 'second save refused as conflict' (#569) and 'Staff 0' (#578).
- `git: 9c5fa867, 5e7151e3, a00f9604 (10 Aug), 38e8348e (18 Aug), d208b08f (11 Sep), 61fac114 (#71, 6 Sep), 16281c34 (#194, 13 Sep), 5325fa9a (#211, 14 Sep), 9274fea6 (#318, 24 Sep), 5012928b (#404, 6 Oct), d2840492 (#462, 9 Oct), 0bfb051d (#526, 10 Oct):subjects/bodies` — the PQ chain; #462 body: 'PR #404 (6 Oct) made writeCacheOrInvalidate keep a value ... but only masters read through readCache. Every other desk's loader still read localStorage directly'
- `git: 16281c34 (#194):body` — 'writeCacheOrInvalidate could only make room for ONE key — bhb_masters_v5. Every other desk, on a full origin, simply dropped itself ... then pushed that emptiness. The server's PROTECTED guard refused it, eight times'
- `apps/web/src/lib/browserStorage.ts:254-303` — memoryCopies Map; readCache returns the held string first; writeCacheOrInvalidate sets memory copy
- `git: 5da73241 (#571):body` — 'Since desks moved to page memory, Masters loads after the page opens; 63 screens read it once on mount and a screen that mounted first stayed empty. Before 10 Oct Masters was always already in the browser.'
- `git: 65bfc46d (#571):body` — 'DANGEROUS: Masters → Leave setup → Attendance saved default punch settings (empty exempt list) over the real ones ... The #570 guard used isDeskHydrated, a 15 s cache: it would have refused every save made more than 15 s after a page loaded'

### 4. [major] Prune-by-absence (PA) recurred on seven desks over nine weeks before the per-desk named-delete series; each recurrence was a production data loss  (read-in-code; S3,S5)
A save sent the whole copy and the server deleted every row not in it. A browser that was unhydrated, partially hydrated, logged out (401 → empty), quota-evicted, or merely older than another writer therefore deleted other people's rows. Known losses: 708 students (8 Aug), attendance day (10 Aug), transport desk (21 Aug), fee receipts RCV-00001..08 (26 Aug), all fee lines (6 Sep), 80 exam papers (18 Sep), staff-app homework posts (9 Oct), bank mode map 10 rows (8 Oct).
- `git: f88a7c7c (6 Aug), b2c6310b (8 Aug), ae6c09a0 (11 Aug), 839c05d9 (12 Aug), 48261323 (21 Aug), 8f7b4a9a (26 Aug), f6c18308 (7 Sep), 1227b32e (#262), 8c133e0e (29 Sep), 27f86506 (#360), 73d23ba7 (#468), #469-#473, #475/#477/#479/#480, 7fe54ad0 (#500), 828001aa (11 Oct):subjects/bodies` — the PA chain, 16 rows / 23 PRs
- `git: b2c6310b:body` — 'a 3-record test payload POSTed to /api/school-data/sis-roster removed 708 students and 190 households ... Note commit f88a7c7 (remove deleteStale from pushSisToDb ...' — explicitly a follow-up
- `git: 27f86506 (#360, 30 Sep):body` — 'one teacher publishing could erase homework other teachers posted since (the fee-line / exam-papers wipe class)'
- `git: 73d23ba7 (#468, 9 Oct):body` — nine days later on the same desk: 'three homework posts made from the staff app ... were deleted within minutes by an office browser's full-desk save'

### 5. [major] Stale-replica (SR) and lost-update (LU) fixes cluster in the last 72 hours and are already fixing each other  (read-in-code; S3,S5)
Per-row versions (#503/#504, 9 Oct) and stamped saves (#529/#531/#534/#536, 10 Oct) made stale pushes refusable; on the first morning in use the debounce let a second save leave with the first's base version, so real edits were refused and lost — #569 serial saves (12 Oct) chains them. #570's guard then used the 15 s TTL and would have refused every save after 15 s — #571 the same day replaced it with a sticky flag. The ten #507–#517 'stale guard' PRs are the same SR class applied desk by desk; #524 (teacher phone pushed a generic subject list under new ids, class map 140→30) is SR on masters, the same hole the 9 Aug classes guard closed for classes but not subjects.
- `git: c396e39e (#569):body` — 'first morning on the stamped/versioned saves: removing EL and then marking a leave type unpaid ... showed N changes ... were NOT saved: someone else changed those entries first, with nobody else editing, and the second change was lost'
- `git: 65bfc46d (#571):body` — 'The #570 guard used isDeskHydrated ... would have refused every save made more than 15 s after a page loaded'
- `apps/web/src/lib/deskHydrateGuard.ts:6-26` — DESK_HYDRATE_TTL_MS = 15_000 isDeskHydrated vs loadedOnce/hasDeskLoaded sticky set
- `git: 4d8b7061 (#524, 10 Oct):body` — 'Sujata Bajpayee's phone saved Masters in the background three times ... the school's subjects vanished, the class map fell from ~140 links to 30 ... homework offered teachers no subjects'
- `git: d06d6684 (#444, 8 Oct) vs 24fd9ae9 (10 Aug):bodies` — identical mechanism two months apart: own save stamped the local copy newer than the server, hydration kept the empty copy and each save deleted server rows

### 6. [major] Read-once screens (RO): CoreDataGate waits only for masters (+ staff ≤5 s); 63 screens read Masters on mount and only 15 files listen for bhb-masters-updated  (read-in-code; S2,S3,S5)
Since module copies live only in page memory, a screen that mounts before its desk lands reads the empty placeholder and never re-renders unless it subscribes to the specific CustomEvent. CoreDataGate (#571) gates on masters only; SIS and every other desk still arrive after mount. The same RO fix was applied to the dashboard on 17 Aug (bhb-sis-updated), 10 Oct (home redraw), 11 Oct (ModuleDashboardHost bhb-desk-hydrated), 12 Oct (CoreDataGate, StaffWorkspace, #574 roles+roster).
- `apps/web/src/components/shell/CoreDataGate.tsx:24-55` — loops 24× on hasDeskLoaded('masters'), then ensureMastersHydrated; staff Promise.race with 5000 ms; dispatches bhb-masters-updated once
- `git: 434e6316 (17 Aug):body` — 'saveSis() never signalled same-tab listeners, and the native storage event ... never fires for a write made in the same tab'
- `git: ab1390d0 (11 Oct):body` — 'ModuleDashboardHost also listens for bhb-desk-hydrated, so a dashboard whose desk loads after mount redraws (the old loop had been hiding this)'
- `git: 5da73241 (#571):body` — '63 screens read it once on mount and a screen that mounted first stayed empty'

### 7. [major] Payload/perf (PL) fixes alternate with echo (HE) fixes: whole-desk downloads were first cached, then probe-gated, then made memory-only (re-downloaded on every reload), then made on-demand  (read-in-code; S4,S6)
Each page load pulls whole modules (sis-roster 1.9 MB, fees-vouchers 1.5 MB per the task's Cloud Run figures). 18 Aug: ~20 concurrent hydrations stalling 10–23 s, 226/228 roster POSTs were echoes of a GET. 20 Aug: probe-gated caching. 10 Oct: #526 drops localStorage so every reload re-pulls; #539 the same day stops the idle sweep pulling fees/admissions/attendance on every page. 11 Oct: Fee Take re-fetched dues every second (26 calls/30 s) and the fee dashboard 7–9×; the server-side comms page ran ensureSisHydratedServer ~160× per request (45–70 s).
- `git: 33d13a62, b7c6f870, 7daa8cae (18 Aug):bodies` — thundering herd (~20 concurrent, 10–23 s stalls, 503s); ~40 more page-level ensure*Hydrated; 226 of 228 daily roster POSTs within 90 s of a GET
- `git: 3ec4aa66 (#539, 10 Oct):body` — 'a phone opening Homework pulled the whole fee book and every lead — and since module data now lives only in page memory, it did so on every reload'
- `git: 6d5a440e (#548), 4b9b4875 (#559), 565e7f0c (#545) (11 Oct):bodies` — Fee Take 26 calls/30 s; dashboard 7–9 re-fetches after the redraw-on-land fix; app-popups 45–70 s from ~160 ensureSisHydratedServer calls
- `apps/web/src/lib/deskHydrationSchedule.ts:40,112,285-309` — CORE_IDS always; HEAVY_ON_DEMAND_IDS never swept; withHydrationSlot cap

### 8. [minor] Mobile-API slowness is the server-side instance of the same whole-module hydrate  (inferred; S6)
The one measured server case (#545) shows a server route hydrating the whole SIS desk per family (~160 DB round trips per request). The /api/v1 principal/snapshot (5.0 s avg) and parent/summary (1.5 s) routes were not read in this lens; by analogy with #545 and ensure*HydratedServer helpers they likely build each answer from a whole-desk read rather than a row query.
- `git: 565e7f0c (#545):body` — 'schoolAadhaarGaps awaited householdChildren per family, and each call re-ran ensureSisHydratedServer (a database round trip): ~160 per page load. GET /api/comms/app-popups took 45–70 s'
- FIX HINT: Verify by reading apps/web/src/app/api/v1/principal/snapshot and parent/summary for ensure*HydratedServer / fetch*DeskFromDb calls.

### 9. [minor] Unpaged reads (UP) were fixed on 6 Sep for six desks and recurred on accounts/fees on 9 Oct  (read-in-code; S2,S5)
PostgREST returns 1,000 rows and reports success; the attendance desk (10,315 marks) hydrated as 1,000 so days read as unmarked. The same shape was found again in fetchAccountsDeskFromDb (23 lists) and fetchFeeDeskAncillaryFromDb (8 lists), which also dropped read errors so a failed read came back as an empty desk (UP + UF).
- `git: 6cf9b62d (6 Sep):body` — 'The attendance desk holds 10,315 marks; the hydrate asked for all of them in one request and got a thousand'
- `git: 1726f02c (#490, 9 Oct):body` — 'PostgREST stops at 1,000 rows and calls the cut success ... Both also dropped their read errors, so a failed read came back as an empty desk'

### 10. [minor] Live revision 00856 contains every 12 Oct fix except #578  (measured; S1)
Recursive diff of the extracted tarball against origin/main 2f0eb3d4 differs in three files only, all from #578 (merged 15:46 IST, after the 14:48 IST deploy). #569 serial saves, #570/#571 load guards + CoreDataGate, #572, #574/#575/#577 RBAC (merged 10:15–13:31 IST) are live. So S1 'Staff 0' from the masters-vs-staff race is still live; the new RO/UF guards are live and untested in production beyond today.
- `apps/web/src vs wt-main/apps/web/src:diff -rq` — differ: lib/masters.ts, lib/mastersPersistence.ts, lib/deskLoadGuard.selftest.ts; 'Only in wt-main: app/api/inventory/assets' (in git since 23 Aug — see open question)
- `git log --merges 12 Oct (IST):#569 10:15, #570 10:39, #571 12:00, #574 12:37, #575 13:03, #577 13:31, #578 15:46` — deploy cut at 14:48 IST

## tables
### Classification of data-loading / storage / sync fixes (1 Aug – 12 Oct 2026)
Class key: LU lost update · SR stale replica pushed/kept · PQ quota/eviction · UF unknown-became-fact · PA prune-by-absence · RO read-once screen · PH parallel-hydrate race · UP unpaged read · HE hydration echo · PL payload/perf · OT other (silent-save, wipe-signal, migration drift). R = follow-up to an earlier fix of the same class on the same desk (or an "all desks" fix).

| date | PR/sha | title (short) | class | desk(s) | R |
|---|---|---|---|---|---|
| 08-06 | 36791194 | login localStorage wiping; stale merged records deleted in DB | PA | sis | |
| 08-06 | 9a34575f | db sync ghost record resurrection | SR | sis | |
| 08-06 | f88a7c7c | remove deleteStale from pushSisToDb | PA | sis | |
| 08-08 | b2c6310b | 3-record test payload deleted 708 students | PA | sis | R |
| 08-09 | 8c481f5f / PR#7 | client can no longer overwrite desk wholesale (hydrate ended with push, 12 modules) | HE | all | |
| 08-09 | 4e3c36c0 | fail closed instead of seeding demo masters on cold server | UF | masters | |
| 08-09 | cd97feb0 | public forms inventing class ids | UF | admissions | |
| 08-09 | 608869b6, 6cd02051 | repair ids broken by masters re-seed | UF | sis, masters | R |
| 08-09 | PR#1 | masters revision guard (rolled back same night: 409'd every save) | SR | masters | |
| 08-10 | e57015a6 / PR#2 | Stage 0: save reaches DB or says so; base was local clock | SR | masters | R |
| 08-10 | edd682ba / PR#8 | cold client must not invent a school | UF | masters | R |
| 08-10 | d3142333 | retire 2026-08-05 wipe signal; signals expire | OT (wipe-signal) | fees | |
| 08-10 | 24fd9ae9 | empty desk must never refuse the server's data | SR | masters | R |
| 08-10 | 5220d4e6 | failed read guarded as empty → 711 students orphaned | UF | masters | R |
| 08-10 | 9c5fa867 | full cache must not read as empty roster | PQ | sis | |
| 08-10 | 5e7151e3 | no module may abort on a full cache (78 sites) | PQ | all | R |
| 08-10 | a00f9604 | full localStorage must not block DB write | PQ | admissions | R |
| 08-10 | 6dc466f8 | no-op skip production never had (conflict storm) | OT (migration drift) | sis | |
| 08-11 | ae6c09a0 | no module may delete a table because client turned up empty (20 modules, 91 sites) | PA | all | R |
| 08-11 | 90f05b97 | stale-masters loop (revision after shouldTake) + lost attendance | SR | masters, attendance | R |
| 08-11 | 793f4311 | memory fallback SIS got, applied to admissions | PQ | admissions | R |
| 08-12 | 839c05d9 | guard roster wipe | PA | sis | R |
| 08-13 | b87dea33 | masters push-serialization | LU | masters | |
| 08-15 | 7bad43b2 | missing masters.classes = unhydrated mirror | UF | masters(server) | R |
| 08-17 | 434e6316 | dashboard stale after same-tab SIS writes | RO | sis/dashboard | |
| 08-18 | 33d13a62 | cap concurrent hydration (20-way burst, 10–23 s stalls) | PL | all | |
| 08-18 | b7c6f870 | ~40 more ensure*Hydrated bypassing the gate | PL | all | R |
| 08-18 | 7daa8cae | hydration pull-only (226/228 roster POSTs were echoes) | HE | all | R |
| 08-18 | 7cf63c42 | unknown is not empty: fail closed, no invented timestamps, no blind wipes | UF | desk slices | R |
| 08-18 | c5ec8a75 | failed saves visible; deletions survive reload; retries can't reorder | LU | sync | |
| 08-18 | ccb42628 | masters projection write synchronous — cold-start copy clobbered hydrated classes | LU (snapshot-before-await) | masters | |
| 08-18 | 38e8348e | browser can no longer lose its classes (quota evicted masters, seeded empty shell) | PQ | masters | R |
| 08-18 | f033a3f2 | fees hydrate no longer pushes | HE | fees | R |
| 08-18 | be75873c | deploy no longer resets roles | UF | rbac | |
| 08-20 | PR#47 | probe-gated desk caching (multi-MB re-pulls) | PL | all | |
| 08-21 | 48261323 / PR#50 | refuse empty-desk pushes (401 → empty → routes deleted) | PA | transport | R |
| 08-22 | 9ff2c3e1 / PR#53 | hydrate roster; stop "0 riders" when unknown | UF | transport | |
| 08-24 | 6eaaac00, 887d3c01, PR#60 | a save that never reached the server said nothing | OT (silent save) | all | R |
| 08-26 | 8f7b4a9a | push must never delete receipts client lacks (RCV-00001..08) | PA | fees | R |
| 08-26 | 01eafbbd | shipped wipe order kept executing itself | OT (wipe-signal) | fees | R |
| 09-05 | 809eb453 | Class WA tab hangs: re-saving channel store every poll | HE | comms | R |
| 09-06 | 6cf9b62d | page every desk read passing 1,000 rows (attendance 10,315 marks) | UP | attendance, staff att., exams, fees, payments, admissions | |
| 09-06 | 61fac114 / PR#71 | register shows 0 students — three ways a full browser got there | PQ | sis | R |
| 09-06 | 30b11618 / PR#69 | student edits save again; 51 fields never reached DB | OT | sis | |
| 09-07 | f6c18308 | wipe-then-refill in one transaction; mirror refuses | PA | fees | R |
| 09-08 | b767e796 / PR#103 | cache miss is "unknown", not ₹0 | UF | parent app | |
| 09-11 | d208b08f / PR#175 | ten local-cache writers threw on full browser | PQ | all | R |
| 09-11 | 9718dac9 / PR#170 | bot threads stopped persisting (CHECK constraint) | OT | wa | |
| 09-12 | 1f57d5be / PR#193 | student record stops losing what the office types | OT | sis | R |
| 09-12 | e1c9cb00 | unrecognised class must not become Primary on a bus | UF | transport | |
| 09-13 | 16281c34 / PR#194 | every desk may make room, none may push an empty one (transport zeros, 8×502) | PQ | transport, all | R |
| 09-14 | 5325fa9a / PR#211 | phone that cannot cache desk shows empty / invents fleet / pushes | PQ | transport | R |
| 09-14 | 44f2ad8c / PR#213 | every payment path hydrates from DB | SR | payments | |
| 09-18 | 1227b32e / PR#262 | guard against desk wipes (80 papers → 1) | PA | exam papers | R |
| 09-19 | db56501b / PR#278 | masters desk stops answering for staff roster ([] staff written over roster) | PH | masters→staff | |
| 09-24 | 9274fea6 / PR#318 | papers desk held in memory when no room | PQ | exam papers | R |
| 09-26 | eee8f525 / PR#325 | stale desk cache can't lose gateway payment | SR | payments | R |
| 09-26 | a433abc6 / PR#328 | "FIFTH CAUSE, FOURTH REPLAY" — cached pay-link copy | SR | payments | R |
| 09-27 | 5de6f0fb / PR#329 | date sheet only says saved when it saved | OT (silent save) | exams | R |
| 09-29 | 8c133e0e / PR#349 | office saves merge instead of erasing teachers' entries | PA | ptm, discipline, health | R |
| 09-29 | 9bb86f74 / PR#340 | ERP freezing: WA bot rewrote whole store per message (1,400 writes/5 min) | PL | wa | R |
| 09-29 | f8175ef2 / PR#348 | desk saves that were never recorded | OT (silent save) | attendance | R |
| 09-30 | 27f86506 / PR#360 | teacher's homework save prunes nothing else | PA | homework | R |
| 09-30 | afb0a055 / PR#364 | added subjects no longer vanish (hidden list) | OT | masters | |
| 10-05 | ea01d256 / PR#389 | subject teacher's save erased other subjects' marks | LU | exams | |
| 10-06 | 5012928b / PR#404 | full browser shows what it just loaded (HR staff 0 vs DB 35) | PQ | staff, masters | R |
| 10-08 | d06d6684 / PR#444 | browser that lost bank accounts takes server's; its saves deleted mode map | SR | accounts | R |
| 10-09 | d2840492 / PR#462 | every desk reads in-memory copy on full browser (62 loaders; attendance 0 on phones) | PQ | all | R |
| 10-09 | 73d23ba7 / PR#468 | homework never pruned by desk save (staff-app posts deleted) | PA | homework | R |
| 10-09 | PR#469–#473 (5 PRs) | desk saves never delete rows they do not hold | PA | accounts; fees/payments; payroll/statutory/vault; admissions/library/rte/ptm/exams; comms/notifications/leave/attendance | R |
| 10-09 | PR#475/#477/#479/#480 (4 PRs) | slice desks never delete a slice a save lacks; named deletes | PA | wa/trust; masters/transport; generic slices; leave/follow-ups | R |
| 10-09 | 7fe54ad0 / PR#500 | last replaced lists merge; browser names deletions | PA | rbac, exam papers, staff HR | R |
| 10-09 | 88016c23 / PR#474 | never seed or push before desk pulled | UF | accounts | R |
| 10-09 | f6ee5458 / PR#482 | never seed before pulled | UF | ptm, rte | R |
| 10-09 | c9c20f57 / PR#481 | never save/send from a failed desk read | UF | automation, staff HR | R |
| 10-09 | f65aa6ed / PR#483 | every masters write carries a revision; unversioned refused | SR | masters | R |
| 10-09 | 1726f02c / PR#490 | page desk reads; failed read is not an empty desk | UP | accounts, fees | R |
| 10-09 | e5933e3f / PR#498 | boarding tap and desk save lose each other (read-merge-write) | LU | transport | |
| 10-09 | PR#503/#504 | per-row versions, server + browser halves | SR | all | |
| 10-09/10 | PR#507–#517 (10 PRs) | "a stale copy can't …" guards | SR | student leave, ptm, admissions, attendance, staff attendance, comms, notifications, homework, fees, admissions surveys | R |
| 10-10 | 0bfb051d / PR#526 | module data lives on server + page memory, never localStorage | PQ | all | R |
| 10-10 | PR#529/#531/#534/#536 | save only the rows you changed, at loaded version | SR | accounts/staff; library/payroll/vault/statutory/rte; masters; exams | |
| 10-10 | 4d8b7061 / PR#524 | save can't wipe subject list / class–subject map (phone pushed foreign ids, 140→30 links) | SR | masters | R |
| 10-10 | 46129e68 | hard-disable lead list projection (would blank stored leads) | UF | admissions | |
| 10-10 | 3ec4aa66 / PR#539 | heavy desks load only on pages that use them | PL | all | R |
| 10-10 | 8ecd25b9 / PR#539 | home dashboard redraws when a desk lands | RO | dashboard | R |
| 10-11 | 565e7f0c / PR#545 | app pop-ups 45–70 s (~160 ensureSisHydratedServer/request) | PL | comms (server) | |
| 10-11 | 6d5a440e / PR#548 | Fee Take re-read dues every second (26 calls/30 s) | PL | fees | R |
| 10-11 | ab1390d0 / PR#548 | redraw when lazy desk lands; attendance via dedupeHydration | RO/PH | dashboard, attendance | R |
| 10-11 | 4b9b4875 / PR#559 | dashboard redraws share one read (7–9 fetches) | PL | fees, accounts | R |
| 10-11 | 828001aa | loan history never deleted | PA | library | R |
| 10-11 | ab9061d4 | never keep an unconfirmed copy | SR | fees | |
| 10-12 | c396e39e / PR#569 | one save at a time per desk (false conflicts, second change lost) | LU | all | R |
| 10-12 | e2f1b9c5 / PR#570 | load leave setup & staff records up front; never save before loaded | UF | masters, staff HR | R |
| 10-12 | 65bfc46d / PR#571 | no desk saved before loaded; "loaded" no longer expires at 15 s (fixes #570's guard) | UF | all | R |
| 10-12 | 5da73241 / PR#571 | screens wait for Masters (63 screens read once on mount) | RO | all | R |
| 10-12 | c4da7e1e, 89dd631f / PR#574 | screens wait for roles + roster; staff marked hydrated after roster written | RO/PH | rbac, staff | R |
| 10-12 | 5c11abcc / PR#578 (NOT LIVE) | Staff 0 — Masters load wrote pre-fetch copy over the roster | LU (snapshot-before-await)/PH | masters→staff | R |

### Counts per class (primary class; rows / PRs)
| class | rows | PRs (batches expanded) |
|---|---|---|
| UF unknown-became-fact | 17 | 17 |
| PA prune-by-absence | 16 | 23 |
| SR stale replica | 15 | 29 |
| PQ quota/eviction | 13 | 13 |
| OT (silent save 4, wipe-signal 2, other 4) | 10 | 10 |
| PL payload/perf | 8 | 8 |
| LU lost update | 7 | 7 |
| RO read-once screen | 5 | 5 |
| HE hydration echo | 4 | 4 |
| UP unpaged read | 2 | 2 |
| PH parallel-hydrate (primary; +3 secondary) | 1 | 1 |
| **total** | **98** | **119** |

### Counts per ISO week (classified rows; all PR merges / all `fix` commits in the repo for scale)
| week | dates | classified rows | all PR+branch merges | all fix commits |
|---|---|---|---|---|
| W32 | 03–09 Aug | 9 | 6 | 22 |
| W33 | 10–16 Aug | 15 | 26 | 55 |
| W34 | 17–23 Aug | 13 | 41 | 35 |
| W35 | 24–30 Aug | 3 | 5 | 51 |
| W36 | 31 Aug–06 Sep | 4 | 17 | 35 |
| W37 | 07–13 Sep | 7 | 110 | 48 |
| W38 | 14–20 Sep | 4 | 2 | 24 |
| W39 | 21–27 Sep | 4 | 37 | 34 |
| W40 | 28 Sep–04 Oct | 5 | 79 | 50 |
| W41 | 05–11 Oct | 28 rows (48 PRs) | 239 | 125 |
| W42 | 12 Oct | 6 | 30 | 16 |

### Recurrence
- 65 of 98 rows (66 %) are follow-ups to an earlier fix of the same class on the same desk or an "all desks" fix (marked R).
- Longest same-desk chains: PQ on sis/transport/staff (8 fixes: 10 Aug → 10 Oct); PA on sis→all→transport→fees→exams→homework→18 desks (16 rows, 6 Aug → 11 Oct); SR on masters (PR#1, Stage 0, 24fd9ae9, 90f05b97, #483, #524) and payments (#213, #325, #328 — "FIFTH CAUSE, FOURTH REPLAY"); masters-hydrate-overwrites-staff three times (ccb42628 18 Aug, #278 19 Sep, #578 12 Oct); fix-of-a-fix within 72 h: #404→#462, #474→"after #469 it adds duplicate masters", #570→#571 (15 s TTL), #548→#559, #529/#534→#569.
- PR merges since 28 Sep: 243; of these 113 carry fix/stale/no-prune/guard wording.

### Live revision 00856 vs origin/main 2f0eb3d4
| file | status |
|---|---|
| apps/web/src/lib/mastersPersistence.ts | differs — #578 only (line 168 `localBefore` → `loadMasters()`) |
| apps/web/src/lib/masters.ts | differs — #578 only (keep STAFF_OWNED_MASTERS_SLICES from current copy) |
| apps/web/src/lib/deskLoadGuard.selftest.ts | differs — #578 selftest |
| apps/web/src/app/api/inventory/assets/route.ts | in git since 23 Aug, absent from tarball (open question) |
| everything else incl. #569, #570, #571 (CoreDataGate), #572, #574, #575, #577 | identical — LIVE |

## open questions
- Why is apps/web/src/app/api/inventory/assets/route.ts (in git since 2e6fbf19, 23 Aug) absent from the live tarball — a tar exclude on 'assets', or a build that omits it? If omitted, the live /api/inventory/assets route 404s.
- The mobile API routes (/api/v1/principal/snapshot 5.0 s, parent/summary 1.5 s) were not read in this lens; the S6 mapping rests on the #545 server-side pattern (ensure*HydratedServer per request) and needs a direct read of those routes.
- Phase 1 exit tests in docs/TODO.md:241-277 (two-device convergence, kill-network mid-edit, whole-state push rejected) are still unchecked; was any of them ever run against the 9–12 Oct row-version + serial-save stack?
- The #526 memory-only design relies on hasDeskLoaded being sticky per page; nothing in the lens showed what happens on a phone where the tab is suspended and resumed hours later with a stale in-memory copy (the SR class moved from localStorage to RAM, not removed).
