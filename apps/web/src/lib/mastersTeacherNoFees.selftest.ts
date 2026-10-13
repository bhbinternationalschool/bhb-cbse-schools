/**
 * A teacher's Masters has no fee structure — and must keep everything else.
 *
 * The server sends a teacher a reduced Masters (masters-desk teachingOnly,
 * PR #336): classes, sections, subjects, holidays, timing, staff — no fee
 * groups or fee structure lines. Until 13 Oct 2026 ensureFeeSetupInner()
 * treated "no fee structure" as "unset up" and replaced the whole copy with
 * defaultMasters(), keeping only campuses/classes/sections/fee heads. Every
 * loadMasters() for a teacher therefore returned staff: [] and students: [],
 * demo departments/holidays/timing — and /students crashed (React #185) as
 * syncSisIntoMasters re-wrote the student projection on every read.
 *
 * Found by the data-layer Playwright gate (step 1.1) on the seeded school,
 * whose Masters, like a teacher's, carries no fee structure.
 *
 * Needs Supabase env (a real tenant); the npm script supplies placeholders.
 * Run: npm run test:masters-teacher-no-fees
 */
import assert from "node:assert/strict";

import { buildFixture } from "../../e2e/fixture";
import { loadMasters, type MastersState } from "./masters";
import { setMirrorSlice } from "./schoolDataMirror";
import { isSupabaseConfigured } from "./supabase/client";

if (!isSupabaseConfigured()) {
  console.error("mastersTeacherNoFees.selftest: needs Supabase env — run `npm run test:masters-teacher-no-fees`.");
  process.exit(1);
}

const fx = buildFixture();
const studentsProjection = [
  { id: "proj_1", name: "Test Child One", classId: fx.masters.classes[0]!.id, sectionId: fx.masters.sections[0]!.id },
  { id: "proj_2", name: "Test Child Two", classId: fx.masters.classes[1]!.id, sectionId: fx.masters.sections[1]!.id },
] as unknown as MastersState["students"];

// The teacher's copy: the fixture school's Masters with its staff roster, a
// student projection and two real holidays — and no fee structure.
const holidays = [
  { id: "hol_t1", date: "2026-10-20", name: "Holiday One" },
  { id: "hol_t2", date: "2026-11-01", name: "Holiday Two" },
] as unknown as MastersState["holidays"];
const teacherCopy: MastersState = {
  ...fx.masters,
  staff: fx.staff.staff,
  departments: fx.staff.departments,
  designations: fx.staff.designations,
  students: studentsProjection,
  holidays,
  feeGroups: [],
  feeStructureLines: [],
};
assert.equal(teacherCopy.feeGroups.length, 0, "precondition: no fee groups");
assert.ok(teacherCopy.staff.length > 0, "precondition: the copy holds staff");

setMirrorSlice("masters", teacherCopy);
const read = loadMasters();

assert.equal(read.staff.length, teacherCopy.staff.length, `staff survive a read: ${read.staff.length} of ${teacherCopy.staff.length}`);
assert.equal(read.students.length, studentsProjection.length, `the student projection survives a read: ${read.students.length}`);
assert.deepEqual(
  read.departments.map((d) => d.id).sort(),
  teacherCopy.departments.map((d) => d.id).sort(),
  "departments are the school's, not the demo set",
);
assert.deepEqual(
  read.holidays.map((h) => h.id).sort(),
  ["hol_t1", "hol_t2"],
  "holidays are the school's two, not demo holidays",
);
assert.deepEqual(
  read.classes.map((c) => c.id).sort(),
  teacherCopy.classes.map((c) => c.id).sort(),
  "class ids unchanged",
);
assert.equal(read.feeGroups.length, 0, "no demo fee groups invented on a real tenant");
assert.equal(read.feeStructureLines.length, 0, "no demo fee structure invented on a real tenant");

// A second read is identical — nothing for syncSisIntoMasters to keep re-writing.
const again = loadMasters();
assert.equal(again.staff.length, read.staff.length, "stable across reads");
assert.equal(again.students.length, read.students.length, "stable across reads");

console.log("mastersTeacherNoFees.selftest: ok");
