/**
 * Run: npx tsx src/lib/timetableFreeGrid.selftest.ts
 *
 * Director, 6 Oct 2026: the free-period grid — teachers × the day's periods,
 * Free or the class they are in, with a free count per period. It must agree
 * with the free-period list (computeFreeTeacherSlots) cell for cell.
 */
import assert from "node:assert/strict";
import type { MastersState } from "./masters";
import type { TimetableState } from "./timetable";
import { computeFreeTeacherSlots, computeTeacherDayGrid } from "./timetableReportCatalog";

console.log("timetableFreeGrid.selftest.ts");

const masters = {
  staff: [
    { id: "t1", empCode: "E1", fullName: "Beena", stream: "teaching", status: "active" },
    { id: "t2", empCode: "E2", fullName: "Asit", stream: "teaching", status: "active" },
    { id: "t3", empCode: "E3", fullName: "Clerk", stream: "non_teaching", status: "active" },
    { id: "t4", empCode: "E4", fullName: "Left", stream: "teaching", status: "inactive" },
  ],
  classes: [{ id: "c6", name: "VI" }, { id: "c7", name: "VII" }],
  sections: [{ id: "a", name: "A" }],
  subjects: [{ id: "m", code: "MATH", nameEn: "Mathematics" }],
} as unknown as MastersState;

const bell = [
  { kind: "teaching", no: 1, label: "P1", startTime: "08:00", endTime: "08:40" },
  { kind: "break", no: 0, label: "Break", startTime: "08:40", endTime: "09:00" },
  { kind: "teaching", no: 2, label: "P2", startTime: "09:00", endTime: "09:40" },
];
const tt = {
  workingWeekdays: [1, 2],
  bellTemplate: bell,
  grids: [
    { id: "g6", academicYearCode: "2026-27", classId: "c6", sectionId: "a", updatedAt: "", slots: [
      { weekday: 1, periodNo: 1, subjectId: "m", teacherId: "t1", roomId: "" },
      { weekday: 2, periodNo: 2, subjectId: "m", teacherId: "t2", roomId: "" },
    ] },
    { id: "g7", academicYearCode: "2026-27", classId: "c7", sectionId: "a", updatedAt: "", slots: [
      { weekday: 1, periodNo: 1, subjectId: "m", teacherId: "t1", roomId: "" },
    ] },
    { id: "old", academicYearCode: "2025-26", classId: "c7", sectionId: "a", updatedAt: "", slots: [
      { weekday: 1, periodNo: 2, subjectId: "m", teacherId: "t2", roomId: "" },
    ] },
  ],
} as unknown as TimetableState;

const g = computeTeacherDayGrid(masters, tt, "2026-27", 1);
assert.deepEqual(g.rows.map((r) => r.teacherName), ["Asit", "Beena"], "teaching, active, by name");
const beena = g.rows.find((r) => r.teacherId === "t1")!;
const c = beena.cells[1]!;
assert.ok(!c.free && c.clash && c.classSection === "VI-A + VII-A", "two classes at once shows the clash");
assert.ok(beena.cells[2]!.free);
assert.ok(g.rows.find((r) => r.teacherId === "t2")!.cells[2]!.free, "last year's grid does not count");
assert.deepEqual(g.freeByPeriod, { 1: 1, 2: 2 });

// Grid and list agree cell for cell.
const list = computeFreeTeacherSlots(masters, tt, "2026-27", 1);
const fromGrid = g.rows.flatMap((r) => g.periods.filter((p) => r.cells[p.no]!.free).map((p) => `${r.teacherId}|${p.no}`)).sort();
assert.deepEqual(fromGrid, list.map((s) => `${s.teacherId}|${s.periodNo}`).sort());

console.log("  ✓ free-period grid — teachers × periods, clash shown, agrees with the list");
