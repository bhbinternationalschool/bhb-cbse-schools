/**
 * Run: npx tsx src/lib/studentAttendance.selftest.ts
 *
 * Two rules, both of which produce a wrong number in front of a parent if
 * they slip:
 *
 *   * a percentage needs its denominator — an unmarked register is "not
 *     marked", never 0%;
 *   * one day counts once — a section transfer or an evening re-mark puts
 *     the child in two registers for the same date.
 */
import assert from "node:assert/strict";
import type { AttendanceRegister } from "./attendance";
import {
  attendanceMonthLabel,
  attendancePercentText,
  studentAttendanceSummary,
} from "./studentAttendance";

console.log("studentAttendance.selftest.ts");

const AY = "2026-27";
let seq = 0;

function reg(
  date: string,
  marks: { studentId: string; status: "P" | "A" | "L" | "HD" | "LE" }[],
  extra?: Partial<AttendanceRegister>,
): AttendanceRegister {
  seq += 1;
  return {
    id: `reg${seq}`,
    academicYearCode: AY,
    campusId: "c1",
    classId: "cls5",
    sectionId: "secA",
    date,
    marks: marks.map((m) => ({ ...m, note: "" })),
    markedBy: "teacher",
    markedAt: `${date}T09:30:00.000Z`,
    remark: "",
    ...extra,
  };
}

const KID = "st1";
const OTHER = "st2";

// --- nothing marked is not zero percent -------------------------------
{
  const empty = studentAttendanceSummary([], KID, { academicYearCode: AY });
  assert.equal(empty.percent, null, "no register → no percentage");
  assert.equal(empty.marked, 0);
  assert.equal(empty.lastMarkedDate, "");
  assert.equal(attendancePercentText(empty), "Not marked yet");

  // Registers exist, but this child is in none of them.
  const others = studentAttendanceSummary(
    [reg("2026-09-01", [{ studentId: OTHER, status: "P" }])],
    KID,
    { academicYearCode: AY },
  );
  assert.equal(
    others.percent,
    null,
    "a child nobody marked is unmarked, not absent",
  );
}

// --- the school's own arithmetic: late counts full, half day counts half
{
  const s = studentAttendanceSummary(
    [
      reg("2026-09-01", [{ studentId: KID, status: "P" }]),
      reg("2026-09-02", [{ studentId: KID, status: "L" }]),
      reg("2026-09-03", [{ studentId: KID, status: "HD" }]),
      reg("2026-09-04", [{ studentId: KID, status: "A" }]),
      reg("2026-09-07", [{ studentId: KID, status: "LE" }]),
    ],
    KID,
    { academicYearCode: AY },
  );
  assert.equal(s.marked, 5);
  assert.equal(s.present, 1);
  assert.equal(s.late, 1);
  assert.equal(s.halfDay, 1);
  assert.equal(s.absent, 1);
  assert.equal(s.leave, 1);
  assert.equal(s.presentDays, 2.5, "1 + 1 + 0.5");
  assert.equal(s.percent, 50, "2.5 of 5 — same as the monthly report");
  assert.equal(attendancePercentText(s), "50% · 2.5 of 5 days");
  assert.equal(s.lastMarkedDate, "2026-09-07");
  assert.deepEqual(
    s.days.map((d) => d.date),
    ["2026-09-07", "2026-09-04", "2026-09-03", "2026-09-02", "2026-09-01"],
    "newest first",
  );
}

// --- one day counts once ----------------------------------------------
{
  // The class was marked at 9:30 with the child absent, and re-marked at
  // 16:00 once the late arrival was noticed. The evening mark is the truth
  // and the day is still ONE day.
  const s = studentAttendanceSummary(
    [
      reg("2026-09-01", [{ studentId: KID, status: "A" }]),
      reg("2026-09-01", [{ studentId: KID, status: "L" }], {
        markedAt: "2026-09-01T16:00:00.000Z",
      }),
    ],
    KID,
    { academicYearCode: AY },
  );
  assert.equal(s.marked, 1, "a re-mark is not a second day");
  assert.equal(s.days[0]?.status, "L", "the later marking wins");
  assert.equal(s.percent, 100);

  // Mid-year section transfer: both sections marked the same morning.
  const moved = studentAttendanceSummary(
    [
      reg("2026-09-02", [{ studentId: KID, status: "P" }], {
        sectionId: "secA",
      }),
      reg("2026-09-02", [{ studentId: KID, status: "P" }], {
        sectionId: "secB",
        markedAt: "2026-09-02T09:31:00.000Z",
      }),
      reg("2026-09-03", [{ studentId: KID, status: "A" }], {
        sectionId: "secB",
      }),
    ],
    KID,
    { academicYearCode: AY },
  );
  assert.equal(moved.marked, 2, "two dates, not three rows");
  assert.equal(moved.percent, 50);
  assert.equal(moved.days[1]?.sectionId, "secB", "the later register wins");
}

// --- months, newest first, each with its own denominator ---------------
{
  const s = studentAttendanceSummary(
    [
      reg("2026-08-28", [{ studentId: KID, status: "P" }]),
      reg("2026-08-29", [{ studentId: KID, status: "A" }]),
      reg("2026-09-01", [{ studentId: KID, status: "P" }]),
      reg("2026-09-02", [{ studentId: KID, status: "P" }]),
      reg("2026-09-03", [{ studentId: KID, status: "P" }]),
      reg("2026-09-04", [{ studentId: KID, status: "A" }]),
    ],
    KID,
    { academicYearCode: AY },
  );
  assert.deepEqual(
    s.months.map((m) => [m.month, m.marked, m.percent]),
    [
      ["2026-09", 4, 75],
      ["2026-08", 2, 50],
    ],
  );
  assert.equal(attendanceMonthLabel("2026-09"), "Sep 2026");
  assert.equal(attendanceMonthLabel("nonsense"), "nonsense");
}

// --- the run of absences the office should ring about ------------------
{
  const s = studentAttendanceSummary(
    [
      reg("2026-09-01", [{ studentId: KID, status: "P" }]),
      reg("2026-09-02", [{ studentId: KID, status: "A" }]),
      reg("2026-09-03", [{ studentId: KID, status: "A" }]),
      reg("2026-09-04", [{ studentId: KID, status: "A" }]),
    ],
    KID,
    { academicYearCode: AY },
  );
  assert.equal(s.absentStreak, 3, "three days running, ending today");

  const backToday = studentAttendanceSummary(
    [
      reg("2026-09-02", [{ studentId: KID, status: "A" }]),
      reg("2026-09-03", [{ studentId: KID, status: "A" }]),
      reg("2026-09-04", [{ studentId: KID, status: "P" }]),
    ],
    KID,
    { academicYearCode: AY },
  );
  assert.equal(
    backToday.absentStreak,
    0,
    "a child who came back today is not on a run of absences",
  );

  // Approved leave is not an unexplained absence and breaks the run.
  const onLeave = studentAttendanceSummary(
    [
      reg("2026-09-02", [{ studentId: KID, status: "A" }]),
      reg("2026-09-03", [{ studentId: KID, status: "LE" }]),
    ],
    KID,
    { academicYearCode: AY },
  );
  assert.equal(onLeave.absentStreak, 0);
}

// --- year and window filters ------------------------------------------
{
  const regs = [
    reg("2026-09-01", [{ studentId: KID, status: "P" }]),
    reg("2025-09-01", [{ studentId: KID, status: "A" }], {
      academicYearCode: "2025-26",
    }),
  ];
  const thisYear = studentAttendanceSummary(regs, KID, {
    academicYearCode: AY,
  });
  assert.equal(thisYear.marked, 1, "last year's register stays out");
  assert.equal(thisYear.percent, 100);

  const allYears = studentAttendanceSummary(regs, KID);
  assert.equal(allYears.marked, 2, "no year given → everything");

  const windowed = studentAttendanceSummary(regs, KID, {
    from: "2026-01-01",
    to: "2026-12-31",
  });
  assert.equal(windowed.marked, 1);
}

console.log("  all student-attendance assertions passed");
