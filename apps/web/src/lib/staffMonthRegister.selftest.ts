/**
 * Staff month register + month leave (lib/staffMonthRegister) and the
 * owner-only rule (lib/staffRegisterOwner).
 *
 * Run: npx tsx src/lib/staffMonthRegister.selftest.ts
 */
import assert from "node:assert/strict";
import type { StaffRecord } from "@/lib/foundationMasters";
import { defaultRbacState, type RbacState } from "@/lib/rbac";
import { emptyMastersShell, type MastersState } from "@/lib/masters";
import type { StaffAttendanceMark, StaffAttendanceRegister } from "@/lib/staffAttendance";
import { emptyStaffHrState, type LeaveRequest } from "@/lib/staffHr";
import {
  buildStaffMonthView,
  leaveTypeFromNote,
  staffCellText,
  staffLeaveBalanceExport,
  staffLeaveMonthExport,
  staffMonthRegisterExport,
  staffSessionMonths,
  type StaffMonthView,
} from "@/lib/staffMonthRegister";
import { isStaffRegisterOwner, staffRegisterMarkChanges } from "@/lib/staffRegisterOwner";

console.log("staffMonthRegister.selftest.ts");

const AY = "2026-27";
const masters: MastersState = {
  ...emptyMastersShell(),
  academicYears: [{ id: "ay", code: AY, label: AY, startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: true } as never],
  holidays: [
    {
      id: "h1",
      academicYearCode: AY,
      title: "Dussehra",
      startsOn: "2026-09-21",
      endsOn: "2026-09-21",
      isPublished: true,
      appliesTo: "everyone",
      mode: "one_off",
    } as never,
  ],
};

const person = (n: number, extra: Partial<StaffRecord> = {}): StaffRecord =>
  ({
    id: `s${n}`,
    empCode: `E${String(n).padStart(3, "0")}`,
    fullName: `Person ${n}`,
    status: "active",
    stream: n % 2 ? "teaching" : "non_teaching",
    category: "regular",
    designationId: null,
    joiningDate: "",
    leavingDate: "",
    ...extra,
  }) as StaffRecord;

const staff = [person(1), person(2), person(3, { joiningDate: "2026-09-15" }), person(4, { category: "visiting" as never })];

const mark = (staffId: string, status: StaffAttendanceMark["status"], extra: Partial<StaffAttendanceMark> = {}): StaffAttendanceMark => ({
  staffId,
  status,
  note: "",
  inTime: status === "A" || status === "LE" ? "" : "08:50",
  outTime: "",
  punchWay: "self",
  ...extra,
});
const reg = (date: string, marks: StaffAttendanceMark[]): StaffAttendanceRegister => ({
  id: `r_${date}`,
  academicYearCode: AY,
  date,
  marks,
  markedBy: "t",
  markedAt: `${date}T10:00:00Z`,
  remark: "",
});

const registers = [
  reg("2026-09-01", [mark("s1", "P"), mark("s2", "L"), mark("s3", "P")]), // s3 before joining: still shown (a saved mark)
  reg("2026-09-02", [mark("s1", "HD"), mark("s2", "A")]),
  reg("2026-09-03", [mark("s1", "LE", { note: "On leave (CL)", punchWay: "leave_sync" }), mark("s2", "P")]),
  reg("2026-09-04", [mark("s1", "A", { note: "Half-day leave (ML, morning off) · not punched for the afternoon" })]),
  reg("2026-09-06", [mark("s1", "P")]), // Sunday → extra
  reg("2026-09-21", [mark("s2", "HD")]), // Dussehra → extra ½
  reg("2026-08-31", [mark("s1", "A")]), // another month: ignored
];

const hr = emptyStaffHrState();
const leave = (id: string, staffId: string, typeCode: string, fromDate: string, toDate: string, days: number, extra: Partial<LeaveRequest> = {}): LeaveRequest => ({
  id,
  academicYearCode: AY,
  staffId,
  typeCode,
  fromDate,
  toDate,
  days,
  halfDay: false,
  reason: "r",
  status: "approved",
  origin: "request",
  appliedBy: "x",
  appliedAt: `${fromDate}T04:00:00Z`,
  decidedBy: "The Principal",
  decidedAt: `${fromDate}T05:00:00Z`,
  decisionNote: "",
  level1By: "",
  level1At: "",
  ...extra,
});
const types = hr.leaveTypes.map((t) => t.code);
assert.ok(types.includes("CL"), "default leave types carry CL");
const requests = [
  leave("l1", "s1", "CL", "2026-09-03", "2026-09-03", 1, { origin: "direct", decidedBy: "", appliedBy: "Owner" }),
  leave("l2", "s2", "CL", "2026-09-29", "2026-10-02", 4), // straddles month end: 2 in Sep
  leave("l3", "s2", "CL", "2026-08-10", "2026-08-10", 1), // before: counts in used-to-date
  leave("l4", "s1", "CL", "2026-10-05", "2026-10-05", 1), // after month end: not in used
  leave("l5", "s2", "CL", "2026-09-10", "2026-09-10", 1, { status: "rejected" }), // never counted
];

function build(today = "2026-10-15"): StaffMonthView {
  const v = buildStaffMonthView({
    masters,
    ay: AY,
    month: "2026-09",
    today,
    registers,
    staff,
    leaveTypes: hr.leaveTypes,
    leaveRequests: requests,
    leaveBalances: [{ id: "b", academicYearCode: AY, staffId: "s2", typeCode: "CL", allotted: 10, carriedForward: 1, encashed: 0, used: 99 }],
    leaveEncashments: [],
    overlayLeave: true,
  });
  if ("error" in v) throw new Error(v.error);
  return v;
}

{
  const v = build();
  assert.equal(v.days.length, 30);
  assert.equal(v.days.find((d) => d.date === "2026-09-06")!.teaching.off, true, "a Sunday is off without a Masters rule");
  assert.equal(v.days.find((d) => d.date === "2026-09-06")!.teaching.label, "Sunday");
  assert.equal(v.days.find((d) => d.date === "2026-09-21")!.nonTeaching.off, true, "a published holiday is off");
  assert.deepEqual(v.staff.map((r) => r.id), ["s1", "s2", "s3"], "visiting staff with no punch are left off; joiners are on");

  const s1 = v.staff[0]!;
  // 30 days − 4 Sundays − Dussehra = 25 working days.
  assert.equal(s1.totals.working, 25);
  assert.equal(s1.totals.P, 1);
  assert.equal(s1.totals.HD, 1);
  assert.equal(s1.totals.present, 1.5, "P + ½ HD; the Sunday P is an extra day, not a working-day present");
  assert.equal(s1.totals.LE, 1);
  assert.equal(s1.totals.A, 1);
  assert.deepEqual(s1.totals.leaveByType, { CL: 1, ML: 0.5 }, "LE counts its type; a half-day leave counts ½");
  assert.equal(s1.totals.extra, 1);
  assert.equal(s1.cells["2026-09-06"]!.extra, true);
  assert.equal(staffCellText(s1.cells["2026-09-03"]), "CL", "leave shows its type, not LE");
  assert.equal(s1.cells["2026-09-01"]!.way, "self");
  assert.equal(s1.totals.unmarked, 25 - 4, "1–4 Sep marked; the Sunday is not a working day");

  const s2 = v.staff[1]!;
  assert.equal(s2.totals.L, 1, "L is Late");
  assert.equal(s2.totals.present, 2, "late counts present");
  assert.equal(s2.totals.extra, 0.5, "half day on a holiday = ½ extra");
  // 29, 30 Sep: no saved mark, approved CL → shown as leave.
  assert.equal(s2.cells["2026-09-29"]!.fromLeave, true);
  assert.equal(staffCellText(s2.cells["2026-09-30"]), "CL");
  assert.equal(s2.totals.leaveByType.CL, 2);

  const s3 = v.staff[2]!;
  assert.equal(s3.cells["2026-09-02"]!.outside, true, "before joining = not in service");
  assert.equal(staffCellText(s3.cells["2026-09-02"]), "–");
  assert.equal(s3.cells["2026-09-01"]!.s, "P", "a saved mark before joining still shows");
  // 15–30 Sep: 16 days − Sundays 20, 27 − Dussehra 21 = 13, plus 1 Sep,
  // which the register holds a mark for.
  assert.equal(s3.totals.working, 14, "working days count from joining (and any day with a saved mark)");

  // Leave this month: l1 (s1 3 Sep) and l2 (s2 29 Sep – 2 Oct, 2 days in Sep); rejected/out-of-month left out.
  assert.deepEqual(v.leaves.map((l) => [l.id, l.daysInMonth]), [["l1", 1], ["l2", 2]]);
  assert.equal(v.leaves[0]!.approvedBy, "Owner", "a direct leave names who entered it");
  assert.equal(v.leaves[1]!.approvedBy, "The Principal");

  const b2 = v.balances.find((b) => b.staffId === "s2")!.byType.CL!;
  assert.equal(b2.usedToMonthEnd, 3, "Aug 1 + Sep 2 (not Oct, not rejected) — not the stored running total");
  assert.equal(b2.balance, 10 + 1 - 3);
  assert.equal(b2.inMonth, 2);
  const b1 = v.balances.find((b) => b.staffId === "s1")!.byType.CL!;
  assert.equal(b1.usedToMonthEnd, 1, "October's leave is after month end");
  assert.equal(b1.allotted, hr.leaveTypes.find((t) => t.code === "CL")!.defaultDaysPerYear, "no balance row = the type's default");

  // Exports
  const ex = staffMonthRegisterExport(v);
  assert.equal(ex.rows.length, 3);
  assert.equal(ex.rows[0]!.d06, "H/P", "worked on Sunday exports as H/P");
  assert.equal(ex.rows[0]!.d03, "CL");
  assert.equal(ex.rows[0]!.lv_CL, 1);
  assert.equal(ex.rows[0]!.extra, 1);
  assert.ok(ex.columns.some((c) => c.key === "lv_ML"));
  assert.equal(staffLeaveMonthExport(v).rows.length, 2);
  const bal = staffLeaveBalanceExport(v);
  assert.equal(bal.rows.find((r) => r.empCode === "E002")!.CL_bal, 8);
}

{
  // A month in progress: days after today are not counted.
  const v = build("2026-09-10");
  assert.equal(v.days.filter((d) => d.future).length, 20);
  assert.equal(v.staff[0]!.totals.working, 9, "1–10 Sep: 10 days − Sunday the 6th");
}

{
  const self = buildStaffMonthView({
    masters, ay: AY, month: "2026-09", today: "2026-10-15", registers, staff, onlyStaffIds: new Set(["s2"]),
    leaveTypes: hr.leaveTypes, leaveRequests: requests, leaveBalances: [], leaveEncashments: [], overlayLeave: true,
  }) as StaffMonthView;
  assert.deepEqual(self.staff.map((r) => r.id), ["s2"], "a teacher sees only their own row");
  assert.ok(self.leaves.every((l) => l.staffId === "s2"));
  assert.ok("error" in buildStaffMonthView({ masters, ay: AY, month: "2026-13", today: "2026-10-15", registers, staff, leaveTypes: [], leaveRequests: [], leaveBalances: [], leaveEncashments: [], overlayLeave: true }));
  assert.ok("error" in buildStaffMonthView({ masters, ay: AY, month: "2025-09", today: "2026-10-15", registers, staff, leaveTypes: [], leaveRequests: [], leaveBalances: [], leaveEncashments: [], overlayLeave: true }));
}

assert.equal(leaveTypeFromNote("On leave (CL)"), "CL");
assert.equal(leaveTypeFromNote("Half-day leave (ML, morning off) · x"), "ML");
assert.equal(leaveTypeFromNote("Not punched"), "");
assert.deepEqual(staffSessionMonths(masters, AY, "2026-06-10"), ["2026-06", "2026-05", "2026-04"]);

/* ── Owner-only rule ── */
{
  const rbac: RbacState = defaultRbacState();
  const ownerRole = rbac.roles.find((r) => r.code === "owner")!;
  const withOwner: RbacState = {
    ...rbac,
    assignments: [{ id: "a", staffId: "s9", roleId: ownerRole.id, isPrimary: true, scope: { campusIds: [], classIds: [], departmentIds: [] }, expiresOn: "", note: "" }],
  };
  const sess = (o: Partial<{ roleCode: string; staffId: string; email: string }>) => ({ roleCode: "", fullName: "X", persona: "staff" as const, ...o });
  assert.equal(isStaffRegisterOwner(sess({ roleCode: "principal", staffId: "s1" }), withOwner, null), false, "principal is not the owner");
  assert.equal(isStaffRegisterOwner(sess({ roleCode: "office", staffId: "s2" }), withOwner, null), false, "office is not the owner");
  assert.equal(isStaffRegisterOwner(sess({ roleCode: "admin", staffId: "s3" }), withOwner, null), false, "admin is not the owner");
  assert.equal(isStaffRegisterOwner(sess({ roleCode: "owner", staffId: "s3" }), rbac, null), false, "owner is never inferred from a role code");
  assert.equal(isStaffRegisterOwner(sess({ roleCode: "staff", staffId: "s9" }), withOwner, null), true, "owner by Masters → Roles assignment");
  assert.equal(isStaffRegisterOwner(sess({ roleCode: "owner", email: "director@bhbinternational.school" }), rbac, null), true, "protected super admin");

  const stored = [reg("2026-09-01", [mark("s1", "P"), mark("s2", "A")])];
  assert.deepEqual(staffRegisterMarkChanges(stored, stored), [], "the registers as stored change nothing");
  assert.deepEqual(staffRegisterMarkChanges(stored, [reg("2026-09-01", [mark("s1", "P"), mark("s2", "P")])]), ["2026-09-01 s2"]);
  assert.deepEqual(staffRegisterMarkChanges(stored, [reg("2026-09-01", [mark("s1", "P")])]), ["2026-09-01 s2"], "a dropped mark is a change");
  assert.deepEqual(staffRegisterMarkChanges(stored, [reg("2026-09-02", [mark("s1", "P")])]), ["2026-09-02 s1"], "a new register is a change");
  assert.deepEqual(
    staffRegisterMarkChanges(stored, [reg("2026-09-01", [mark("s1", "L"), mark("s2", "A")])], {}),
    [],
    "with stamps, only the named registers are written",
  );
  assert.deepEqual(
    staffRegisterMarkChanges(stored, [{ ...reg("2026-09-01", [mark("s1", "L")]), id: "other" }]),
    [],
    "a second register for a stored day is skipped by the push, so it changes nothing",
  );
  assert.deepEqual(
    staffRegisterMarkChanges(stored, [reg("2026-09-01", [mark("s1", "P", { inTime: "09:30" }), mark("s2", "A")])]),
    ["2026-09-01 s1"],
    "an in-time is part of the mark",
  );
}

console.log("ok");
