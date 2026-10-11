/**
 * Self-test: visiting staff stay out of payroll, the attendance absent count
 * and substitution (director, 11 Oct 2026).
 * Run: npx tsx src/lib/visitingExclusions.selftest.ts
 *
 * The trap this exists for: resolveStructureForStaff fell back to the first
 * active salary structure for anyone without one, and buildPayrollDraft took
 * every active staff member — so a music teacher paid ₹300 a period would
 * have been drafted a full monthly salary with PF and ESIC on it.
 */
import assert from "node:assert/strict";

import { buildBankExportPreview } from "./bankFileExport";
import type { StaffRecord } from "./foundationMasters";
import { defaultMasters, type MastersState } from "./masters";
import { buildPayrollDraft, loadPayroll, writePayrollLocalRaw } from "./payroll";
import { buildIncrementDraft } from "./salaryIncrement";
import { defaultSalarySetupState, resolveStructureForStaff } from "./salarySetup";
import {
  defaultStaffMarks,
  emptyStaffAttendanceState,
  upsertStaffMarkInState,
  writeStaffAttendanceLocalRaw,
} from "./staffAttendance";
import { emptyStaffHrState, writeStaffHrLocalRaw } from "./staffHr";
import { staffMonthCalendar } from "./staffMonthCalendar";
import { emptyTimetableState } from "./timetable";
import { teachersForSubject } from "./timetableSolver";
import { substituteCandidates } from "./timetableSubstitution";

console.log("visitingExclusions.selftest.ts");

const ay = "2026-27";
const staff = (id: string, category: string, extra: Partial<StaffRecord> = {}) =>
  ({
    id, empCode: id.toUpperCase(), fullName: id, status: "active", stream: "teaching", category,
    designationId: "", classTeacherLinks: [], subjectTeachingLinks: [], joiningDate: "2025-04-01",
    bankAccountNo: "123456789012", bankIfsc: "SBIN0001234", bankAccountName: id, ...extra,
  }) as unknown as StaffRecord;

const musicLink = (classId: string, sectionId = "") => ({ academicYearCode: ay, classId, sectionId, subjectId: "mus" });
const perm = staff("perm", "permanent", { subjectTeachingLinks: [musicLink("c6")] as never });
const vis = staff("vis", "visiting", {
  visitingPay: { basis: "per_period", rateRupees: "300", tds194j: false },
  subjectTeachingLinks: [musicLink("c5")] as never,
});
const masters: MastersState = {
  ...defaultMasters(),
  staff: [perm, vis],
  holidays: [],
  classes: [{ id: "c5", name: "V" }, { id: "c6", name: "VI" }, { id: "c7", name: "VII" }] as never,
};
const salary = defaultSalarySetupState();

/* ── salary structure: never a fallback for visiting staff ───────────── */
assert.ok(resolveStructureForStaff(salary, perm), "a permanent teacher still resolves a structure");
assert.equal(resolveStructureForStaff(salary, vis), null, "visiting staff never get the active[0] fallback");

/* ── payroll draft, payslips, PF/ESIC: built from the draft ──────────── */
writeStaffAttendanceLocalRaw(emptyStaffAttendanceState());
writeStaffHrLocalRaw(emptyStaffHrState());
const run = buildPayrollDraft({ masters, salary, month: "2026-08", academicYearCode: ay, createdBy: "test" });
assert.ok(run.lines.some((l) => l.staffId === "perm"), "permanent staff are drafted");
assert.ok(!run.lines.some((l) => l.staffId === "vis"), "visiting staff are not on the payroll draft (so no payslip, PF or ESIC)");
const one = buildPayrollDraft({ masters, salary, month: "2026-08", academicYearCode: ay, createdBy: "test", staffIds: ["vis"] });
assert.equal(one.lines.length, 0, "not even when picked individually");

/* ── increments ──────────────────────────────────────────────────────── */
const inc = buildIncrementDraft({ masters, salary, academicYearCode: ay, effectiveFrom: "2027-04-01", createdBy: "test", anniversaryOnly: false });
assert.ok(!inc.lines.some((l) => l.staffId === "vis"), "no increment line for visiting staff");
assert.ok(inc.lines.some((l) => l.staffId === "perm"));

/* ── bank file: a stray visiting line from an old run never reaches it ─ */
{
  const permLine = run.lines.find((l) => l.staffId === "perm")!;
  // No register in the test month means absent → net 0, which the file
  // skips anyway; give both lines money so only the visiting rule decides.
  const paid = { ...permLine, netPay: 10_000, amountPayable: 10_000, paymentMode: "bank_transfer" };
  const stray = { ...paid, staffId: "vis", empCode: "VIS", fullName: "vis" };
  const posted = { ...run, status: "posted" as const, lines: [paid, stray] };
  writePayrollLocalRaw({ ...loadPayroll(), runs: [posted as never] });
  const preview = buildBankExportPreview({ masters, month: "2026-08", academicYearCode: ay, modes: ["all"], requirePosted: false });
  assert.ok(preview.rows.some((r) => r.empCode === "PERM"), "permanent staff are in the bank file");
  assert.ok(!preview.rows.some((r) => r.empCode === "VIS"), "visiting staff are never in the salary bank file");
}

/* ── attendance: not "Not punched" on a day nobody expected them ─────── */
{
  const marks = defaultStaffMarks([perm, vis]);
  assert.deepEqual(marks.map((m) => m.staffId), ["perm"], "a new register does not list visiting staff as absent");
  // Their own punch still lands, on a register the day's first punch creates.
  const state = emptyStaffAttendanceState();
  const r = upsertStaffMarkInState(state, {
    academicYearCode: ay, date: "2026-10-12", staffId: "vis", status: "P", inTime: "09:00", markedBy: "test", roster: [perm, vis],
  });
  const byId = new Map(r.register.marks.map((m) => [m.staffId, m.status]));
  assert.equal(byId.get("vis"), "P", "the visiting person's punch is recorded");
  assert.equal(byId.get("perm"), "A", "regular staff still start Not punched");
}

/* ── staff app "My attendance": unmarked days are not absences ───────── */
{
  const cal = (visiting: boolean) =>
    staffMonthCalendar({
      month: "2026-10",
      today: "2026-10-10",
      exempt: false,
      visiting,
      markOn: (d) => (d === "2026-10-05" ? { status: "P", note: "", inTime: "09:00", outTime: "12:00", punchWay: "self" } : null),
      holidayOn: () => ({ status: "working", label: "", paidForStaff: true }),
      approvedLeaveOn: () => false,
    });
  const v = cal(true);
  assert.equal(v.counts.notMarked, 0, "a visiting person's empty days are not 'not marked — absent'");
  assert.equal(v.counts.lwpDays, 0, "and never LWP");
  assert.equal(v.counts.present, 1, "the day they punched is present");
  assert.ok(cal(false).counts.notMarked > 0, "regular staff still see unmarked days as absent");
}

/* ── substitution: never proposed as a substitute ────────────────────── */
{
  const tt = emptyTimetableState();
  const cands = substituteCandidates({
    masters,
    state: tt,
    academicYearCode: ay,
    period: { weekday: 1, periodNo: 2, classId: "c5", subjectId: "mus" },
    absentTeacherIds: new Set(),
    takenTeacherIds: new Set(),
    subLoadByTeacher: new Map(),
  });
  assert.ok(cands.some((c) => c.staff.id === "perm"), "regular staff are candidates");
  assert.ok(!cands.some((c) => c.staff.id === "vis"), "visiting staff are never offered as a substitute — even for their own subject and class");
}

/* ── solver: placed only where explicitly linked ─────────────────────── */
{
  const tt = emptyTimetableState();
  const own = teachersForSubject(masters, tt, "c5", "s5a", ay, "mus");
  assert.ok(own.teachers.some((t) => t.id === "vis"), "linked to Music in V: may be placed there");
  const other = teachersForSubject(masters, { ...tt, classTeacherAllClassIds: [] }, "c7", "s7a", ay, "mus");
  assert.ok(!other.teachers.some((t) => t.id === "vis"), "not borrowed for Music in VII where they are not linked");
  assert.ok(other.teachers.some((t) => t.id === "perm"), "a regular music teacher still may be");
}

console.log("visitingExclusions: ok");
