/**
 * Run: npx tsx src/lib/reportsWrongFigures.selftest.ts
 *
 * Report Center audit step 3b (14 Oct 2026) — reports that printed a wrong
 * figure from real data:
 *  - monthly attendance %: the school's working-day rule (holidays off,
 *    counted from admission); nothing marked = "—", never 0% and never a
 *    "≤ 75%" defaulter; the session's children once each;
 *  - exams: absent is not FAIL; ties share a rank (1, 1, 3); subjects
 *    counted are shown;
 *  - homework "days without HW": the right days (it checked yesterday's posts
 *    in IST), holidays and future days left out;
 *  - ledger: the running balance carries on from before the period;
 *  - staff leave: no balance on record → used from approved leave, and the
 *    row says the allotment is only the default;
 *  - students register: one row per child, classes in school order.
 */
import assert from "node:assert/strict";
import type { AttendanceRegister, AttendanceState } from "./attendance";
import type { MastersState } from "./masters";
import { emptySisState, type SisState, type SisStudent } from "./sis";
import { runStudentAttReport } from "./studentAttendanceReportCatalog";
import { competitionRanks, resultWord, subjectsCounted } from "./examReportCatalog";
import { emptyHomeworkState, runHomeworkReport, type HomeworkState } from "./homework";
import { coaLedgerRows, coaOpeningBalance } from "./accountsJournal";
import type { AccountsState } from "./accountsTypes";
import { emptyStaffHrState, type StaffHrState } from "./staffHr";
import { runStaffLeaveReport } from "./staffLeaveReportCatalog";
import { filterSisStudents } from "./sisReportCatalog";

// Exports end in a browser download, which Node cannot do; these checks read
// the rows (preview) or the row count the report returns.
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
  id: String(p.title),
  academicYearCode: AY,
  kind: "holiday",
  scope: "school",
  groupCode: "",
  classIds: [],
  appliesTo: "everyone",
  mode: "one_off",
  weekday: null,
  dayType: "full",
  paidForStaff: true,
  exceptionDates: [],
  workingOverride: false,
  isPublished: true,
  note: "",
  ...p,
});
const masters = {
  academicYears: [{ id: "ay", code: AY, label: AY, startsOn: "2026-04-01", endsOn: "2027-03-31", status: "current", isActive: true }],
  holidays: [
    hol({ title: "Sunday Holiday", mode: "weekly", weekday: 0, startsOn: "2026-04-01", endsOn: "2027-03-31" }),
    hol({ title: "Gandhi Jayanti", startsOn: "2026-10-02", endsOn: "2026-10-02" }),
  ],
  classes: [
    { id: "c9", name: "IX", isActive: true, sortOrder: 12 },
    { id: "cl", name: "LKG", isActive: true, sortOrder: 2 },
  ],
  sections: [
    { id: "s9", classId: "c9", name: "A", isActive: true },
    { id: "sl", classId: "cl", name: "A", isActive: true },
  ],
  staff: [{ id: "t1", fullName: "Ravi", empCode: "E1", status: "active", stream: "teaching", departmentId: "" }],
  departments: [],
} as unknown as MastersState;

const kid = (p: Partial<SisStudent>): SisStudent =>
  ({ id: "", fullName: "", admissionNo: "", classId: "c9", sectionId: "s9", status: "active", academicYearCode: AY, joinedOn: "2024-04-01", ...p }) as unknown as SisStudent;

const sis: SisState = {
  ...emptySisState(),
  students: [
    kid({ id: "asha", fullName: "Asha", admissionNo: "1" }),
    kid({ id: "bina", fullName: "Bina", admissionNo: "2" }),
    kid({ id: "chet", fullName: "Chetan", admissionNo: "3", joinedOn: "2026-09-20" }),
    kid({ id: "asha_dup", fullName: "Asha", admissionNo: "1" }), // same child, a second row this year
    kid({ id: "lkg", fullName: "Lata", admissionNo: "4", classId: "cl", sectionId: "sl" }),
  ],
};

// September 2026: Sundays off. Asha present every working day, Chetan from
// the 21st, Bina never marked.
const sept: string[] = [];
for (let d = 1; d <= 30; d++) {
  const iso = `2026-09-${String(d).padStart(2, "0")}`;
  if (new Date(`${iso}T12:00:00Z`).getUTCDay() !== 0) sept.push(iso);
}
const regs: AttendanceRegister[] = sept.map(
  (date) =>
    ({
      id: `r_${date}`,
      academicYearCode: AY,
      campusId: "",
      classId: "c9",
      sectionId: "s9",
      date,
      marks: [
        { studentId: "asha", status: "P", note: "" },
        ...(date > "2026-09-20" ? [{ studentId: "chet", status: "P", note: "" }] : []),
      ],
      markedBy: "t",
      markedAt: `${date}T05:00:00Z`,
    }) as unknown as AttendanceRegister,
);
const attendance = { registers: regs } as unknown as AttendanceState;

check("attendance %: working days, from admission; nothing marked is '—' and no defaulter", () => {
  const r = runStudentAttReport("monthly_percentage", { academicYearCode: AY, month: "2026-09", classId: "c9", masters, sis, attendance, format: "preview" } as never);
  assert.ok(r.ok);
  const rows = (r as { preview: { rows: Record<string, unknown>[] } }).preview.rows;
  const by = (n: string) => rows.find((x) => x.student === n)!;
  assert.equal(rows.filter((x) => x.student === "Asha").length, 1, "one row per child");
  assert.equal(by("Asha").workingDays, 26);
  assert.equal(by("Asha").percent, "100%");
  assert.equal(by("Chetan").workingDays, 9, "21st–30th less the Sunday");
  assert.equal(by("Chetan").percent, "100%", "not 30% for days before admission");
  assert.equal(by("Bina").percent, "—", "unknown, not 0%");
  const low = runStudentAttReport("monthly_percentage", { academicYearCode: AY, month: "2026-09", classId: "c9", masters, sis, attendance, maxPercent: 75, format: "preview" } as never);
  assert.ok(low.ok);
  assert.deepEqual((low as { preview: { rows: unknown[] } }).preview.rows, [], "nobody below 75: Bina is unknown, not a defaulter");
});

check("exams: absent is not FAIL; ties share a rank; subjects counted", () => {
  assert.equal(resultWord({ error: null, card: { absent: true } as never, passed: false }), "Absent");
  assert.equal(resultWord({ error: null, card: { absent: false } as never, passed: false }), "FAIL");
  assert.equal(resultWord({ error: "no marks", card: null, passed: false }), "No marks");
  assert.deepEqual(competitionRanks([92.5, 92.5, 90, 88, 88, 70], (x) => x), [1, 1, 3, 4, 4, 6]);
  assert.deepEqual(
    subjectsCounted({ lines: [{ marksObtained: 40, absent: false }, { marksObtained: null, absent: true }, { marksObtained: null, absent: false }] }),
    { counted: 1, total: 3 },
  );
});

check("homework: the right days, holidays and future left out", () => {
  // Posts on every working day 1–9 Oct 2026 (Gandhi Jayanti 2nd and Sunday 4th off).
  const days = ["2026-10-01", "2026-10-03", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"];
  const hw: HomeworkState = {
    ...emptyHomeworkState(),
    posts: days.map((date) => ({ id: `p_${date}`, sectionId: "s9", classId: "c9", date, status: "published", academicYearCode: AY })) as never,
  };
  const m = { ...masters, sections: [masters.sections[0]!] } as MastersState;
  const r = runHomeworkReport("missing_hw_days", { academicYearCode: AY, fromDate: "2026-10-01", toDate: "2026-10-09", format: "excel", homework: hw, masters: m, sis } as never);
  assert.ok(r.ok);
  assert.match((r as { message: string }).message, /: 0 row/, "no section is missing a day");
  const future = runHomeworkReport("missing_hw_days", { academicYearCode: AY, fromDate: "2099-01-01", toDate: "2099-01-31", format: "excel", homework: hw, masters: m, sis } as never);
  assert.match((future as { message: string }).message, /: 0 row/, "future days are not 'missing'");
});

check("ledger: the balance carries on from before the period", () => {
  const acc = {
    coaAccounts: [{ id: "cash", code: "1000", name: "Cash", group: "assets", isActive: true }],
    journalEntries: [
      { id: "j0", date: "2026-04-01", voucherNo: "OB", narration: "Opening", sourceType: "opening", createdAt: "1", voidedAt: null, lines: [{ coaId: "cash", debitPaise: 100000, creditPaise: 0, narration: "" }] },
      { id: "j1", date: "2026-10-05", voucherNo: "V1", narration: "Fees", sourceType: "fee", createdAt: "2", voidedAt: null, lines: [{ coaId: "cash", debitPaise: 20000, creditPaise: 0, narration: "" }] },
      { id: "j2", date: "2026-10-07", voucherNo: "V2", narration: "Diesel", sourceType: "expense", createdAt: "3", voidedAt: null, lines: [{ coaId: "cash", debitPaise: 0, creditPaise: 5000, narration: "" }] },
      { id: "jv", date: "2026-05-01", voucherNo: "X", narration: "Void", sourceType: "x", createdAt: "4", voidedAt: "2026-05-02", lines: [{ coaId: "cash", debitPaise: 99900, creditPaise: 0, narration: "" }] },
    ],
  } as unknown as AccountsState;
  assert.equal(coaOpeningBalance("cash", "2026-10-01", acc), 100000, "void entries left out");
  assert.deepEqual(coaLedgerRows("cash", "2026-10-01", "2026-10-31", acc).map((r) => r.balancePaise), [120000, 115000]);
  assert.deepEqual(coaLedgerRows("cash", "0001-01-01", "2026-10-31", acc).map((r) => r.balancePaise), [100000, 120000, 115000], "from the start of the books: unchanged");
});

check("staff leave: no balance on record → used from approved leave, marked default", () => {
  const hr: StaffHrState = {
    ...emptyStaffHrState(),
    leaveTypes: [{ code: "CL", name: "Casual", defaultDaysPerYear: 12 }] as never,
    leaveBalances: [],
    leaveRequests: [{ id: "lr", academicYearCode: AY, staffId: "t1", typeCode: "CL", fromDate: "2026-09-01", toDate: "2026-09-03", days: 3, halfDay: false, status: "approved" }] as never,
  };
  const r = runStaffLeaveReport("monthly_balance_leave", { academicYearCode: AY, masters, hr, format: "preview" } as never);
  assert.ok(r.ok);
  const row = (r as { preview: { rows: Record<string, unknown>[] } }).preview.rows[0]!;
  assert.equal(row.used, 3, "not 0");
  assert.equal(row.remaining, 9);
  assert.match(String(row.source), /Default/);
});

check("students register: one row per child, classes in school order", () => {
  const rows = filterSisStudents(sis, masters, { academicYearCode: AY } as never);
  assert.equal(rows.filter((s) => s.fullName === "Asha").length, 1);
  assert.equal(rows[0]!.fullName, "Lata", "LKG (order 2) before IX (order 12) — alphabetically IX came first");
});

setTimeout(() => {
  if (failures) {
    console.log(`${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("  all ok");
  process.exit(0);
}, 50);
