# SIS Identity/Enrollment Split — Plan

**Goal:** one permanent record per child, with a separate per-year enrollment
record for class/section/roll number — so fee, attendance and exam history
stay attached to the child across every year they're at the school, instead
of fragmenting every time they're promoted.

**Method:** grounded in a direct database check (2026-08-12), not the code's
stated intent — the code and the database have disagreed before this month.

---

## 1. What's actually true today (measured, not assumed)

```
sis_students:            719 rows
unique admission_no:     273
admission numbers that
  appear more than once: 226
```

Every admission number that repeats appears **exactly once per academic
year the child has been enrolled**, every row marked `status = 'active'`
simultaneously:

```
admission_no BHB-2023-24-1003 → 4 rows, all active
  2023-24  stu_uyy66erc
  2024-25  stu_a9ce228b
  2025-26  stu_u8tm2fq2
  2026-27  stu_aadba0hp
```

There is **no field linking these four rows together** beyond the free-text
`admission_no` string — no stable identity ID, no foreign key between years.
Renaming or reformatting an admission number silently breaks the link.

The code confirms why: `upgradeStudentClass` (`lib/classUpgrade.ts`) mutates
a student's `classId`/`sectionId` **in place** and carries `academicYearCode`
forward unchanged — there is no year-rollover function anywhere in the repo.
These four-row chains were created directly (almost certainly by a seed
script), bypassing the app's own promotion path entirely.

**Why this isn't an active crisis:** fee, attendance and exam tables are
almost empty school-wide —

```
fee_desk_voucher_lines:   1 row
attendance_desk_marks:   43 rows
exam_desk_marks:          0 rows
payment_desk_links:       1 row
```

If those had real volume, a child's fee and attendance history would
already be split across four disconnected rows, invisible to each other.
There's barely any real history yet to fragment — **which is exactly why
now is the cheap time to fix the shape**, before real usage accumulates
into the same trap.

---

## 2. The target shape

Split what's currently one `sis_students` row into two:

| Layer | Cardinality | Holds |
|---|---|---|
| **Identity** | one row per child, forever | name, DOB, admission no., parents/household, Aadhaar, documents, photo |
| **Enrollment** | one row per child per year | class, section, roll no., fee group, student type, status |

Every enrollment row points back to its identity row by a permanent ID.
Promotion becomes: same identity row, **new** enrollment row for the new
year, prior year's enrollment marked closed — not a new copy of the child.

Fee/attendance/exam records key off whichever layer actually matches their
own scope (worked out per table in Phase 4 — attendance is inherently
year-scoped, a fee ledger is not).

---

## 3. Phased plan

Every phase follows the pattern that recovered this month's incidents:
**snapshot before, assert inside the transaction, verify after — and every
migration lands as a numbered file in `supabase/migrations/`, reviewed
before it runs, never as a bare ad-hoc query.** The ad-hoc-migration export
from 2026-08-11 (`supabase/migrations/adhoc-export/`) is the standing
argument for why.

### Phase 0 — Safety net, no schema change

- Snapshot `sis_students` and every table that references it, the same
  `_pre_<name>_<date>` pattern already used twice successfully this month.
- Dry-run (inside a transaction, rolled back) the query that groups rows by
  `admission_no` and checks every group agrees on identity — same name,
  same DOB, same household. Any group that **doesn't** agree gets flagged
  for manual review before Phase 2 touches it — that's the check that
  stops two different children with a typo'd shared admission number from
  being merged into one.
- Fully reversible: nothing written, nothing read differently yet.

### Phase 1 — New tables, additive only

- `sis_student_identities` — permanent fields.
- `sis_enrollments` — per-year fields, `identity_id` FK, plus
  `promoted_from_enrollment_id` (nullable) for an audit trail of promotions.
- Committed as a real migration file, reviewed, applied. `sis_students`
  untouched. Nothing in the app reads the new tables yet.
- Reversible by dropping two empty tables.

### Phase 2 — Backfill

- One `sis_student_identities` row per unique `admission_no` (using the
  most recent year's data). One `sis_enrollments` row per existing
  `sis_students` row, linked to its identity.
- Wrapped in a transaction with the same assert-before-commit discipline
  used for this month's class-ID repairs: row counts must match exactly
  (273 identities, 719 enrollments), zero orphaned `identity_id`s, or it
  rolls back and writes nothing.
- `sis_students` still untouched — this is purely additive, so a mistake
  here can't yet reach anything a screen renders.

### Phase 3 — Read path, behind a flag

- `SIS_IDENTITY_SPLIT` flag, off by default — same rollout pattern as
  admissions Stage 6 and the masters row-table cutover.
- A repo layer composes the existing `SisStudent` shape from identity +
  current-year enrollment when the flag is on, so components don't change
  yet — same shape in, same shape out.
- No staging environment exists (this project has none — everything hits
  live data), so before the flag touches any real screen: a read-only
  diagnostic comparing old-path output against new-path output for every
  student, flagging any mismatch. The flag does not go near a real screen
  until that diff is clean.

### Phase 4 — Write path: promotion stops creating duplicate rows

- Rewrite the promotion flow: new year → new `sis_enrollments` row, prior
  year's enrollment closed (not left `active`). This is the change that
  closes the actual gap — 226 admission numbers with simultaneous active
  rows becomes zero.
- Table-by-table FK decision, made explicit before any table is touched:
  - **Year-scoped** (attendance, exam marks, timetable) → key off
    `enrollment_id`.
  - **Lifetime** (fee ledger, documents, vault) → key off `identity_id`.
  - A view joins enrollment back to identity for anything needing both.

### Phase 5 — Cutover per module, one at a time

- Students module first (the direct consumer), then fees, attendance,
  exams, certificates, promotions — each behind its own flag, each
  verified individually against real data before the next one flips,
  exactly like the admissions Stage 6 sequence.

### Phase 6 — Retire the old shape

- Only after every consumer has been flipped and run through at least one
  full attendance/fee cycle on the new shape does `sis_students` get
  deprecated — turned into a compatibility view or dropped, decided at
  that time, not now.

---

## 4. What this plan does *not* do yet

- No code changes. No migrations applied. No flags created.
- Doesn't touch `sis_students` in Phases 0–3 — every one of those is
  reversible by deleting things that were only ever additive.
- Doesn't decide the per-table FK strategy for Phase 4 in advance — that
  needs a table-by-table pass when we get there, not a guess now.

## 5. Where I'd want your decision before starting

1. **Phase 0's manual-review flag** — if any admission-number group turns
   out to disagree on identity (same number, different child), that needs
   a human call I can't make from the data alone.
2. **Timing** — Phase 0–2 are safe to run any time (additive, reversible).
   Phase 3's real-screen cutover is the one I'd want you actively watching
   for, the same way today's flag flips went.
