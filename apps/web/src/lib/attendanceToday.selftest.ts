import assert from "node:assert/strict";
import { attendanceCoverageNote, todayAttendanceFigures } from "./attendanceToday";

console.log("attendanceToday.selftest.ts");

const m = (status: string) => ({ studentId: Math.random().toString(36), status }) as never;

// Late is present, half-day is half, leave is in the denominator.
{
  const f = todayAttendanceFigures([{ sectionId: "s1", marks: [m("P"), m("L"), m("HD"), m("A"), m("LE")] }]);
  assert.equal(f.marked, 5);
  assert.equal(f.pct, 50, "(1 + 1 + ½) / 5 = 50% — late and half-day used to vanish");
}

// A duplicate register for one section is not counted twice.
{
  const f = todayAttendanceFigures([
    { sectionId: "s1", marks: [m("P"), m("A")] },
    { sectionId: "s1", marks: [m("P"), m("A")] },
    { sectionId: "s2", marks: [m("P")] },
  ]);
  assert.equal(f.marked, 3);
  assert.equal(f.sectionsMarked, 2);
}

// 9 Oct 2026: 5 of 13 sections, 74 of 228 children — the tile must say so.
{
  const marks = [...Array(57)].map(() => m("P")).concat([...Array(17)].map(() => m("A")));
  const f = todayAttendanceFigures([{ sectionId: "a", marks: marks.slice(0, 20) }, { sectionId: "b", marks: marks.slice(20, 40) }, { sectionId: "c", marks: marks.slice(40, 55) }, { sectionId: "d", marks: marks.slice(55, 65) }, { sectionId: "e", marks: marks.slice(65) }]);
  assert.equal(f.pct, 77);
  assert.equal(attendanceCoverageNote(f, 13, 228), "5 of 13 sections · 74 of 228 children marked");
  assert.equal(attendanceCoverageNote(f, 5, 74), "", "every section marked → nothing to warn about");
}

assert.equal(todayAttendanceFigures([]).pct, 0);
console.log("attendanceToday.selftest: all assertions passed");
