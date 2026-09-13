/**
 * Self-test: the two helpers that keep a child off a list twice.
 * Run: npx tsx apps/web/src/lib/sessionScopedStudents.selftest.ts
 *
 * SIS keeps ONE ROW PER CHILD PER ACADEMIC YEAR and leaves every one of them
 * `status: "active"`. On production that is 681 rows for 239 children, 83% of
 * children carrying two to four. The expression
 *
 *     students.filter((s) => s.status === "active")
 *
 * was copied into roughly thirty screens and server paths. It put a child on
 * a picker three times, told a parent their one child three times, greeted
 * children who had left, tripled a statutory RTE count and summed three
 * years of dues into one calendar figure.
 *
 * `studentsInSession` and `childrenOfHousehold` are the two replacements.
 * These are the rules they must keep.
 */

import assert from "node:assert/strict";

import {
  childrenOfHousehold,
  studentsInSession,
  type SisState,
  type SisStudent,
} from "./sis";

console.log("sessionScopedStudents.selftest.ts");

const kid = (
  id: string,
  fullName: string,
  admissionNo: string,
  academicYearCode: string,
  householdId = "hh1",
  status = "active",
): SisStudent =>
  ({
    id,
    fullName,
    admissionNo,
    academicYearCode,
    householdId,
    status,
  }) as unknown as SisStudent;

// One promoted child with three rows, one sibling, and one who has left.
const state = {
  students: [
    kid("r1", "Ishaan Rao", "BHB-1001", "2023-24"),
    kid("r2", "Ishaan Rao", "BHB-1001", "2024-25"),
    kid("r3", "Ishaan Rao", "BHB-1001", "2026-27"),
    kid("s1", "Meera Rao", "BHB-1002", "2026-27"),
    kid("g1", "Gone Away", "BHB-1003", "2024-25", "hh2"),
  ],
  households: [],
} as unknown as SisState;

/* ── studentsInSession ──────────────────────────────────────── */

const now = studentsInSession(state, "2026-27");
assert.deepEqual(
  now.map((s) => s.fullName).sort(),
  ["Ishaan Rao", "Meera Rao"],
  "the promoted child once, the sibling once, the leaver not at all",
);
// And it is the CURRENT row that survives, not an older one.
assert.equal(now.find((s) => s.fullName === "Ishaan Rao")?.id, "r3");

// Unscoped still collapses per child — forgetting the session makes a list
// slightly too long, never one that repeats a name.
const all = studentsInSession(state);
assert.equal(all.length, 3, "three children, five rows");
assert.equal(
  all.find((s) => s.fullName === "Ishaan Rao")?.academicYearCode,
  "2026-27",
  "the newest row is the one kept",
);

// "all" is the deliberate escape hatch for a cross-session report.
assert.equal(studentsInSession(state, "all").length, 3);

// Inactive rows are never listed.
const withInactive = {
  students: [...state.students, kid("x1", "Struck Off", "BHB-1009", "2026-27", "hh3", "inactive")],
} as unknown as SisState;
assert.equal(
  studentsInSession(withInactive, "2026-27").some((s) => s.fullName === "Struck Off"),
  false,
);

/* ── a row with no academic year is KEPT ────────────────────── */

// It is an old record, not a wrong one. Dropping it would hide a real child
// from the screens that exist to find children nobody can reach.
const undated = {
  students: [kid("u1", "Undated Child", "BHB-2001", "", "hh4")],
} as unknown as SisState;
assert.deepEqual(
  studentsInSession(undated, "2026-27").map((s) => s.fullName),
  ["Undated Child"],
);

/* ── identity is the admission number AND the name ──────────── */

// An admission number typed twice is an ordinary office error. Merging on the
// number alone would HIDE one of these children; listing both is visible and
// therefore fixable.
const clash = {
  students: [
    kid("c1", "First Child", "DUP-1", "2026-27", "hh5"),
    kid("c2", "Second Child", "DUP-1", "2026-27", "hh5"),
  ],
} as unknown as SisState;
assert.equal(
  studentsInSession(clash, "2026-27").length,
  2,
  "two different children are never merged by a shared admission number",
);

// A row with no admission number falls back to household + name, so it cannot
// collide with another family's child of the same name.
const noAdm = {
  students: [
    kid("n1", "Same Name", "", "2026-27", "hhA"),
    kid("n2", "Same Name", "", "2026-27", "hhB"),
  ],
} as unknown as SisState;
assert.equal(studentsInSession(noAdm, "2026-27").length, 2);

/* ── childrenOfHousehold ────────────────────────────────────── */

const mine = childrenOfHousehold(state, "hh1", "2026-27");
assert.deepEqual(
  mine.map((s) => s.fullName).sort(),
  ["Ishaan Rao", "Meera Rao"],
  "a parent sees each of their children once",
);
assert.equal(
  childrenOfHousehold(state, "hh2", "2026-27").length,
  0,
  "a household whose child has left has no children this session",
);
assert.equal(childrenOfHousehold(state, "hh2", "2024-25").length, 1);

// Siblings are two children, not a duplicate.
assert.equal(new Set(mine.map((s) => s.admissionNo)).size, 2);

/* ── nothing blows up on nothing ────────────────────────────── */

assert.deepEqual(studentsInSession(null, "2026-27"), []);
assert.deepEqual(studentsInSession(undefined), []);
assert.deepEqual(childrenOfHousehold(null, "hh1", "2026-27"), []);
assert.deepEqual(childrenOfHousehold(state, "", "2026-27"), []);
assert.deepEqual(
  studentsInSession({ students: [] } as unknown as SisState, "2026-27"),
  [],
);

/* ── the production shape, in miniature ─────────────────────── */

// 83% of children carrying 2-4 rows: whatever the mix, the count out is the
// number of children, never the number of rows.
const many = {
  students: Array.from({ length: 40 }, (_, i) =>
    ["2023-24", "2024-25", "2025-26", "2026-27"].map((ay, j) =>
      kid(`m${i}_${j}`, `Child ${i}`, `ADM-${i}`, ay, `hh${i}`),
    ),
  ).flat(),
} as unknown as SisState;
assert.equal(many.students.length, 160);
assert.equal(studentsInSession(many, "2026-27").length, 40);
assert.equal(studentsInSession(many).length, 40);

console.log("  ok");
