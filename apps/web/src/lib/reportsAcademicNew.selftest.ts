/**
 * Run: npx tsx src/lib/reportsAcademicNew.selftest.ts
 *
 * New academic reports (Report Center audit step 5a, 14 Oct 2026):
 *  - Session attendance % (CBSE 75% rule): session to date on the school's
 *    working-day rule; nothing marked = "Not known", never a defaulter;
 *  - Attendance not marked: sections with children, open that day, and no
 *    register — with the class teacher; a holiday lists nobody;
 *  - Exams: subject analysis (absent and not entered apart from marks,
 *    each subject's own pass line), tabulation register (AB, —, rank
 *    1-1-3), grade distribution;
 *  - PTM attendance per class (cancelled bookings ignored, not booked
 *    counted);
 *  - Teaching: syllabus coverage needs a plan; period delivery refuses
 *    when no timetable is published rather than reporting 100%.
 */
import assert from "node:assert/strict";
import type { AttendanceRegister, AttendanceState } from "./attendance";
import type { MastersState } from "./masters";
import { emptySisState, type SisState, type SisStudent } from "./sis";
import { runStudentAttReport } from "./studentAttendanceReportCatalog";
import { gradeDistributionFromRows, subjectAnalysisFromRows, tabulationFromRows, type ResultRowWithScope } from "./examReportCatalog";
import { ptmAttendanceRows, type PtmEvent, type PtmState } from "./ptm";
import { emptyTeachingState } from "./teaching";
import { emptyTimetableState } from "./timetable";
import { runTeachingReport } from "./teachingReportCatalog";

process.on("unhandledRejection", () => undefined);

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name}\n       ${e instanceof Error ? e.message : String(e)}`);
  }
}

const AY = "2026-27";
const hol = (p: Record<string, unknown>) => ({
  id: String(p.title), academicYearCode: AY, kind: "holiday", scope: "school", groupCode: "", classIds: [], appliesTo: "everyone",
  mode: "one_off", weekday: null, dayType: "full", paidForStaff: true, exceptionDates: [], workingOverride: false, isPublished: true, note: "", ...p,
});
const masters = {
  academicYears: [{ id: "ay", code: AY, label: AY, startsOn: "2026-04-01", endsOn: "2027-03-31", status: "current", isActive: true }],
  holidays: [hol({ title: "Sunday Holiday", mode: "weekly", weekday: 0, startsOn: "2026-04-01", endsOn: "2027-03-31" })],
  classes: [{ id: "c9", name: "IX", isActive: true, sortOrder: 12 }, { id: "cl", name: "LKG", isActive: true, sortOrder: 2 }],
  sections: [{ id: "s9", classId: "c9", name: "A", isActive: true }, { id: "sl", classId: "cl", name: "A", isActive: true }],
  subjects: [{ id: "en", nameEn: "English" }, { id: "ma", nameEn: "Maths" }],
  staff: [{ id: "t1", fullName: "Ravi", status: "active", classTeacherLinks: [{ classId: "c9", sectionId: "s9", academicYearCode: AY }] }],
} as unknown as MastersState;

const kid = (p: Partial<SisStudent>): SisStudent =>
  ({ id: "", fullName: "", admissionNo: "", classId: "c9", sectionId: "s9", status: "active", academicYearCode: AY, joinedOn: "2024-04-01", ...p }) as unknown as SisStudent;
const sis: SisState = {
  ...emptySisState(),
  students: [
    kid({ id: "asha", fullName: "Asha", admissionNo: "1", rollNo: "1" }),
    kid({ id: "bina", fullName: "Bina", admissionNo: "2", rollNo: "2" }),
    kid({ id: "chet", fullName: "Chetan", admissionNo: "3", rollNo: "3" }),
    kid({ id: "lata", fullName: "Lata", admissionNo: "4", classId: "cl", sectionId: "sl" }),
  ],
};

// April 2026 working days to the 10th (Sunday 5th off): Asha every day, Chetan half, Bina never.
const days = ["2026-04-01", "2026-04-02", "2026-04-03", "2026-04-04", "2026-04-06", "2026-04-07", "2026-04-08", "2026-04-09", "2026-04-10"];
const regs = days.map(
  (date, i) =>
    ({
      id: `r_${date}`, academicYearCode: AY, campusId: "", classId: "c9", sectionId: "s9", date, markedBy: "t", markedAt: `${date}T05:00:00Z`,
      marks: [{ studentId: "asha", status: "P", note: "" }, { studentId: "chet", status: i % 2 ? "A" : "P", note: "" }],
    }) as unknown as AttendanceRegister,
);
const attendance = { registers: regs } as unknown as AttendanceState;

check("session attendance %: to date, nothing marked is 'Not known'", () => {
  const r = runStudentAttReport("session_percentage", { academicYearCode: AY, classId: "c9", masters, sis, attendance, format: "preview" } as never);
  assert.ok(r.ok);
  const rows = (r as { preview: { rows: Record<string, unknown>[] } }).preview.rows;
  const by = (n: string) => rows.find((x) => x.student === n)!;
  assert.equal(by("Bina").below75, "Not known");
  assert.equal(by("Bina").percent, "—");
  // Today is after April, so later working days are unmarked: the school's
  // rule counts them as not present — the "Not marked" column says so.
  assert.ok(Number(by("Asha").unmarkedDays) > 0);
  const flagged = runStudentAttReport("session_percentage", { academicYearCode: AY, classId: "c9", masters, sis, attendance, maxPercent: 75, format: "preview" } as never);
  assert.ok(flagged.ok);
  assert.ok(!(flagged as { preview: { rows: Record<string, unknown>[] } }).preview.rows.some((x) => x.student === "Bina"), "unknown is not a defaulter");
});

check("attendance not marked: open day, children, no register — with class teacher", () => {
  const r = runStudentAttReport("not_marked", { academicYearCode: AY, date: "2026-04-06", masters, sis, attendance, format: "preview" } as never);
  assert.ok(r.ok);
  const rows = (r as { preview: { rows: Record<string, unknown>[] } }).preview.rows;
  assert.deepEqual(rows.map((x) => `${x.className} ${x.section}`), ["LKG A"], "IX-A marked; LKG-A not");
  const ix = runStudentAttReport("not_marked", { academicYearCode: AY, date: "2026-04-11", classId: "c9", masters, sis, attendance, format: "preview" } as never);
  const ixRows = (ix as { preview: { rows: Record<string, unknown>[] } }).preview.rows;
  assert.equal(ixRows[0]!.classTeacher, "Ravi");
  const sunday = runStudentAttReport("not_marked", { academicYearCode: AY, date: "2026-04-05", masters, sis, attendance, format: "preview" } as never);
  assert.deepEqual((sunday as { preview: { rows: unknown[] } }).preview.rows, [], "a holiday is not a missing register");
});

// Exam result rows: Asha 80/90, Bina absent in Maths, Chetan absent everywhere, Lata not entered in Maths.
const line = (subjectId: string, subjectName: string, marks: number | null, absent = false) => ({
  subjectId, subjectName, maxMarks: 100, marksObtained: marks, absent, passPercent: 33, grade: "", gradeLabel: "", remark: "", parts: [],
});
const row = (id: string, name: string, lines: ReturnType<typeof line>[], extra: Record<string, unknown> = {}): ResultRowWithScope =>
  ({
    student: sis.students.find((s) => s.id === id) ?? kid({ id, fullName: name }),
    classId: "c9",
    sectionId: "s9",
    error: null,
    passed: true,
    failedSubjects: [],
    card: {
      lines,
      absent: lines.every((l) => l.absent),
      totalObtained: lines.reduce((s, l) => s + (l.marksObtained ?? 0), 0),
      totalMax: lines.filter((l) => l.marksObtained != null).length * 100,
      percent: 0,
      overallGrade: "B1",
      ...extra,
    },
  }) as unknown as ResultRowWithScope;
const examRows = [
  row("asha", "Asha", [line("en", "English", 80), line("ma", "Maths", 90)], { percent: 85, overallGrade: "A2" }),
  row("bina", "Bina", [line("en", "English", 20), line("ma", "Maths", null, true)], { percent: 20, overallGrade: "E" }),
  row("chet", "Chetan", [line("en", "English", null, true), line("ma", "Maths", null, true)], { percent: 0 }),
  row("dev", "Dev", [line("en", "English", 70), line("ma", "Maths", 100)], { percent: 85, overallGrade: "A2" }),
];

check("subject analysis: absent apart, own pass line, no zeros invented", () => {
  const t = subjectAnalysisFromRows(masters, examRows);
  const en = t.rows.find((r) => r.subject === "English")!;
  assert.equal(en.appeared, 3);
  assert.equal(en.absent, 1);
  assert.equal(en.passed, 2, "20/100 under 33% fails");
  assert.equal(en.highest, "80%");
  assert.equal(en.lowest, "20%");
  const ma = t.rows.find((r) => r.subject === "Maths")!;
  assert.equal(ma.appeared, 2);
  assert.equal(ma.absent, 2);
  assert.equal(ma.average, "95%");
});

check("tabulation: AB for absent, ties share a rank, absent not ranked", () => {
  const t = tabulationFromRows(masters, examRows);
  const by = (n: string) => t.rows.find((r) => r.name === n)!;
  const maKey = t.columns.find((c) => c.header === "Maths")!.key;
  assert.equal(by("Bina")[maKey], "AB");
  assert.equal(by("Asha").rank, 1);
  assert.equal(by("Dev").rank, 1, "85% and 85% share first");
  assert.equal(by("Chetan").result, "Absent");
  assert.equal(by("Chetan").rank, "");
  assert.equal(by("Bina").rank, "", "a paper missed: not ranked");
});

check("grade distribution counts grades and absentees", () => {
  const t = gradeDistributionFromRows(masters, examRows);
  const r = t.rows[0]!;
  assert.equal(r["g_A2"], 2);
  assert.equal(r["g_E"], 1);
  assert.equal(r.absent, 1);
  assert.equal(r.total, 4);
});

check("PTM attendance per class", () => {
  const event = { id: "e1", academicYearCode: AY, name: "Oct PTM", date: "2026-10-10", classIds: ["c9"] } as unknown as PtmEvent;
  const ptm = {
    events: [event],
    slots: [],
    feedback: [],
    bookings: [
      { id: "b1", eventId: "e1", studentId: "asha", status: "completed" },
      { id: "b2", eventId: "e1", studentId: "bina", status: "no_show" },
      { id: "b3", eventId: "e1", studentId: "chet", status: "cancelled" },
    ],
  } as unknown as PtmState;
  const rows = ptmAttendanceRows(event, ptm, sis, masters);
  assert.equal(rows.length, 1, "only the event's class");
  assert.deepEqual(
    { invited: rows[0]!.invited, attended: rows[0]!.attended, noShow: rows[0]!.noShow, notBooked: rows[0]!.notBooked },
    { invited: 3, attended: 1, noShow: 1, notBooked: 1 },
    "a cancelled booking is not booked",
  );
});

check("teaching: coverage needs a plan; delivery refuses without a published timetable", () => {
  const empty = runTeachingReport("syllabus_coverage", { academicYearCode: AY, masters, teaching: emptyTeachingState(), format: "excel" });
  assert.equal(empty.ok, false);
  assert.match((empty as { error: string }).error, /No syllabus plan/);
  const delivery = runTeachingReport("period_delivery", {
    academicYearCode: AY,
    masters,
    teaching: emptyTeachingState(),
    timetable: emptyTimetableState(),
    fromDate: "2026-04-01",
    toDate: "2026-04-10",
    format: "excel",
  });
  assert.equal(delivery.ok, false);
  assert.match((delivery as { error: string }).error, /published timetable/, "never '100% delivered' from nothing");
});

setTimeout(() => {
  if (failures) {
    console.log(`${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("  all ok");
  process.exit(0);
}, 50);
