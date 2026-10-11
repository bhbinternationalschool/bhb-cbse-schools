/**
 * Custom fields × the student import and the built-in column names
 * (review of PR #547):
 *
 * 1. "More details" columns are written ONLY for lines the import actually
 *    created or updated. With "Update existing" off, a child already in the
 *    session is refused by the import — and its House must not change
 *    either, while the report says "updated 0".
 * 2. A student field may not be named like a column the import already
 *    reads; the server enforces it with the same rule the panel shows.
 */
import assert from "node:assert/strict";
import { defaultMasters } from "@/lib/masters";
import type { SisState } from "@/lib/sis";
import { applyStudentImport, isBuiltInStudentImportHeader, studentImportRawGrid } from "@/lib/studentImport";
import { matchCustomImportHeaders, planCustomImport, validateDefInput, type CustomFieldDef } from "@/lib/customFields";
import { reservedCustomLabel } from "@/lib/customFieldsReserved";

console.log("customFieldsImport.selftest.ts");

const masters = defaultMasters();
const cls = masters.classes.find((c) => c.isActive)!.name;
const empty = { version: 1, households: [], students: [], curriculumRequests: [], tags: [], classUpgrades: [] } as unknown as SisState;
const opts = (upsert: boolean) => ({
  targetSession: "2026-27",
  placement: "place_in_target" as const,
  sourceSessionFilter: "",
  defaultStudentType: "NEW" as const,
  upsert,
  autoAssignNumbers: false,
  mapLegacyErpAdmission: false,
});

const house: CustomFieldDef = {
  id: "house", entityType: "student", labelEn: "House", labelHi: "सदन", fieldType: "choice",
  options: ["Red", "Blue"], requiredOnNew: false, active: true, sortOrder: 0, updatedAt: "", valueCount: 0,
};

// First import: one child lands.
const first = applyStudentImport(
  `Admission no,Student name,Class,Section,Guardian mobile,House\nA-1,Riya Singh,${cls},A,9876543210,Red\n`,
  empty, masters, opts(true),
);
assert.equal(first.created, 1);
const riyaId = first.writtenLineIds[2];
assert.ok(riyaId && first.state.students.some((s) => s.id === riyaId), "line 2 → the row it created");

// Second file, "Update existing" OFF: Riya is refused; a new child lands;
// a line with an unknown class and one with no admission number are refused.
const csv2 =
  "Admission no,Student name,Class,Section,Guardian mobile,House\n" +
  `A-1,Riya Singh,${cls},A,9876543210,Blue\n` +
  `A-2,Aman Patel,${cls},A,9876500000,Blue\n` +
  "A-3,Nobody Class,Class Ninety,Z,9876511111,Red\n" +
  `,No Number,${cls},A,9876522222,Red\n`;
const second = applyStudentImport(csv2, first.state, masters, opts(false));
assert.equal(second.updated, 0, "upsert off: the existing child is not updated");
assert.equal(second.created, 1);
assert.deepEqual(Object.keys(second.writtenLineIds), ["3"], "only the line the import wrote");

const grid = studentImportRawGrid(csv2)!;
const match = matchCustomImportHeaders(grid.headers, [house], isBuiltInStudentImportHeader);
assert.deepEqual(match.columns.map((c) => c.def.id), ["house"]);
const lines = grid.lines
  .filter((l) => second.writtenLineIds[l.lineNo])
  .map((l) => ({
    lineNo: l.lineNo,
    entityId: second.writtenLineIds[l.lineNo]!,
    cells: match.columns.map((c) => ({ def: c.def, raw: l.cells[c.index] ?? "" })),
  }));
const plan = planCustomImport(lines, new Map([[`${riyaId}|house`, { value: "Red", updatedAt: "T1" }]]));
assert.equal(plan.changes.length, 1);
assert.notEqual(plan.changes[0]!.entityId, riyaId, "Riya's House is NOT overwritten by a refused line");
assert.equal(plan.changes[0]!.value, "Blue");

// With "Update existing" ON the same line does update Riya — and only then.
const third = applyStudentImport(csv2, first.state, masters, opts(true));
assert.equal(third.writtenLineIds[2], riyaId, "updated in place keeps the row id");

// ── Reserved names (the server passes the same rule) ──
const reserved = reservedCustomLabel("student")!;
for (const label of ["Admission no", "Student name", "Class", "Guardian mobile"]) {
  const v = validateDefInput({ entityType: "student", labelEn: label, fieldType: "text" }, [], null, reserved);
  assert.ok(!v.ok && /built-in column/.test(v.error), `"${label}" is refused`);
}
const hiClash = validateDefInput({ entityType: "student", labelEn: "Locker", labelHi: "Admission no", fieldType: "text" }, [], null, reserved);
assert.ok(!hiClash.ok, "a Hindi name cannot take a built-in column either");
assert.ok(validateDefInput({ entityType: "student", labelEn: "House", fieldType: "text" }, [], null, reserved).ok);
assert.equal(reservedCustomLabel("staff"), undefined, "staff have no import, so no reserved names");

console.log("customFieldsImport.selftest.ts: all assertions passed");
