/**
 * Run: npx tsx src/lib/teacherLoadPublished.selftest.ts
 *
 * Teacher load counts the PUBLISHED timetable only (director, 14 Oct 2026).
 * It counted the draft grids, so a half-built draft read as each teacher's
 * load. With nothing published for the session the report refuses, rather
 * than showing every teacher at 0 periods.
 */
import assert from "node:assert/strict";
import type { MastersState } from "./masters";
import { emptyTimetableState, type TimetableGrid, type TimetableState } from "./timetable";
import { __timetableReportInternalsForTests as T, runTimetableReport } from "./timetableReportCatalog";

process.on("unhandledRejection", () => undefined);

const AY = "2026-27";
const masters = {
  classes: [{ id: "c4", name: "IV", isActive: true }],
  sections: [{ id: "s4a", classId: "c4", name: "A", isActive: true }],
  subjects: [],
  staff: [{ id: "t1", empCode: "E1", fullName: "Ravi", stream: "teaching", status: "active" }],
} as unknown as MastersState;

const grid = (id: string, periods: number, ay = AY): TimetableGrid =>
  ({
    id,
    academicYearCode: ay,
    classId: "c4",
    sectionId: "s4a",
    slots: Array.from({ length: periods }, (_, i) => ({ weekday: 1 + (i % 5), periodNo: 1 + Math.floor(i / 5), subjectId: "en", teacherId: "t1" })),
  }) as unknown as TimetableGrid;

const tt: TimetableState = { ...emptyTimetableState(), grids: [grid("draft", 5)], publishedGrids: [grid("pub", 2), grid("old", 9, "2025-26")] };

const load = T.runTeacherLoad(masters, tt, AY);
assert.equal(load.rows.find((r) => r.name === "Ravi")!.periodsPerWeek, 2, "published 2, not the draft's 5, not last year's 9");

const none = runTimetableReport("teacher_load", { academicYearCode: AY, masters, timetable: { ...tt, publishedGrids: [] }, format: "excel" });
assert.equal(none.ok, false);
assert.match((none as { error: string }).error, /No published timetable for 2026-27/);

console.log("teacherLoadPublished.selftest.ts: ok");
process.exit(0);
