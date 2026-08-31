import assert from "node:assert/strict";
import { computeHouseholdDues, emptyFeesState } from "./fees";
import {
  emptySisState,
  type SisState,
  type SisStudent,
  type Household,
} from "./sis";
import { emptyMastersShell, type MastersState } from "./masters";

console.log("householdDuesAcademicYear.selftest.ts");

/**
 * SIS keeps ONE student row per academic year, every one of them still
 * `status: "active"` — on production 679 active rows were only ~236 real
 * children, and 157 of 189 households spanned more than one year.
 *
 * `computeHouseholdDues` returns every row it finds, so anything that sums
 * the bundle was adding last year's child to this year's child. The receipt's
 * "pay remaining dues" QR asked a family for 62,050 when they owed 10,500.
 */

const CURRENT = "2026-27";
const PRIOR = "2025-26";

const student = (p: Partial<SisStudent>): SisStudent =>
  ({
    id: "",
    fullName: "",
    admissionNo: "",
    householdId: "hh1",
    classId: "c4",
    sectionId: "s4a",
    status: "active",
    academicYearCode: CURRENT,
    studentType: "promoted",
    fatherName: "",
    motherName: "",
    fatherMobile: "",
    motherMobile: "",
    feeGroupId: "fg1",
    ...p,
  }) as unknown as SisStudent;

const sis: SisState = {
  ...emptySisState(),
  students: [
    // The same two children, once per year they have attended.
    student({ id: "kunal26", fullName: "Kunal", admissionNo: "ADM-1", academicYearCode: CURRENT }),
    student({ id: "kunal25", fullName: "Kunal", admissionNo: "ADM-1", academicYearCode: PRIOR }),
    student({ id: "ayush26", fullName: "Ayush", admissionNo: "ADM-2", academicYearCode: CURRENT }),
    student({ id: "ayush25", fullName: "Ayush", admissionNo: "ADM-2", academicYearCode: PRIOR }),
  ],
  households: [
    { id: "hh1", guardianName: "Manoj", mobile: "9990001111" } as unknown as Household,
  ],
};

const masters: MastersState = {
  ...emptyMastersShell(),
  classes: [{ id: "c4", name: "Class 4", isActive: true }],
  sections: [{ id: "s4a", classId: "c4", name: "A", isActive: true }],
  feeGroups: [{ id: "fg1", name: "General" }],
  academicYears: [
    { code: CURRENT, isCurrent: true },
    { code: PRIOR, isCurrent: false },
  ],
} as unknown as MastersState;

const fees = emptyFeesState();

const names = (rows: { student: SisStudent }[]) =>
  rows.map((r) => r.student.id).sort();

// Unscoped is unchanged — pay links, parent checkout and the per-student
// ledger resolve specific dueKeys and must keep seeing every record.
assert.deepEqual(
  names(computeHouseholdDues("hh1", sis, masters, fees)),
  ["ayush25", "ayush26", "kunal25", "kunal26"],
  "without a scope every academic year's row is still returned",
);

// Scoped collapses to one row per child — the fix.
assert.deepEqual(
  names(computeHouseholdDues("hh1", sis, masters, fees, {
    academicYearCode: CURRENT,
  })),
  ["ayush26", "kunal26"],
  "scoped to the running session, each child appears exactly once",
);

// Codes written "2026-2027" must scope the same as "2026-27".
assert.deepEqual(
  names(computeHouseholdDues("hh1", sis, masters, fees, {
    academicYearCode: "2026-2027",
  })),
  ["ayush26", "kunal26"],
  "the long-form academic year code normalises to the same scope",
);

// A family with no row in the requested year must not silently read zero —
// it falls back to every record rather than reporting nothing owed.
assert.deepEqual(
  names(computeHouseholdDues("hh1", sis, masters, fees, {
    academicYearCode: "2099-00",
  })),
  ["ayush25", "ayush26", "kunal25", "kunal26"],
  "an unmatched scope falls back instead of reporting an empty household",
);

console.log(
  "  ok — household dues scope to one student row per child per session",
);
