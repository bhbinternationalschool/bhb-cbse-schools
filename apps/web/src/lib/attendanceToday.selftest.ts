import assert from "node:assert/strict";
import { attendanceCoverageNote, todayAttendanceCard, todayAttendanceFigures } from "./attendanceToday";

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

// 12 Oct 2026: 5 of 13 classes, 63 of 228 children, 50 present — the headline
// is the coverage, not "79%".
{
  const regs = [
    { sectionId: "a", marks: [...Array(2)].map(() => m("P")) },
    { sectionId: "b", marks: [...Array(14)].map(() => m("P")).concat([m("A"), m("A")]) },
    { sectionId: "c", marks: [...Array(18)].map(() => m("P")).concat([...Array(4)].map(() => m("A"))) },
    { sectionId: "d", marks: [...Array(7)].map(() => m("P")).concat([...Array(5)].map(() => m("A"))) },
    { sectionId: "e", marks: [...Array(9)].map(() => m("P")).concat([m("A"), m("A")]) },
  ];
  const f = todayAttendanceFigures(regs);
  assert.equal(f.marked, 63);
  assert.equal(f.pct, 79);
  const card = todayAttendanceCard(f, 13, 228);
  assert.equal(card.value, "5/13 classes", "partial morning: coverage is the headline");
  assert.ok(card.hint.startsWith("79% present in marked classes"), card.hint);
  assert.ok(card.hint.includes("50 present") && card.hint.includes("13 absent"), card.hint);
  assert.ok(card.hint.includes("165 children not marked yet"), card.hint);
  const full = todayAttendanceCard(f, 5, 63);
  assert.equal(full.value, "79%", "every class marked: the percentage is the headline");
  assert.ok(!full.hint.includes("not marked"), full.hint);
  assert.deepEqual(todayAttendanceCard(todayAttendanceFigures([]), 13, 228), { value: "—", hint: "No registers marked yet today" });
}
console.log("attendanceToday.selftest: all assertions passed");
