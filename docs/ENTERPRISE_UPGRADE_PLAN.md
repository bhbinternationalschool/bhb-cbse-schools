# Enterprise Upgrade Plan — BHB School ERP

**Goal:** transform the current ERP into an enterprise-grade system where every
module has consistent, legible, friendly UI; proper filters, KPIs and reports;
and AI + WhatsApp woven into daily work — so that any user opening any module
feels guided, not lost.

**Method:** this plan is grounded in a measured audit of the codebase
(2026-08-10), not impressions. Numbers below are from the actual tree.

---

## 1. Where the system stands today

### What exists (more than it appears)

| Asset | Reality |
|---|---|
| Modules | 29 routed modules, 28 bespoke workspace components |
| UI code | 236 components, ~121,000 lines |
| Shared UI kit | `components/ui/` exists (button, card, erp-roster, erp-charts, erp-workspace-shell) but adoption is inconsistent — most workspaces hand-roll their own tables, filters and layout |
| Design tokens | 136 CSS variables already in `globals.css` |
| Reports | 10 report catalogs (`feeReportCatalog`, `sisReportCatalog`, …) + a Reports Center |
| AI | ERP chatbot (`/api/erp-ai` + `erpAiContext.server`), AI tutor, exam-paper / school-document / staff-agreement / certificate generators, WA-template drafting, OCR for profile docs; Gemini + OpenAI both wired |
| WhatsApp | Webhook, hub, dispatch, template governance, SIS bot, survey bot, class channels, automation, IVRS, fee receipts, leadership reports |
| Ops | Cloud Run deploy pipeline, BigQuery sync, cron jobs, PWA shell, audit trail (new), 12 self-tests + `npm run verify` |

**Implication:** this is not a rebuild. It is a consolidation — the parts
exist; what's missing is consistency, a shared spine, and finishing the last
mile of AI/WA into each module's daily workflow.

### The measured problems

1. **Typography is objectively too small.** Counted across components:
   `text-[9px]` ×73, `text-[10px]` ×571, `text-[11px]` ×1,491. That is
   **2,135 places** rendering text at 9–11px — below any accessibility
   floor. This alone explains "fonts are not satisfactory".
2. **Every module is its own UI.** 28 workspaces, several 2,500–3,300 lines
   each (`FeeTakeWorkspace` 3,284; `AccountsPanels` 3,282;
   `AdmissionsWorkspace` 2,872). No shared filter bar, KPI row, or table.
   Fixing anything means fixing it 28 times.
3. **The data layer bites its users.** Proven in production on 2026-08-09:
   client-authoritative full-state sync destroyed and re-destroyed masters
   and roster data four times in one day. Guards now exist (sis-prune cap,
   masters overwrite guard), but the underlying model — localStorage as
   truth, whole-state pushes — remains, and per-device truth is why two
   devices show different class counts.
4. **Failures are silent.** The 503 loop ran for days unseen; prune
   refusals log to a console nobody reads. Users can't trust what they
   see, which is the deepest "not user-friendly" there is.
5. **No enforced quality gate.** GitHub Actions cannot run (account
   billing); `npm run verify` is local and opt-in.

---

## 2. The target: what "enterprise-grade" means here, concretely

Every module, when opened, presents the same anatomy — learn it once, know
every module:

```
┌────────────────────────────────────────────────────────────┐
│ Module header: title · academic year · global search        │
│ KPI row: 3–5 live numbers with trend + tap-through          │
├────────────────────────────────────────────────────────────┤
│ FilterBar: quick chips · saved views · date range · reset   │
├──────────────────────────────┬─────────────────────────────┤
│ DataTable                    │ Detail / action panel        │
│  sort · paginate · column    │  record view · timeline ·    │
│  pick · bulk-select · export │  AI assist · WA actions      │
├──────────────────────────────┴─────────────────────────────┤
│ Tabs: Work · Reports · Insights (AI) · Settings             │
└────────────────────────────────────────────────────────────┘
```

Plus, uniformly: minimum 13px body text (14px default), loading/empty/error
states that say what happened and what to do, every destructive action
confirmed and undoable where possible, every failure surfaced as a toast with
a retry — never a silent console line.

---

## 3. The plan — six phases, strictly ordered

> **Ordering rule:** the data layer comes before the paint. Repainting 28
> workspaces on top of a sync model that eats data would decorate a house on
> sand — 2026-08-09 was the proof.

### Phase 0 — Unblock and stabilize *(week 1; small, mostly done)*

1. **Fix GitHub Actions billing** (owner action: github.com/settings/billing)
   so `ci.yml` actually gates merges. Until then `npm run verify` is the gate.
2. Surface the two known silent failures found in review: prune refusal and
   audit `capState` truncation.
3. Decide the two open product questions (see §6): bilingual UI, and density.

**Exit test:** a PR with a broken self-test cannot merge.

### Phase 1 — Server-authoritative data layer *(weeks 1–4)*

The single highest-leverage change in this plan.

1. **Generalize the versioned-push pattern.** `sis_push_guarded`
   (revision-checked, conflict-returning, atomic) is the template. Apply the
   same contract to masters and every desk slice: the client sends *changes
   with the revision it read*, the server merges or returns a conflict.
   Whole-state pushes are removed as a client capability, not merely guarded.
2. **localStorage becomes a cache, never truth.** Reads hydrate from the API
   (`ok`-flag pattern, already in place); writes go through explicit save
   actions; nothing pushes on navigation.
3. **One data-access layer.** Replace the ~20 hand-rolled
   `*Persistence.ts` variants with a single typed client (fetch + cache +
   invalidate — TanStack Query or an equivalent thin layer), so every module
   gets loading/error/refetch behaviour for free.
4. Delete the 8-second unconditional chat sync as part of the same sweep.

**Exit test:** two devices editing the same module converge; killing the
network mid-edit loses nothing silently; the incident class of 2026-08-09 is
structurally impossible, and a regression test proves it.

### Phase 2 — Design system and the Module Shell *(weeks 3–6, overlaps 1)*

1. **Typography scale, enforced.** Tokens: body 14px, secondary 13px, caption
   12px floor, headings 16/18/22. A lint rule (or codemod + stylelint) bans
   `text-[9px]`–`text-[11px]`; the 2,135 occurrences are migrated by codemod,
   then reviewed module-by-module.
2. **Consolidate the 136 CSS variables** into a documented token set: color
   (semantic, light/dark), spacing, radius, elevation, motion. Density toggle
   (comfortable / compact) instead of tiny fonts as pseudo-density.
3. **Build the Shell kit** (extending `components/ui/`, not replacing it):
   `ModuleShell`, `KpiRow` + `KpiCard` (value, delta, sparkline,
   tap-through), `FilterBar` (chips, ranges, **saved views** — generalize
   `studentFilters.ts`, which already does exactly this for one module),
   `DataTable` (TanStack Table: sort, paginate, column picker, bulk select,
   CSV/XLSX export), `DetailPanel`, `EmptyState` / `ErrorState` /
   `LoadingState`, `ConfirmDialog`, `AiAssistButton`, `WaActionMenu`.
4. **Accessibility pass** with the kit: WCAG AA contrast, focus states,
   keyboard navigation, 44px touch targets (most staff use phones).
5. **Hindi/English bilingual labels** if approved in §6 — for front-office
   staff this is the single biggest "feels easy" lever available.

**Exit test:** a storybook-style gallery page renders the whole kit; one
pilot module is fully rebuilt on it and signed off by an actual daily user.

### Phase 3 — Module-by-module conversion *(weeks 5–14, the long middle)*

Convert one module at a time onto the Shell. Each conversion is one PR:
KPIs defined, filters + saved views, DataTable, reports tab wired to its
catalog, AI + WA actions stubbed or live, old code deleted. Verified by
`npm run verify` + before/after screenshots + a five-minute walkthrough with
the person who uses that module daily.

Order = daily-use frequency × current pain:

| Wave | Modules | Why first |
|---|---|---|
| 1 | **Fees (Fee Take)**, **Students/SIS** | Highest daily traffic; largest files (3,284 / 2,557 lines); money and children |
| 2 | **Admissions**, **Attendance**, **Exams** | Seasonal spikes; parent-facing outputs |
| 3 | **Accounts**, **Staff + Payroll**, **Masters** | Back-office depth; accounts just got its lib split — UI should follow |
| 4 | Transport, Library, Store, Purchase, Comms | Moderate use |
| 5 | Trust, RTE, Vault, Homework, PTM, Student-leave, Timetable, Gallery, News, Notices, Certificates, Documents | Long tail; mostly mechanical once the kit is proven |

KPI examples to seed each module (finalized with users during its wave):

- **Fees:** today's collection, month vs target, defaulters count + amount, online/cash split
- **Students:** active roster, new admissions MTD, incomplete profiles, UDISE compliance %
- **Attendance:** today's %, absent-without-notice list, chronic absentees, staff attendance
- **Admissions:** open leads, conversions this week, follow-ups due today, source performance
- **Accounts:** cash in hand, bank balance, payables due 7 days, expense vs budget

### Phase 3a — Visual refit checklist *(rails for the module-by-module work above)*

The separate visual-upgrade track (`docs/plans/woolly-riding-quail.md`) built
the foundation this phase needs: design tokens + dark mode (Phase 0), a
Recharts chart kit (Phase 1), component kit v2 evolved in place — every
`ErpMetricCard`/`ErpTableShell`/`ErpPanel`/`.erp-surface`/`.erp-data-table-wrap`
consumer already renders on tokens for free (Phase 2), and five full screen
refits: Home, Students, Fees (top-of-page only — see note below), Attendance,
Login (Phase 3). That work is done and merged.

What's left is mechanical, module by module. Per module, before marking it
done:

1. `ErpWorkspaceShell` + `ErpModuleHeader` + `breadcrumbs` prop (the shell
   itself is free once adopted; breadcrumbs are opt-in via `ui/breadcrumbs.tsx`).
2. Raw `<table>` → `ErpTableShell`/`ErpTable`/`ErpTableHead`/`ErpTableBody`
   (lowers the `raw_table` ratchet — `scripts/check-ratchets.sh`).
3. Hex sweep: replace `bg-[#…]`/`rgba(32,48,80,…)`/hardcoded `bg-white` with
   the tokens in `globals.css` (lowers `raw_hex`). Watch specifically for
   `bg-[var(--brand-deep)]` — that token is a text token, not a background
   one, and using it as a background is the single most common bug found
   during Phase 3 (fix: `--primary`/`--primary-foreground`).
4. `Skeleton`/`SkeletonTable`/`SkeletonKpiRow`/`SkeletonChart`/`SkeletonForm`
   per async-loading region (`ui/skeleton.tsx`).
5. `EmptyState` (`ui/empty-state.tsx`, `variant="panel"|"table"|"page"`) per
   zero-result state — and if the emptiness can be caused by an active
   filter, the action should read "Clear filters", not just "Add record".
6. Any inline SVG chart → `ui/erp-chart-lazy.tsx`'s `ErpBar`/`ErpDonut`/
   `ErpArea`/`ErpSparkline`. Always pass `isAnimationActive={false}` (see
   that file's own comment — a real, reproduced bug, not just a preference).
7. Dark + mobile QA in the browser: toggle theme, check the marking/data-entry
   grids specifically for tap-target size (44px minimum — Attendance's
   marking grid was 40px until Phase 3 fixed it).
8. Lower both ratchet budgets in `scripts/ratchets.txt` in the *same* commit
   as the fixes that earned the improvement — `check-ratchets.sh` prints the
   new count when a budget can tighten.

Status by module (updated as each is converted; "Charts" = Phase 1's Recharts
migration, independent of the rest of the checklist):

| Module | Workspace file | Status |
|---|---|---|
| Home | `dashboard/{PrincipalCockpit,TeacherHome,SchoolHomeDashboard}.tsx` | Done (Phase 3) |
| Students | `students/StudentsWorkspace.tsx` | Done (Phase 3) |
| Attendance | `attendance/AttendanceWorkspace.tsx` | Done (Phase 3) |
| Fees (Fee Take) | `fees/FeeTakeWorkspace.tsx` | Partial — header/toolbar/search-card only, deliberately (live payment code, no staging); full sweep still pending |
| Staff | `staff/StaffWorkspace.tsx` (+11 sub-panels) | Done (Charts Phase 1; full color/token sweep + all 5 raw `<table>`s converted to ErpTableShell kit; StaffProfileForm.tsx's printable ID-card sheet and its embedded QR deliberately left on fixed literals — same call as Fees' receipt flow) |
| Login | `login/LoginPanel.tsx` | Done (Phase 3) |
| Payroll | `payroll/PayrollWorkspace.tsx` | Done |
| Admissions | `admissions/AdmissionsWorkspace.tsx` | Done |
| Accounts | `accounts/{AccountsWorkspace,AccountsPanels,AccountsMastersPanel}.tsx` | Done (color/token sweep + all 13 raw JSX `<table>`s in AccountsPanels.tsx converted to ErpTableShell kit; 2 print-window HTML-string tables deliberately left untouched, same as Fees' receipt flow) |
| Exams | `exams/{ExamsWorkspace,ExamPapersPanel,InvigilationPanel,ExamDateSheetPanel}.tsx` | Done (color/token sweep; print sheets — ClassResultSheet/ExamPaperPrintSheet/ReportCardSheet — deliberately untouched, same as Fees' receipt flow) |
| Masters | `masters/` (35 files, ~18k lines — the largest module) | Done (color/token sweep + raw `<table>`s in RolesPermissionsPanel/StaffAttendanceRulesPanel/FoundationPanels/ConcessionsPanel/SalarySetupPanel converted to ErpTableShell kit) |
| Transport | `transport/{TransportWorkspace,TransportFleetPanels,TransportOpsPanels,TransportPlannerPanel}.tsx` | Done (color/token sweep; TransportGoogleMap.tsx untouched — map styling is a different concern) |
| Library | `library/LibraryWorkspace.tsx` | Done |
| Store | `store/{StoreWorkspace,StoreAccountsWorkspace,StockMasterWorkspace,StoreModuleNav,StoreInventoryAllocationPanel,StoreAssetAllocationPanel,StoreSellReturnPanel,StoreReportsPanel}.tsx` | Done (color/token sweep + raw `<table>`s in StockMasterWorkspace/StoreAccountsWorkspace/StoreInventoryAllocationPanel/StoreAssetAllocationPanel converted to ErpTableShell kit) |
| Purchase | `purchase/{PurchaseWorkspace,PurchaseReturnPanel}.tsx` | Done |
| Comms | `comms/{CommsWorkspace,WaChatHubPanel,SocialCredentialsPanel,ClassChannelsPanel,SocialCrossPostPanel}.tsx` | Done |
| Trust | `trust/{TrustWorkspace,TrustPanels}.tsx` | Done |
| RTE | `rte/RteWorkspace.tsx` | Done |
| Vault | `vault/VaultWorkspace.tsx` | Done |
| Homework | `homework/{HomeworkWorkspace,ClassroomSyncPanel}.tsx` | Done |
| PTM | `ptm/PtmWorkspace.tsx` | Done |
| Student leave | `studentLeave/StudentLeaveWorkspace.tsx` | Done (was already clean — no hardcoded colors found) |
| Timetable | `timetable/{TimetableWorkspace,SubstitutionPanel}.tsx` | Done |
| Certificates | `certificates/CertificatesWorkspace.tsx` | Done (CertificateSheet.tsx untouched — print component) |
| Documents | `documents/DocumentMakerWorkspace.tsx` | Done |
| UDISE compliance | `students/UdiseComplianceWorkspace.tsx` | Done |
| Reports Center | `reports/ReportsCenterWorkspace.tsx` | Done |
| Modules (hub) | `modules/ModulesWorkspace.tsx` | Done |

### Phase 4 — AI as a working layer, not a chatbot *(weeks 8–16, overlaps 3)*

Build on the existing Gemini/OpenAI plumbing and `erpAiContext.server`:

1. **Module-aware copilot.** The existing ERP chatbot, given each module's
   context pack: on Fees it answers "which classes are behind on collection?"
   with real numbers and links; every answer carries a "how I got this".
2. **Ask-for-a-report in plain language.** NL → the existing report catalogs
   (10 already enumerate their parameters — they are the function-calling
   schema, nearly free).
3. **Anomaly cards on Insights tabs.** Attendance dips vs pattern, fee
   defaulter risk scoring, duplicate-entry detection, expense outliers —
   start rule-based, add models where data supports them.
4. **OCR-first data entry everywhere it hurts:** marks sheets, paper
   receipts, TC/document intake (profile-doc OCR already exists — extend).
5. **AI drafting extended** from the current four generators to notices,
   circulars, PTM summaries, fee-reminder message variants — always
   draft-then-human-approve, never auto-send.
6. **Guardrails:** every AI write lands as a draft; AI reads go through the
   same RBAC as the user; prompt-injection hygiene on any user-content input.

### Phase 5 — WhatsApp as the front door *(weeks 8–16, overlaps 3–4)*

The plumbing (webhook, dispatch, templates, bots, channels) exists; the work
is wiring it into each module's Shell as `WaActionMenu` items:

| Module | WhatsApp actions |
|---|---|
| Fees | Reminder with UPI link (exists — surface per-row and bulk-by-filter), receipt on payment (exists), defaulter escalation ladder (3 gentle → firm → call list) |
| Attendance | Same-period absence alert to parent; monthly summary |
| Exams | Report card PDF to parent; schedule broadcasts |
| Admissions | Lead follow-up templates; registration link; status updates |
| PTM | Slot booking via bot; reminders; summary after |
| Staff | Leave request + approval inside WA; payslip delivery |
| Leadership | Daily 7am digest via `waLeadershipReports` (exists — schedule it): collection, attendance, admissions, alerts |
| Parents inbound | SIS bot (exists) promoted to a proper menu: fees due, attendance, homework, report card, "talk to office" |

Governance: one template registry, per-module rate limits, quiet hours,
per-parent opt-out, and a delivery dashboard (sent/delivered/read/failed).

### Phase 6 — Performance, polish, adoption *(weeks 14–18)*

1. Code-split the giant routes; virtualize long tables; target <2s first
   load on a mid-range Android phone (measure with Lighthouse budgets).
2. PWA offline read-only for rosters/timetables; graceful reconnect.
3. First-run guided tour per module + an in-app "?" help panel per screen.
4. Feedback widget (one tap: "this screen is confusing") feeding a triage
   list — the permanent replacement for this plan's assumptions.
5. Pilot → train → rollout per wave: front office first, then teachers,
   then accounts/trust.

---

## 4. Sequencing at a glance

```
Week:      1  2  3  4  5  6  7  8  9  10 11 12 13 14 15 16 17 18
Phase 0    ██
Phase 1    ██ ██ ██ ██
Phase 2          ██ ██ ██ ██
Phase 3                ██ ██ ██ ██ ██ ██ ██ ██ ██ ██
Phase 4                         ██ ██ ██ ██ ██ ██ ██ ██
Phase 5                         ██ ██ ██ ██ ██ ██ ██ ██
Phase 6                                              ██ ██ ██ ██
```

Assumes one focused developer plus AI-assisted implementation; waves are
parallelizable if more hands join. Treat durations as ±50% until Wave 1
calibrates them.

---

## 5. Rules that keep this from failing

1. **One module at a time, shipped.** No big-bang branch. Every wave-PR
   passes `npm run verify`, gets screenshots, and gets a real user's
   sign-off before the next starts.
2. **Data layer before paint.** Phase 1 gates Phase 3. The only exception is
   the Phase 2 kit, which can be built against the pilot module.
3. **Delete as you go.** A converted module's old workspace is removed in
   the same PR — no two-UIs limbo.
4. **AI drafts, humans send.** No AI or automation writes to parents or
   records without a human approval step.
5. **Measure the complaint.** Track the three numbers this plan exists to
   fix: sub-12px font occurrences (2,135 → 0), modules on the Shell
   (0 → 29), silent failure paths (each one found gets a toast + a test).

---

## 6. Decisions — taken by the director, 2026-08-10

| # | Question | Decision |
|---|---|---|
| 1 | Bilingual UI (Hindi labels)? | **English only** for now; revisit after rollout if staff feedback asks for it |
| 2 | Density default | **Comfortable, 14px body**, with a compact toggle for power users |
| 3 | Wave 1 pilot module | **Fees** |
| 4 | GitHub Actions billing | **Being fixed now** — CI gates every merge for the duration of this project |

These are inputs to Phase 0/2 and are considered settled; changing one later
is fine but re-opens the affected phase's estimate.

## 7. Verification (per phase, not at the end)

- **Phase 1:** two-device convergence test; kill-network test; regression
  selftest added to `verify.sh` proving whole-state push is rejected.
- **Phase 2:** kit gallery page; axe-core a11y scan clean on the pilot;
  zero sub-12px classes in the pilot module.
- **Phase 3:** per module — `npm run verify`, screenshots, user walkthrough,
  old component deleted, KPI numbers cross-checked against a report.
- **Phase 4/5:** every AI/WA action has a dry-run mode used in the demo;
  WA delivery dashboard shows real sent/delivered/read.
- **Phase 6:** Lighthouse budget in CI; pilot-user task timing (e.g. "take a
  fee payment" under 30 seconds from cold open).
