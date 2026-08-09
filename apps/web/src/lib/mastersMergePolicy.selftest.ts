/**
 * The server used to read masters from the school_mirror_state blob
 * unconditionally, ignoring MASTERS_READ_FROM_DB. Because masters were
 * re-seeded into the desk tables with fresh ids, that left every
 * server-side class/section/campus/fee-group lookup — the WhatsApp bot,
 * class-channel sync — resolving against ids that no longer existed,
 * while the browser used the live ones.
 *
 * The fix takes desk masters instead. This pins the two properties that
 * make that safe:
 *
 *   1. Desk wins for the slices it has, so ids are the live ones.
 *   2. Desk does NOT carry staff / students / departments / designations,
 *      so those slices must survive the merge. A wholesale replace would
 *      silently empty the staff roster.
 *
 * Run: npx tsx src/lib/mastersMergePolicy.selftest.ts
 */
import assert from "node:assert/strict";
import type { MastersState } from "@/lib/masters";
import { mergeDeskMastersOverBlob } from "@/lib/mastersMergePolicy";

console.log("mastersMergePolicy.selftest.ts");

const blob = {
  version: 1,
  classes: [{ id: "cls_old", name: "Nursery" }],
  sections: [{ id: "sec_old", name: "A", classId: "cls_old" }],
  campuses: [{ id: "cam_old", name: "Main Campus" }],
  staff: [{ id: "stf_1", name: "Asha" }],
  students: [{ id: "stu_1" }],
  departments: [{ id: "dep_1" }],
  designations: [{ id: "dsg_1" }],
  schoolProfile: { name: "BHB" },
} as unknown as MastersState;

const desk = {
  version: 2,
  classes: [{ id: "cls_new", name: "Nursery" }],
  sections: [{ id: "sec_new", name: "A", classId: "cls_new" }],
  campuses: [{ id: "cam_new", name: "Main Campus" }],
  staff: [],
  students: [],
  departments: [],
  designations: [],
  schoolProfile: { name: "BHB International" },
} as unknown as MastersState;

const merged = mergeDeskMastersOverBlob(blob, desk);

// 1. Live ids win — this is the whole point of the fix.
assert.equal(merged.classes[0].id, "cls_new", "desk class id must win");
assert.equal(merged.sections[0].id, "sec_new", "desk section id must win");
assert.equal(merged.campuses[0].id, "cam_new", "desk campus id must win");
assert.equal(
  (merged.schoolProfile as unknown as { name: string }).name,
  "BHB International",
  "desk object slices must win too",
);
assert.equal(merged.version, 2, "version follows the desk copy");

// 2. Slices the desk does not carry must not be wiped.
assert.equal(merged.staff.length, 1, "staff must survive an empty desk slice");
assert.equal(merged.students.length, 1, "students must survive");
assert.equal(merged.departments.length, 1, "departments must survive");
assert.equal(merged.designations.length, 1, "designations must survive");

// 3. No blob at all: desk stands on its own rather than throwing.
assert.equal(mergeDeskMastersOverBlob(null, desk).classes[0].id, "cls_new");

// 4. Idempotent — merging the result again changes nothing.
const twice = mergeDeskMastersOverBlob(merged, desk);
assert.deepEqual(twice, merged, "merge must be idempotent");

console.log("  ok — desk ids win, staff/students/departments preserved");
