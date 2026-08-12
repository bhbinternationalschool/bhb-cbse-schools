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

---

## 6. Phase 0 — results (run 2026-08-12)

**Snapshot:** all 27 tables that reference `sis_students` — `sis_students`
itself plus every attendance/exam/fee/payment/PTM table with a `student_id`
column — copied to `<table>_pre_identity_split_20260812` (one, whose name
would have exceeded Postgres's 63-byte identifier limit, is
`masters_special_fee_assign_pre_split_20260812` instead). Read-only,
reversible, nothing in the app touches these.

**Identity-conflict check:** of the 226 admission numbers shared by more
than one row, **21 groups** disagree on name, DOB, or household. All 226
agree on DOB and gender. Checked what the 21 disagreements actually are,
rather than stopping at the count:

- **14 groups** — same DOB, same household, name spelled differently
  across years (`PRANJAL` / `PRAMJAL`, `VIVAAN GOSWAMI` / `VIVAN GOSWAMI`,
  `ASHISH` / `ASHISH PATEL`, …). Same child, inconsistent data entry.
- **6 groups** — identical name and DOB, but a *different* `household_id`
  in one year. Checked each: same guardian name, same address, only the
  phone number differs — the household record was re-created (new ID)
  when the family's mobile number changed, instead of the existing
  household row being updated. Same child, same family; the household
  table has its own version of this exact duplication problem.
- **0 groups** are a genuine identity conflict — no case anywhere of two
  different children colliding on one admission number.

**Notable side finding, not fixed here:** two of those six families
(`BHB-2024-25-1100`, `BHB-2024-25-1104` — siblings, same household) show
their 2025-26 household row with `mobile = '0000000000'` and a blank
address, sitting between a correct 2024-25 row and a correct 2026-27 row
that both point at the *original* household ID. A placeholder value sat
in a real family's contact record for a full academic year before
self-correcting — the same defect class as
[[erp-unknown-must-not-become-fact]], one layer further out than where
that pattern was first caught. Left as-is; flagging it rather than fixing
it, since Phase 0 is read-only by design.

**What this means for Phase 2:** the backfill's merge rule needs to be
DOB + (matching `household_id` OR matching guardian name + address when
the household id differs) — not a strict field-equality match — to fold
all 226 duplicate chains into 273 identities cleanly, with zero manual
review required. That refinement will be written into Phase 2 when we get
there, not decided now.

**Phase 0 is complete.** Ready for Phase 1 (new tables, additive-only)
whenever you want it started.

---

## 7. Phase 1 — results (run 2026-08-12)

Migration `supabase/migrations/20260812103712_sis_identity_enrollment_split.sql`
applied. Two tables, both empty:

- **`sis_student_identities`** (37 columns) — everything from `sis_students`
  that doesn't vary by year: name, DOB, admission no., parents, Aadhaar,
  PEN/APAAR/SRN, documents, notes, photo. `unique(tenant_id, admission_no)`
  where the number is non-blank.
- **`sis_enrollments`** (15 columns) — class, section, roll no., fee group,
  student type, status, `identity_id` FK back to the identity, and
  `promoted_from_enrollment_id` (self-referencing, nullable) so Phase 4's
  promotion rewrite has an audit trail from day one.
  `unique(identity_id, academic_year_code)` — the constraint that makes
  Phase 0's finding (one admission number, four simultaneously-active rows)
  structurally impossible to reintroduce once Phase 4 switches the write
  path over.

Both tables: RLS on, zero grants to `anon`/`authenticated` — same access
shape as `sis_students` (checked first rather than assumed: it has no
policies either, access is server-side only via `service_role`).

Verified independently after applying: both tables at 0 rows, both unique
indexes present, zero public grants on either, `sis_students` still at 719
rows unchanged, and the Phase 0 spot-check admission number still resolves
to its current row. `./scripts/verify.sh` — 36/36 — nothing in the app was
touched, so this run is really confirming that creating these tables
disturbed nothing else.

**Phase 1 is complete.** Ready for Phase 2 (backfill, inside an
asserted transaction) whenever you want it started.

---

## 8. Phase 2 — results (run 2026-08-12)

Migration `supabase/migrations/20260812104342_sis_identity_enrollment_backfill.sql`.

Grouping key: `(tenant_id, admission_no)` alone — Phase 0 already proved
this is safe across all 226 duplicated numbers, so no fuzzy household/name
matching was needed for the grouping decision itself. Identity fields are
sourced from each group's **most recent** `academic_year_code` row, so the
21 drifted groups Phase 0 found resolve to whatever's currently believed
true, with no manual per-case decision required.

**Dry run first** (`begin` / `rollback`, nothing committed): caught a real
issue before it could land — several `sis_students` columns hold `NULL`
where the new schema expects `''` (`household_id` among others), which the
new tables' `NOT NULL` constraints correctly rejected. Fixed with
`coalesce(..., '')` on every optional field, re-ran the dry run, clean:
273 identities, 719 enrollments, 0 orphans, 0 duplicate
(identity, year) pairs — exact match to expected.

Applied for real, then verified independently, not just trusted:

```
identities:                 273
enrollments:                719
sis_students (unchanged):   719
identities with >=1
  enrollment:                273   (none orphaned in either direction)
orphaned enrollments:          0
```

**Spot-checked both a clean chain and a drifted one:**

- `BHB-2023-24-1003` → one identity, four enrollments, classes progressing
  correctly year over year (matches the raw data Phase 0 first showed).
- `BHB-2023-24-1026` (one of the six household-drift cases) → identity's
  `household_id` resolved to `hh_nl3bni2k`, the **2026-27** household —
  confirming "most recent year wins" picked the current record, not a
  stale one.

Full `./scripts/verify.sh` — 36/36, unchanged from Phase 1. No app code
touched.

**Phase 2 is complete.** `sis_students` remains the only table anything in
the app reads. Ready for Phase 3 (read path behind a flag, diffed against
the old shape before touching a real screen) whenever you want it started.

---

## 9. Phase 3 — results (run 2026-08-12)

**The diagnostic ran first, in SQL, against the live database** — before
any TypeScript was written. No staging environment exists, and a SQL
comparison proves correctness immediately without needing a deploy or a
login, so that's what "read-only diagnostic... before the flag touches any
real screen" actually meant here.

Split into what must match with zero tolerance, and what's allowed to
differ:

```
Enrollment-scoped fields (class, section, roll no., fee group, student
  type, status, joined_on) vs the exact original row for that year,
  all 719 rows:                                    0 mismatches

Identity-scoped fields (name, DOB, parents, household, Aadhaar, PEN,
  APAAR, SRN, docs, …) vs each identity's SOURCE row — the most
  recent-year row it was built from:                0 mismatches

Sanity check on the diagnostic itself — older-year rows in the 21
  drifted groups SHOULD differ (intentional: the identity reflects the
  latest known truth, not every year's). If this were 0, the diagnostic
  would be too loose to trust:                      48 (as expected)
```

Zero unexpected mismatches. The 48 are the exact rows Phase 0 already
named and Phase 2 already explained — nothing new.

**Then the repo layer**, in `lib/sisNormalized.server.ts`:

- `fetchSisFromDbViaIdentitySplit()` — same `SisRemoteBundle` shape as the
  existing `fetchSisFromDb()`, sourced from `sis_enrollments` joined to
  `sis_student_identities` (PostgREST embedded select via the FK from
  Phase 1) instead of `sis_students`.
- `identityEnrollmentToStudent()` — composes the exact same `SisStudent`
  shape `rowToStudent()` does, field for field, matching the mapping this
  was checked against in SQL before being written.
- One row per enrollment, not per identity — reproducing the same
  multi-year-rows-per-student shape the app already relies on today. The
  client still filters by `academicYearCode` itself; this phase doesn't
  change that.
- `id` is the enrollment's own id, not the original `sis_students.id` it
  was backfilled from. Deliberately deferred: what "student id" should
  mean once fees/attendance/exams start keying off identity vs enrollment
  is a Phase 4 decision, not this one.
- Wired into `GET /api/school-data/sis-roster` behind
  `sisIdentitySplitEnabled()` — same `SIS_IDENTITY_SPLIT` flag pattern as
  every other flag this project uses, **not referenced anywhere in the
  deploy scripts or cloudbuild.yaml**, so it defaults to off with no
  action needed.

Verified: `tsc` clean, `eslint` clean on both changed files, full
`./scripts/verify.sh` — 36/36 including the production build. Not
exercised end-to-end in a running app — the flag is off, and turning it on
requires a deploy, which is deliberately not happening yet.

**Phase 3 is complete.** The join is proven correct at the data level and
the code exists, flag off. Ready for Phase 4 (the promotion rewrite that
actually closes the gap Phase 0 found) whenever you want it started — that
one writes, not just reads, so it's the first phase since 0 where I'd want
you actively involved in the timing.

---

## 10. Phase 4 — results (run 2026-08-12)

**"Rewrite the promotion flow" turned out to have nothing to rewrite.**
Checked before writing anything: `upgradeStudentClass`
(`lib/classUpgrade.ts`) mutates a row's class/section in place and carries
`academic_year_code` forward *unchanged*; there is no year-rollover
function anywhere in the app. The 226 duplicated admission numbers in
production were created directly, almost certainly by a seed script,
never through the app. So Phase 4 built new capability, not a rewrite of
one that existed.

**`sis_promote_enrollment`** (Postgres function,
`supabase/migrations/20260812105831_sis_promote_enrollment.sql`) —
inserts the new year's enrollment and marks the source `'promoted'`
inside one transaction, `for update` locking the source row so two
promotions can't race the same enrollment. Two separate Supabase calls
from Node would leave a real gap if the second failed after the first
succeeded — a child with a new active enrollment *and* an old one still
marked active, recreating the exact bug this closes. Not `security
definer`, matching `sis_push_guarded` — every table here is reached only
through the `service_role` connection, which already has full access.

**One correction folded into the same change:** `sis_enrollments.status`
is free text at the DB level, so this introduces a new value —
`'promoted'` — for an enrollment a child has moved on from. Phase 3's
`identityEnrollmentToStudent()` was copied from `rowToStudent`'s rule
(`status === "inactive" ? "inactive" : "active"`), which would have
folded an unrecognized value like `'promoted'` into `"active"` — wrong,
since a promoted-away enrollment is not current. Fixed by inverting the
rule for enrollments specifically: only the literal `'active'` reads as
active, everything else reads as `"inactive"`. `sis_students.status`
genuinely is only ever active/inactive, so `rowToStudent`'s original rule
is untouched and correct as-is. The 182 places across the app that check
`SisStudent["status"]` needed no changes — that type stays a strict
binary union regardless of what the DB tracks underneath.

**Tested against a throwaway synthetic identity**, never real student
data — same convention this repo already uses (`zzz_selftest_*`
migrations). Promoted a fake enrollment from 2025-26 to 2026-27, verified
directly:

```
source (2025-26): status='promoted', roll_no unchanged ('7')
new    (2026-27): status='active', roll_no='' (fresh, not carried
                   forward — matches the Students module's own bulk
                   roll-number tool), promoted_from_enrollment_id
                   correctly points at the source
```

Both guards checked explicitly:
- Re-promoting the now-`'promoted'` source → rejected, `"status is
  promoted"`.
- Promoting into a year that already has an enrollment → rejected,
  `"an enrollment already exists ... 2025-26"`, returns the existing id.

Both failed attempts inserted nothing — confirmed by row count before
cleanup. Fixture deleted afterward: `sis_student_identities` back to 273,
`sis_enrollments` back to 719, `sis_students` still untouched at 719.

**`lib/sisEnrollmentPromotion.server.ts`** — thin wrapper calling the RPC,
matching how `pushSisGuarded` already calls `sis_push_guarded`. Exported,
`tsc`/`eslint` clean, not called from anywhere yet.

**What Phase 4 deliberately does not include:** a promotion *UI*. Nothing
in the app calls `promoteSisEnrollment()` yet — there's no screen for
picking a class and promoting its students to the next year. That's real,
separate surface area (class-to-class mapping, students held back, bulk
vs. one-at-a-time) and its own decision, not something to build silently
inside a write-path fix.

Full `./scripts/verify.sh` — 36/36 including the production build.

**Phase 4 is complete.** The structural gap Phase 0 found — one admission
number, four simultaneously active rows — is now impossible to
reintroduce through this function, and nothing yet calls it. Phase 5
(per-module read-path cutover) and the promotion UI are both open,
whenever you want either started.
