/**
 * Run: npx tsx src/lib/staffRegisterLeave.selftest.ts
 *
 * 3 Oct 2026: two staff on leave were marked "L" — Late — on the register,
 * and every On-leave figure read 0. The register now files a typed leave
 * for "On leave"; these pin the pieces that decide it.
 */
import assert from "node:assert/strict";
import { ATTENDANCE_STATUSES } from "./attendance";
import { approvedLeaveOn, DEFAULT_LEAVE_TYPES, emptyStaffHrState, type LeaveRequest } from "./staffHr";

// L is Late and LE is leave — the shared vocabulary must not drift.
assert.equal(ATTENDANCE_STATUSES.find((s) => s.code === "L")?.label, "Late");
assert.ok(ATTENDANCE_STATUSES.some((s) => s.code === "LE"));

// The school calls it ML; SL must not come back as a default.
const codes = DEFAULT_LEAVE_TYPES.map((t) => t.code);
assert.ok(codes.includes("ML"));
assert.ok(!codes.includes("SL"), "SL was replaced by ML");
const ml = DEFAULT_LEAVE_TYPES.find((t) => t.code === "ML")!;
assert.equal(ml.name, "Medical leave");
assert.equal(ml.maxDaysPerMonth, 0, "ML is a session allotment: any month");
assert.equal(ml.maxDaysPerRequest, 0, "ML may be taken at once or in parts");

// approvedLeaveOn: approved, same year, covering the day — nothing else.
const req = (over: Partial<LeaveRequest>): LeaveRequest => ({
  id: "lv1",
  academicYearCode: "2026-27",
  staffId: "s1",
  typeCode: "ML",
  fromDate: "2026-10-02",
  toDate: "2026-10-04",
  days: 3,
  halfDay: false,
  reason: "",
  status: "approved",
  origin: "direct",
  appliedBy: "",
  appliedAt: "",
  decidedBy: "",
  decidedAt: "",
  decisionNote: "",
  level1By: "",
  level1At: "",
  ...over,
});
const state = (rs: LeaveRequest[]) => ({ ...emptyStaffHrState(), leaveRequests: rs });
assert.equal(approvedLeaveOn(state([req({})]), "s1", "2026-10-03", "2026-27")?.id, "lv1");
assert.equal(approvedLeaveOn(state([req({})]), "s1", "2026-10-05", "2026-27"), null, "outside the dates");
assert.equal(approvedLeaveOn(state([req({ status: "pending" })]), "s1", "2026-10-03", "2026-27"), null, "pending is not leave yet");
assert.equal(approvedLeaveOn(state([req({ status: "rejected" })]), "s1", "2026-10-03", "2026-27"), null);
assert.equal(approvedLeaveOn(state([req({})]), "s2", "2026-10-03", "2026-27"), null, "someone else's");
assert.equal(approvedLeaveOn(state([req({})]), "s1", "2026-10-03", "2025-26"), null, "another session");

console.log("OK — staffRegisterLeave.selftest.ts");
