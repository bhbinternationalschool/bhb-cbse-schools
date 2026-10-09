/**
 * An attendance push must never delete a register it does not name.
 *
 * On 2026-08-11 the database held exactly one attendance register: today's.
 * The register for 2026-08-10, marked the day before, was gone. Nobody
 * deleted it: pushAttendanceRegistersToDb called deleteStale with the ids the
 * client happened to be holding, and a phone whose cache was dropped on quota
 * pushed one register. The fix then scoped the prune to the dates a payload
 * covered — which still erased teachers' registers for TODAY, saved from the
 * app or by a leave approval after the office tab last read.
 *
 * The rule now: a push is not a statement about which registers exist on any
 * date. A register leaves only when the user deleted it and the push names
 * it. And when the stored register for a section and date has a different id
 * (the unique key allows one), the stored one stands and the stale copy is
 * skipped — the old prune settled that collision by deleting the teacher's.
 *
 * Run: npx tsx src/lib/attendancePrune.selftest.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(__dirname, "attendanceNormalized.server.ts"), "utf8");
const push = src.slice(
  src.indexOf("export async function pushAttendanceRegistersToDb"),
  src.indexOf("export async function fetchAttendanceRegistersFromDb"),
);
assert.ok(push.length > 500, "found the register push");

// ── No prune by absence, not even within covered dates ────────────────────
assert.equal(/deleteStale/.test(src), false, "no prune-by-absence helper");
assert.equal(
  /from\("attendance_desk_registers"\)\s*\.delete\(/.test(push),
  false,
  "registers are never deleted directly by a push",
);
assert.equal(/coveredDates/.test(push), false, "no date-scoped prune");
assert.ok(
  /deleteNamedIds\(sb, tenantId, "attendance_desk_registers", \[\.\.\.gone\]\)/.test(push),
  "a register goes only by named id",
);

// ── Marks: written first, removed only under registers that carried marks ─
assert.equal(/from\("attendance_desk_marks"\)\s*\.delete\(/.test(push), false, "no delete-then-insert of marks");
assert.ok(/deleteChildrenNotKept\(\s*sb,\s*tenantId,\s*"attendance_desk_marks",\s*"register_id"/.test(push));
assert.ok(push.indexOf('.from("attendance_desk_marks")\n      .upsert') < push.indexOf("deleteChildrenNotKept("), "marks upserted before any removal");

// ── The collision rule, as the push applies it ────────────────────────────
type Reg = { id: string; sectionId: string; academicYearCode: string; date: string };
function written(payload: Reg[], stored: Reg[]): string[] {
  const key = (r: Reg) => `${r.sectionId}|${r.academicYearCode}|${r.date}`;
  const bySlot = new Map(stored.map((r) => [key(r), r.id]));
  return payload.filter((r) => !bySlot.has(key(r)) || bySlot.get(key(r)) === r.id).map((r) => r.id);
}
{
  const teacher: Reg = { id: "ar_teacher", sectionId: "s1", academicYearCode: "2026-27", date: "2026-10-09" };
  const office: Reg = { id: "ar_office", sectionId: "s1", academicYearCode: "2026-27", date: "2026-10-09" };
  const other: Reg = { id: "ar_other", sectionId: "s2", academicYearCode: "2026-27", date: "2026-10-09" };
  assert.deepEqual(written([office, other], [teacher]), ["ar_other"], "the stored register for the slot stands");
  assert.deepEqual(written([teacher], [teacher]), ["ar_teacher"], "the same register is written normally");
}
assert.ok(/stored && stored !== r\.id/.test(push), "the push skips a copy whose slot holds another id");

console.log("attendancePrune.selftest: all assertions passed");
