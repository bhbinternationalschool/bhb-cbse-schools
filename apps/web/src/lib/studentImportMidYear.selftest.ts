/**
 * Run: npx tsx src/lib/studentImportMidYear.selftest.ts
 *
 * A child uploaded with "New" who joined after mid-May must be MID_YEAR, or
 * the fees bill them from April. 3 Oct 2026: 8 of the 2026-27 uploads (joined
 * 29 May – 30 Jul) were NEW; the counter waived May/June by hand for some and
 * not for others — ₹8,750 of months before joining still open, and a parent
 * who had paid everything was sent reminder after reminder.
 */
import assert from "node:assert/strict";
import { importStudentType, reconcileContinuingTypes } from "@/lib/studentImport";
import { normalizeStudent } from "@/lib/sis";

const AY = "2026-27";

// the sheet says New; the joining date decides
assert.equal(importStudentType("New", "NEW", "2026-07-07", AY), "MID_YEAR", "Satvik, joined 7 Jul");
assert.equal(importStudentType("", "NEW", "2026-06-30", AY), "MID_YEAR", "blank type, joined 30 Jun");
assert.equal(importStudentType("New", "NEW", "2026-05-15", AY), "NEW", "on the cutoff is still NEW");
assert.equal(importStudentType("New", "NEW", "2026-04-04", AY), "NEW", "April joiner");
assert.equal(importStudentType("New", "NEW", "", AY), "NEW", "no date: unknown is not mid-year");

// an explicit type in the sheet is kept
assert.equal(importStudentType("Promoted", "NEW", "2026-07-07", AY), "PROMOTE");
assert.equal(importStudentType("RTE", "NEW", "2026-07-07", AY), "RTE");
assert.equal(importStudentType("", "PROMOTE", "2026-07-07", AY), "PROMOTE", "continuing child");
assert.equal(importStudentType("Mid year", "NEW", "2026-04-10", AY), "MID_YEAR");

// the session reconcile no longer resets a late joiner to NEW
const late = normalizeStudent({
  id: "stu_late",
  admissionNo: "BHB-2026-27-1244",
  fullName: "LATE JOINER",
  academicYearCode: AY,
  studentType: "NEW",
  joinedOn: "2026-07-07",
});
const early = normalizeStudent({
  id: "stu_early",
  admissionNo: "BHB-2026-27-1200",
  fullName: "EARLY JOINER",
  academicYearCode: AY,
  studentType: "MID_YEAR",
  joinedOn: "2026-04-04",
});
const [l, e] = reconcileContinuingTypes([late, early], AY);
assert.equal(l!.studentType, "MID_YEAR");
assert.equal(e!.studentType, "MID_YEAR", "an existing MID_YEAR is left as the office set it");

console.log("OK — studentImportMidYear.selftest.ts");
