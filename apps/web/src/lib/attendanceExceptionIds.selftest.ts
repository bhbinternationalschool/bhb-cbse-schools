/**
 * Self-test: automatic attendance exceptions never multiply (13 Oct 2026).
 * Run: npx tsx src/lib/attendanceExceptionIds.selftest.ts
 *
 * The defect: every register save rebuilt the exceptions under fresh random
 * ids and could delete only the old copies its own browser held. Teachers
 * mark on many phones, so copies piled up — 1,010 open "Perfect Present
 * streak" rows for 103 child-days. And a streak was keyed by its LATEST day,
 * so every school day added another row per child on a streak.
 */
import assert from "node:assert/strict";
import {
  autoExceptionId,
  emptyAttendanceState,
  rebuildExceptionsInto,
  type AttendanceRegister,
  type AttendanceState,
} from "./attendance";

console.log("attendanceExceptionIds.selftest.ts");

const ay = "2026-27";
const day = (n: number) => `2026-09-${String(n).padStart(2, "0")}`;
const reg = (date: string, status: "P" | "A" = "P"): AttendanceRegister =>
  ({
    id: `ar_${date}`, academicYearCode: ay, campusId: "", classId: "c5", sectionId: "s5", date,
    marks: [{ studentId: "stu1", status }], markedBy: "t", markedAt: `${date}T03:00:00Z`, remark: "",
  }) as unknown as AttendanceRegister;

const withRegs = (regs: AttendanceRegister[], prev?: AttendanceState): AttendanceState => ({
  ...(prev ?? emptyAttendanceState()),
  registers: regs,
});

// 1. Same id for the same child, day and reason — wherever it is computed.
assert.equal(autoExceptionId("perfect_present_streak|stu1|2026-09-01|s5"), autoExceptionId("perfect_present_streak|stu1|2026-09-01|s5"));
assert.notEqual(autoExceptionId("perfect_present_streak|stu1|2026-09-01|s5"), autoExceptionId("perfect_present_streak|stu2|2026-09-01|s5"));

// 2. An absence breaks the run; ten Present days after it make one streak.
const regs = [reg(day(1), "A"), ...Array.from({ length: 10 }, (_, i) => reg(day(i + 2)))];
const a = rebuildExceptionsInto(withRegs(regs));
const streaksA = a.exceptions.filter((e) => e.kind === "perfect_present_streak");
assert.equal(streaksA.length, 1, "one streak exception");
assert.equal(streaksA[0]!.date, day(2), "filed under the day the streak started");

// 3. Two browsers rebuilding independently produce the SAME row.
const b = rebuildExceptionsInto(withRegs(regs));
assert.equal(b.exceptions.find((e) => e.kind === "perfect_present_streak")!.id, streaksA[0]!.id, "same id from another browser");

// 4. The streak grows by a day: still one row, same id — no new row per day.
const longer = rebuildExceptionsInto(withRegs([...regs, reg(day(12))], a));
const streaksL = longer.exceptions.filter((e) => e.kind === "perfect_present_streak");
assert.equal(streaksL.length, 1, "a longer streak is the same exception");
assert.equal(streaksL[0]!.id, streaksA[0]!.id);
assert.match(streaksL[0]!.detail, /11 consecutive Present marks since 2026-09-02/);

// 5. A resolved streak stays resolved as the streak continues.
const resolved = { ...longer, exceptions: longer.exceptions.map((e) => ({ ...e, status: "resolved" as const, resolvedAt: "x", resolvedBy: "t", resolveNote: "checked" })) };
const after = rebuildExceptionsInto(withRegs([...regs, reg(day(12)), reg(day(13))], resolved));
assert.equal(after.exceptions.filter((e) => e.kind === "perfect_present_streak" && e.status === "open").length, 0, "checked once, not again every day");

console.log("  ok");
