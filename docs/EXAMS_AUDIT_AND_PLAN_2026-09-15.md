# Exams desk — audit and rebuild plan (15 Sep 2026)

Scope: the Exams / report cards desk (`apps/web/src/lib/exams*.ts`, `apps/web/src/components/exams/*`, the `exam_desk_*` tables, the staff-app marks screen). Audited against the CBSE assessment scheme for every class from Nursery to XII.

## Verdict

1. **The desk has never been used for real.** Production holds 4 terms, 12 subjects, 1 policy row and **zero mark sheets, zero marks**. Someone opened it today (sync_meta updated 15 Sep 07:10 UTC) but saved nothing.
2. **It is unusable at class size today.** Measured on the dev build with the LKG grid (33 pupils × 7 subjects): the grid takes ~21 s to appear, and **each keystroke freezes the page for ~9.6 s**. Cause verified: one keystroke re-reads and re-parses the 1.2 MB student blob 529 times and the masters blob 1,455 times from localStorage.
3. **Its save path can destroy other teachers' marks.** Every save replaces the whole desk with the saver's stale local copy, deleting sheets it does not know about (marks cascade-delete with them). Failed pushes are silent and the next hydrate discards the unsent marks.
4. **One assessment scheme for the whole school.** One 8-point grade scale, one policy row (`exam_policy` is keyed on tenant only), one term calendar, one max-marks per subject, no subject components, no grades-only report, no pre-primary observational card, no RTE no-detention rule. Nursery gets Social Science and Computer out of 100 with an A1–E grade.
5. **Parents can receive nothing.** No parent API, no app screen, no WhatsApp flow for results or report cards.

## What was measured (local dev build, production data read-only)

| Action | Result |
|---|---|
| Dashboard → Mark entry tab (empty) | instant |
| Choose LKG · A (33 × 7 = 231 cells) | two long tasks: 11.06 s + 9.70 s |
| Type one digit in a cell | one long task of 9.6 s (repeated 3×: 9.6 / 9.6 / 9.5 s) |
| localStorage reads during that one keystroke | `bhb_sis_v1` ×529 (1.19 MB each), `bhb_masters_v5` ×1,455 (396 KB), `bhb_exams_v1` ×463 |
| Server calls while typing | none (marks only push on Save) |

Production build is faster than dev, but the work is proportional: ~630 MB of student JSON parsed per keystroke.

## A. Speed — root causes (verified)

| # | Where | What | Fix |
|---|---|---|---|
| A1 | `ExamsWorkspace.tsx:1640` → `exams.ts:1678`, `:1613-1635` | `studentTakesExamSubject(st, sub)` is called per cell in render with no state argument, so each cell runs `loadExams()` + `syncExamSubjectsFromMasters()` (→ `loadMasters()`, `loadSis()`) + `loadMasters()` again. None of the loaders is memoised. | Build one `Map<studentId, Set<subjectId>>` in a `useMemo` keyed on roster/subjects/tick, passing a single `loadExams()` snapshot. Add a write-invalidated memo to `loadSis` / `loadMasters` / `loadExams`. |
| A2 | `exams.ts:1642-1647` | The same render path calls `saveExams()` (full `JSON.stringify` + server push) when it synthesises a subject. Side effect inside `.map()` in JSX. | Make `subjectsForStudent` pure; synthesise subjects in the explicit refresh/save paths only. |
| A3 | `ExamsWorkspace.tsx:1635` (and `:1674` co-scholastic) | `grid.find()` inside the students × subjects nest: O((S×J)²), ~230k comparisons per render for LKG. | Keep the grid as a `Map` keyed `student:subject` (ItemScoresPanel already does). |
| A4 | `ExamsWorkspace.tsx:270-277`, `:1647-1660` | `setMark` replaces the whole grid array; the input is controlled off that array with an inline closure; no memoised row/cell component in the 2,070-line file. | `React.memo` `MarkRow`/`MarkCell` with primitive props; local draft state, commit on blur/Enter; `useCallback` handlers. |
| A5 | `workspaceSyncPolicy.ts:2` | `DESK_PUSH_DEBOUNCE_MS = 0`; `examsPersistence.ts:42-51` fires two whole-desk pushes per save (jsonb blob + normalised desk). | Debounce 500–1000 ms; push the touched sheet only (see B). |
| A6 | Results / At-risk / Remarks / Report cards tabs | `buildReportCard` per student re-runs `loadExams()`, `loadMasters()`, `loadSis()` and `checkHold()` (which loads SIS + masters + fees and computes dues) — `ExamsWorkspace.tsx:550-565`, `:1779`; `AtRiskPanel.tsx:60-72` does it per student **per earlier term**. | Thread one state snapshot through `buildReportCard`; batch holds via one `holdsForStudents(ids)`; move `checkHold` out of render. |

Checked and not found: no per-keystroke localStorage write or push; no router navigation on tab change; tabs unmount cleanly; no polling; keys are stable.

## B. Data safety — the save path

| # | Where | Defect | Severity |
|---|---|---|---|
| B1 | `examsNormalized.server.ts:801` | The transactional per-sheet writer `pushExamSheetToDb` exists and is **never called**. All writes go through `pushExamDeskToDb` (`:437`). | data loss |
| B2 | `examsNormalized.server.ts:467-472`; schema `20260802190000_exam_desk_normalized.sql:67` (`on delete cascade`) | Push prunes `exam_desk_sheets` to the ids in the payload. Teacher B's tab, hydrated at 09:55, saves at 10:02 and deletes the 9-A sheet teacher A saved at 10:00, marks included. Client hydrates once on mount (`ExamsWorkspace.tsx:157-173`), never again. | data loss |
| B3 | `examsNormalized.server.ts:533-541` (+ `:552-559`, `:571-578`, `:590-597`) | Deletes **every** mark of the pushed sheets, then upserts. Not a transaction; if the upsert fails the marks are gone. Delete errors are discarded (`:537`, `:556`, `:575`, `:594`). | data loss |
| B4 | whole path | Last-write-wins at whole-desk granularity; no `updated_at` check, no version token. | data loss |
| B5 | `api/v1/staff/exams/marks/route.ts:74-83` + `exams.ts:998-1003` | Each phone save fires two concurrent whole-desk pushes racing on the same delete/upsert. | data loss |
| B6 | `exams.ts:421`, `:944`, `:1017` | Server-side exam state is one process-global mutated across concurrent requests; a concurrent phone save can push a desk **without** the other request's marks and still return 200. | data loss |
| B7 | `examsNormalizedClient.ts:93-103`; `examsNormalizedMerge.ts:37-52`; `examsDbConfig.ts:7-14` | Failed push: no retry, banner not mounted in ExamsWorkspace, UI already said "Marks saved". Next hydrate (`preferDb` default true) drops local-only sheets. Marks vanish with no error. | data loss |
| B8 | `api/school-data/exams-desk/route.ts:49`; `rbac.ts:614`, `:372` | Web desk needs only `exams:edit`; the built-in teacher role has it for the whole school despite "Own class(es) only". Phone routes scope by section; the browser does not. | wrong |
| B9 | `exams-desk/route.ts:72-80`; `examsNormalized.server.ts:243`; `exams.ts:1825` | Lock is stored from the client payload; the API never checks stored `locked_at`; "Save & lock" on a locked sheet rewrites marks. No unlock exists (`exams.ts:1828`, "not available in demo"). No publish/release state. | wrong |

Tests: `exams.selftest.ts` covers only the audit-flattening helpers; nothing above is under test.

## C. CBSE fit by class band

The ERP already knows the bands (`masters.ts:70-104`: PRE_PRIMARY, PRIMARY, MIDDLE, SECONDARY, SENIOR) but `exams.ts` never reads `groupCode` (0 occurrences).

| Band (pupils 2026-27) | What CBSE / NEP expects on the card | What the desk does today |
|---|---|---|
| **Nursery, LKG, UKG** (74) | No exams. Observational, descriptive record of skills and learning outcomes (NCF-FS 2022 / PARAKH Holistic Progress Card): grade bands or descriptors, no numbers. | Numeric grid, 7 subjects incl. Social Science and Computer out of 100, A1–E grade printed. |
| **I–II** (53) | Foundational stage as above; at most grade bands per learning area. | Same numeric grid. |
| **III–V** (55) | Two terms; term exam + internal (periodic test, notebook, subject enrichment); grades (schools commonly 5- or 8-point); co-scholastic Work Ed / Art Ed / HPE on A–C; **no detention** (RTE §16). | Marks out of min(term, subject) max; one fixed UT/HY/UT/Annual calendar; can mark a Class III child "Detained". |
| **VI–VIII** (44) | Each term 100 = 80 term exam + 20 internal (PT 10 + notebook 5 + subject enrichment 5), Term-2 covers part of Term-1 syllabus; 8-point A1–E; co-scholastic + Discipline A–C; no detention I–VIII (2019 amendment lets a state allow it in V/VIII after a re-exam). | Weighted mean rescaled to 100; no internal components; co-scholastic has only "socio-emotional" and "psychomotor" (`exams.ts:197`); Discipline absent. |
| **IX–X** (12) | Annual 80 + internal 20 (periodic assessment 5, multiple assessment 5, portfolio 5, subject enrichment 5); 33 % pass; 8-point grades; co-scholastic A–C. | One number per subject per term (`exam_marks` unique on sheet, student, subject); cannot store 80 and 20 separately. |
| **XI–XII** (0) | Subject-wise theory/practical or project split (70+30, 80+20, 60+40…); 33 % required in theory **and** practical separately; compartment. | No components, no separate pass criteria, no compartment. `nextClassAfter` marks a passing XII (or VIII at a Nursery–VIII school) as "Conditional". |

Structural blockers (must change before any band-specific work):

- `exam_policy` / `exam_desk_policy` are `primary key (tenant_id)` — one policy per school by construction (`20260712170000_…policy.sql:12`, `20260802190000_…normalized.sql:78`). `ExamsState.policy` is a single object.
- `ExamGradeScale = "cbse8"` is a one-member type (`exams.ts:64`); `normalizeExamPolicy` overwrites any value with it (`:466`); cut-offs are inlined (`:527-534`).
- `ExamTerm` and `ExamSubject` carry no class band; max marks are `min(term.maxMarks, subject.maxMarks)` with `100` hard-coded in nine places (`:1707`, `:631-685`, `:1535`, `:1597`).
- `exam_marks` is unique on (sheet, student, subject) — no component column.
- Aggregation is triggered by literal term codes `HY` / `ANNUAL` / `FINAL` (`:709-716`, `:2266-2273`) and rescales to 100 (`:2349`). Terms named "Term 1 / Term 2" get no aggregation.
- `CO_SCHOLASTIC_DOMAINS` is a code constant; unknown domain strings are coerced to socio-emotional (`:876-886`). Masters' co-scholastic subjects are dropped on sync (`:1498`).
- Subject seed uses `classIds: []` = every class (`:624-690`), which is why LKG shows Social Science.

Report card omissions (`ReportCardSheet.tsx`, `ReportCard` type at `exams.ts:2052-2089`): no Result (Promoted / Detained) on the card, no rank, no class average / highest, no height / weight / health, no principal's remark, no term-wise columns, no grades-only layout. Attendance is full-year, not term-scoped (`exams.ts:2109-2112`).

## D. Not wired end to end

- Parents: `api/v1/parent/` has attendance, online-classes, summary only; the parent app and the WhatsApp bot have no results flow. Report cards exist only as a desk print preview.
- Staff app: terms, sheet, marks, date sheet round-trip (with defects B5/B6); item scores, blueprints, papers, invigilation, admit cards are desk-only.
- At-risk AI notes are clipboard-only, never stored.

## Plan

Phases are in dependency order. Each is one PR against main, rehearsed on the local PG17 copy for any migration.

### Phase 0 — Make typing usable (1–2 days, no schema)
A1–A6 above. Acceptance: LKG grid renders in < 300 ms and a keystroke costs < 16 ms on the production build, measured with the same long-task probe; Results / Report cards tabs open in < 1 s for a 33-pupil section.

### Phase 1 — Make saving safe (2–3 days, small schema)
- Route the desk POST through `pushExamSheetToDb` per sheet; scope pruning to sheets the client actually holds for the (term, section) it is saving. Keep the whole-desk push only for terms/subjects/policy.
- Enforce `locked_at` server-side; add an unlock action (owner / principal / exam in-charge) with audit; add `published_at` on sheets.
- Web desk RBAC: teachers write only their own class/section sheets (reuse `assertSectionScope`).
- Retrying push + `DeskSyncBanner` in ExamsWorkspace; merge (not replace) local-only sheets on hydrate; remove the process-global server cache from the v1 routes (hydrate per request) and drop the double push.
- Selftests for `saveMarkSheet`, lock, merge, push prune scope.

### Phase 2 — Assessment schemes per class band (schema + model, ~1 week)
New table `exam_assessment_schemes` (tenant, band or class list, academic year) holding: grade scale (8-point A1–E, 5-point A–E, 3-point / descriptor bands), display mode (marks + grade, grade only, descriptors only), term structure with weights, internal-assessment components with max marks, pass rule (aggregate vs per-component 33 %), promotion rule (no-detention / re-exam / detain), co-scholastic areas (Work Ed, Art Ed, HPE, Discipline; A–C). Add `component` to `exam_desk_marks` (unique on sheet, student, subject, component) and per-(scheme, subject, term, component) max marks. Migrate the single policy into a school-wide default scheme so nothing changes until a band overrides it. Grade functions take the scheme. Aggregation keyed on term role (term exam / periodic / internal), not on code strings.

### Phase 3 — Mark entry per scheme (~1 week)
Grid columns come from the scheme: subject × components for VI–XII; single mark for III–V; grade picker (A–E or descriptors) for I–II; observational checklist for Nursery–UKG (learning areas from Masters, descriptor per area, teacher note). Subjects per class come from Masters' class curriculum; "empty class list = all classes" is removed. Keyboard-first entry (Tab / Enter / arrows), paste from a sheet, per-cell validation against component max.

### Phase 4 — Report cards per band (~1 week)
Layouts: Holistic Progress Card for Nursery–II; grades-only for I–II if the school prefers; marks + grade with term columns for III–VIII; 80+20 breakdown for IX–X; theory/practical for XI–XII. Add Result, rank (optional per scheme), class average / highest, attendance scoped to the term dates, height / weight / blood group, class teacher + principal remarks, signatures. Class result sheet, toppers and promotion follow the scheme's rules (RTE band cannot be detained; XII passing = "Passed").

### Phase 5 — Publish and deliver (3–4 days)
Publish gate per sheet (lock → moderate → publish). Parent app results screen and `api/v1/parent/results`; WhatsApp report-card PDF via the receipt-style signed link; fee-hold rule stays (`reportCardHoldFromStage`). Staff app: grid driven by the same scheme (components / grades).

### Phase 6 — Verification (ongoing)
Selftests for grading per scale, aggregation per scheme, promotion rules per band, merge/push; add each to the three places the verify-suite drift check requires. Live rehearsal under the throwaway test term only.

## Status

| Phase | State | Evidence |
|---|---|---|
| 0 — Speed | **Done 15 Sep 2026** (branch `feat/exams-speed-and-safe-saves`) | Same LKG · A grid, same long-task probe, dev build: grid render 0 long tasks (was 11.06 s + 9.70 s); four keystrokes + Tab 0 long tasks (was 9.6 s each); SIS/masters blob reads per keystroke 0 (was 529 / 1,455). Report cards / Results tabs ≈1.3 s in dev (was several seconds; the remaining cost is the per-pupil fee-dues computation, now done once per section). |
| 1 — Safe saves | **Done 15 Sep 2026**, same branch | Sheets go through `POST /api/school-data/exams-desk/sheet` (transactional per-sheet write, version check → 409, stored lock honoured → 423, section scope → 403, unlock audited). Whole-desk push is setup only and needs a school-wide login. Unsent sheets are recorded, kept through hydrate, retried and shown in the desk's banner; a refused sheet is kept as a conflict copy. Verified locally: Save → per-sheet POST → refused by the local production-write guard → banner "Your exam marks are not saved on the server", 2 retries recorded, sheet kept locally. Self-test `test:exams-sheet-safety`. |
| 2 — Schemes per band | **Done 15 Sep 2026** (branch `feat/exams-assessment-schemes`) | Every choice is a setting the school picks under Exams & policy → Assessment schemes: grade scale (8-/5-/3-point, custom bands), marks / grade only / descriptors, subject components (80 + 20, theory + practical), pass % and pass-each-component, promotion rule (no detention / re-exam / detain), rank, class average, result, co-scholastic areas, exams sat. CBSE presets for all six bands. `exam_desk_marks.component` migration rehearsed. Verified in the browser: VI Half-yearly grid shows TE/PT/NB/SE columns; Nursery shows A/B/C descriptor pickers. Self-test `test:exam-schemes`. |
| 3 — Mark entry per scheme | **Partly done** with phase 2 | Component columns and grade pickers exist. Not yet: an observational checklist with learning areas per band (pre-primary still uses the class's subjects as areas), paste-from-sheet, per-subject component overrides (a subject with no practical). Subjects per class still come from the exam catalog with "empty list = all classes". |
| 4 — Report cards per band | **Partly done** with phase 2 | Card follows display mode (no numbers on grade-only / descriptor cards), shows the component breakdown with a failing part starred, rank, class average and the recorded result. Not yet: Holistic Progress Card layout, term-wise columns, height / weight / health, principal's remark, term-scoped attendance. |
| Absent / present per exam | **Done 15 Sep 2026**, same branch | Toggle per student on the marks grid with an optional reason; stored in `exam_desk_absences`; the card prints "Absent in this examination — reason" and AB per subject; the result sheet says Absent; absent children are left out of rank and average. Verified in the browser on Class III. |
| Report card templates | **Done 15 Sep 2026** | Exams & policy → Report card templates: six prefilled layouts (classic, Holistic Progress Card, grades card, board-style, term-wise, compact), assigned per class or per band in one click, every field editable (title, identity lines, photo, attendance, components, grade legend, rank, average, result, co-scholastic, remarks, signatures, footer, watermark). The printed card follows `card.presentation`; a template's switch wins over the scheme's when set. Self-test `test:exam-report-templates`. |
| 5–6 | Not started | Parent delivery and publish gate; more self-tests. |

Left for phase 1 follow-up: the class/section pickers on the web desk still list every section for a class teacher; the server now refuses the save (403) and the banner explains, but the pickers should be scoped like the phone's. `published_at` was deferred to phase 5.

## Decisions the school now makes in the desk (no code needed)

1. Which grade scale and display per band: Nursery–UKG descriptors; I–II grade-only; III–V 5-point or 8-point; VI–XII 8-point.
2. Term calendar per band: keep UT1 / HY / UT2 / Annual for III–XII, or move to CBSE's Term 1 / Term 2 with periodic tests inside each.
3. Internal assessment split for VI–VIII (10 + 5 + 5) and IX–X (5 + 5 + 5 + 5): adopt as CBSE prescribes or a school variant.
4. Detention policy for V and VIII (re-exam and then detain, or never) — the school is state-recognised for Nursery–VIII, so IX–XII schemes are built for readiness, not for this year's board work.
5. Whether rank appears on cards (CBSE discourages; many schools still print it).
