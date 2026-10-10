/**
 * Run: npx tsx src/lib/leaveAllotment.selftest.ts
 */
import assert from "node:assert/strict";
import { applyLeaveAllotment, emptyStaffHrState, normalizeStaffHrState, type StaffHrState } from "@/lib/staffHr";
import { normalizeAttendanceRulesState } from "@/lib/staffAttendanceRules";
import type { StaffRecord } from "@/lib/foundationMasters";

const AY = "2026-27";
const staff = [
  { id: "s1", fullName: "ASHA", empCode: "E1", status: "active" },
  { id: "s2", fullName: "BHOLA", empCode: "E2", status: "active" },
  { id: "s3", fullName: "CHAND", empCode: "E3", status: "active" },
] as unknown as StaffRecord[];
const base: StaffHrState = {
  ...emptyStaffHrState(),
  leaveRequests: [
    // s2 has already taken 3 CL this session.
    { id: "r1", academicYearCode: AY, staffId: "s2", typeCode: "CL", fromDate: "2026-07-01", toDate: "2026-07-03", days: 3, halfDay: false, halfDaySession: "", reason: "", status: "approved", origin: "direct", appliedBy: "", appliedAt: "", decidedBy: "", decidedAt: "", decisionNote: "", level1By: "", level1At: "" },
  ],
} as StaffHrState;
const cl = (st: StaffHrState, id: string) => st.leaveBalances.find((b) => b.staffId === id && b.typeCode === "CL" && b.academicYearCode === AY)!;
const run = (st: StaffHrState, p: Partial<Parameters<typeof applyLeaveAllotment>[1]>) =>
  applyLeaveAllotment(st, { staffIds: [], typeCode: "CL", academicYearCode: AY, mode: "set", days: 0, reason: "policy", changedBy: "director", staff, now: "2026-10-08T09:00:00.000Z", ...p });

// Set: one person 10, another 8 — bulk in one go per value.
let r = run(base, { staffIds: ["s1"], days: 10 });
assert.ok(r.ok);
let st = r.state;
assert.equal(cl(st, "s1").allotted, 10);
r = run(st, { staffIds: ["s2", "s3"], days: 8 });
assert.ok(r.ok);
st = r.state;
assert.deepEqual([cl(st, "s2").allotted, cl(st, "s3").allotted], [8, 8]);
assert.equal(r.changes.length, 2);

// Add / remove, with before → after in the record, newest first.
r = run(st, { staffIds: ["s3"], mode: "add", days: 1.5, reason: "extra duty" });
assert.ok(r.ok);
st = r.state;
assert.equal(cl(st, "s3").allotted, 9.5);
assert.deepEqual(
  { m: st.leaveAllotmentLog[0].mode, b: st.leaveAllotmentLog[0].before, a: st.leaveAllotmentLog[0].after, by: st.leaveAllotmentLog[0].changedBy, why: st.leaveAllotmentLog[0].reason },
  { m: "add", b: 8, a: 9.5, by: "director", why: "extra duty" },
);
r = run(st, { staffIds: ["s1"], mode: "remove", days: 2 });
assert.ok(r.ok);
st = r.state;
assert.equal(cl(st, "s1").allotted, 8);
assert.equal(st.leaveAllotmentLog.length, 5);

// Never below what was already taken — and a bulk change is all or nothing.
r = run(st, { staffIds: ["s1", "s2"], days: 2 });
assert.ok(!r.ok);
assert.match((r as { error: string }).error, /BHOLA \(3 CL taken\)/);
assert.equal(cl(st, "s1").allotted, 8, "refused bulk changed nobody");

// Guards: reason, half days only, nothing-to-change.
assert.ok(!run(st, { staffIds: ["s1"], days: 9, reason: " " }).ok);
assert.ok(!run(st, { staffIds: ["s1"], days: 8.3 }).ok);
assert.ok(!run(st, { staffIds: ["s1"], days: 8 }).ok, "same value records nothing");
assert.ok(!run(st, { staffIds: ["s1"], mode: "add", days: 0 }).ok);

// The record survives a save/load round trip.
const round = normalizeStaffHrState(JSON.parse(JSON.stringify(st)));
assert.equal(round.leaveAllotmentLog.length, 5);
assert.equal(round.leaveAllotmentLog[0].after, 8);

// Attendance rules: the starter rules keep the same ids on every read, so a
// rule picked in "Assign rules to staff" still exists when Assign runs.
const a = normalizeAttendanceRulesState(null).rules.map((x) => x.id);
const b = normalizeAttendanceRulesState(null).rules.map((x) => x.id);
assert.deepEqual(a, b);
assert.deepEqual(a, ["arl_seed_hd_time", "arl_seed_hd_hrs"]);
console.log("leaveAllotment selftest: ok");
