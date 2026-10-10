/**
 * Payroll day counting — a working day with no register is ABSENT.
 * Run: npx tsx src/lib/payrollNoRegister.selftest.ts
 *
 * Director, 2026-09-29: no register = absent unless it is a holiday; what
 * the office marks before the run counts; exempt staff and approved leave
 * are not absences. August 2026 (31 days, all in the past).
 */
import { buildPayrollDraft } from "./payroll";
import { defaultSalarySetupState } from "./salarySetup";
import {
  emptyStaffAttendanceState,
  writeStaffAttendanceLocalRaw,
} from "./staffAttendance";
import { emptyStaffHrState, writeStaffHrLocalRaw } from "./staffHr";
import { defaultMasters, type MastersState } from "./masters";
import type { StaffRecord } from "./foundationMasters";

let failed = 0;
function expect(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failed += 1;
    console.error(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

const ay = "2026-27";
const staff = (id: string) =>
  ({
    id, empCode: id, fullName: id, status: "active", stream: "teaching",
    category: "permanent", designationId: "", classTeacherLinks: [], subjectTeachingLinks: [],
  }) as unknown as StaffRecord;

const masters: MastersState = { ...defaultMasters(), staff: [staff("t1"), staff("t2"), staff("exempt")], holidays: [] };
const salary = defaultSalarySetupState();

const att = emptyStaffAttendanceState();
att.settings.exemptStaffIds = ["exempt"];
// One register only: 3 Aug, t1 marked present by hand, t2 absent.
att.registers = [
  {
    id: "r1", academicYearCode: ay, date: "2026-08-03", markedBy: "office", markedAt: "", remark: "",
    marks: [
      { staffId: "t1", status: "P", note: "", inTime: "", outTime: "", punchWay: "manual" },
      { staffId: "t2", status: "A", note: "", inTime: "", outTime: "", punchWay: "manual" },
    ],
  },
];
writeStaffAttendanceLocalRaw(att);

const hr = emptyStaffHrState();
// t2 on approved (paid) leave 10–11 Aug with no register those days.
hr.leaveRequests = [
  { id: "l1", staffId: "t2", typeCode: "CL", fromDate: "2026-08-10", toDate: "2026-08-11", halfDay: false,
    status: "approved", academicYearCode: ay } as never,
];
writeStaffHrLocalRaw(hr);

const run = buildPayrollDraft({ masters, salary, month: "2026-08", academicYearCode: ay, createdBy: "test" });
const line = (id: string) => run.lines.find((l) => l.staffId === id);

if (!line("t1")) {
  console.error("SKIP: default salary setup has no structure for the test staff — cannot exercise payroll");
  process.exit(1);
}
const days = (id: string) => {
  const l = line(id)!;
  return { P: l.daysPresent, A: l.daysAbsent, LE: l.daysLeavePaid, H: l.daysHoliday };
};
const workdays = 31 - (line("t1")!.daysHoliday);
// t1: the one hand-marked day is present; every other working day unmarked → absent.
expect("t1 present", days("t1").P, 1);
expect("t1 absent", days("t1").A, workdays - 1);
// t2: marked absent 3 Aug, 2 leave days, the rest unmarked → absent.
expect("t2 leave", days("t2").LE, 2);
expect("t2 absent", days("t2").A, workdays - 2);
// Exempt staff keep no attendance and are paid for every working day.
expect("exempt present", days("exempt").P, workdays);
expect("exempt absent", days("exempt").A, 0);

if (failed) {
  console.error(`payrollNoRegister: ${failed} failure(s)`);
  process.exit(1);
}
console.log("payrollNoRegister: ok");
