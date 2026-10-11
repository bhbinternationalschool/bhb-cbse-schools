/**
 * Run: npx tsx src/lib/staffLeaveRules.selftest.ts
 */
import assert from "node:assert/strict";
import { emptyStaffHrState, type LeaveRequest, type StaffHrState } from "@/lib/staffHr";
import {
  applyDeskSync,
  approveOnDesk,
  ayMonths,
  canDecide,
  checkApproval,
  computeLeaveBook,
  crossSandwichCharges,
  monthEndBalances,
  planCarryForward,
  planDeskSync,
  requestCharge,
  resolveAllocation,
  resolveApprovers,
  type ApproverRule,
  type CarryForwardRow,
  type DeskTypeLite,
  type IsOffFn,
  type LeavePolicy,
  type StaffLite,
} from "@/lib/staffLeaveRules";

const AY = "2026-27";
// Sundays off, plus a holiday on Wed 14 Oct 2026.
const isOff: IsOffFn = (d) => new Date(`${d}T12:00:00Z`).getUTCDay() === 0 || d === "2026-10-14";

const deskTypes: DeskTypeLite[] = [
  { code: "CL", name: "Casual leave", paid: true },
  { code: "ML", name: "Medical leave", paid: true },
  { code: "LWP", name: "Leave without pay", paid: false },
];
const policy = (over: Partial<Record<string, Partial<LeavePolicy["types"][number]>>> = {}): LeavePolicy => ({
  academicYearCode: AY,
  types: [
    { typeCode: "CL", defaultDays: 10, halfDayAllowed: true, sandwich: false, carryForwardCap: 0, insufficientMode: "block", ...over.CL },
    { typeCode: "ML", defaultDays: 2, halfDayAllowed: false, sandwich: true, carryForwardCap: 5, insufficientMode: "lwp", ...over.ML },
    { typeCode: "LWP", defaultDays: 0, halfDayAllowed: true, sandwich: false, carryForwardCap: 0, insufficientMode: "block", ...over.LWP },
  ],
  allocations: [
    { id: "a1", typeCode: "CL", staffCategory: "contract", staffId: null, days: 6, note: "" },
    { id: "a2", typeCode: "CL", staffCategory: null, staffId: "s3", days: 8, note: "joined late" },
  ],
});
const staff: StaffLite[] = [
  { id: "s1", fullName: "ASHA", category: "permanent", departmentId: "d1", status: "active" },
  { id: "s2", fullName: "BHOLA", category: "contract", departmentId: "d2", status: "active" },
  { id: "s3", fullName: "CHAND", category: "contract", departmentId: "d1", status: "active" },
  { id: "s4", fullName: "GONE", category: "permanent", status: "inactive" },
];
let seq = 0;
const req = (p: Partial<LeaveRequest>): LeaveRequest => ({
  id: p.id ?? `r${++seq}`,
  academicYearCode: AY,
  staffId: "s1",
  typeCode: "CL",
  fromDate: "2026-10-12",
  toDate: "2026-10-12",
  days: 1,
  halfDay: false,
  halfDaySession: "",
  reason: "",
  status: "approved",
  origin: "request",
  appliedBy: "",
  appliedAt: "",
  decidedBy: "",
  decidedAt: "",
  decisionNote: "",
  level1By: "",
  level1At: "",
  ...p,
});

// Allocation precedence: staff > category > default.
const pol = policy();
assert.deepEqual(resolveAllocation(pol, staff[0]!, "CL"), { days: 10, source: "default" });
assert.deepEqual(resolveAllocation(pol, staff[1]!, "CL"), { days: 6, source: "category" });
assert.deepEqual(resolveAllocation(pol, staff[2]!, "CL"), { days: 8, source: "staff" });

// One request: Sat 10 → Tue 13 Oct. Sun 11 is interior.
const span = { staffId: "s1", fromDate: "2026-10-10", toDate: "2026-10-13", halfDay: false };
assert.equal(requestCharge(span, false, isOff).total, 3, "no sandwich: Sunday not counted");
assert.equal(requestCharge(span, true, isOff).total, 4, "sandwich: interior Sunday counted");
// Edge holiday never counts, even with sandwich: Sun 11 → Mon 12.
assert.equal(requestCharge({ ...span, fromDate: "2026-10-11", toDate: "2026-10-12" }, true, isOff).total, 1);
// Half day = 0.5; a half day on a holiday costs nothing.
assert.equal(requestCharge({ ...span, fromDate: "2026-10-12", toDate: "2026-10-12", halfDay: true }, false, isOff).total, 0.5);
assert.equal(requestCharge({ ...span, fromDate: "2026-10-14", toDate: "2026-10-14", halfDay: true }, false, isOff).total, 0);
// Mon 12 → Thu 15 with the Wed holiday inside: 3 without, 4 with sandwich.
assert.equal(requestCharge({ ...span, fromDate: "2026-10-12", toDate: "2026-10-15" }, false, isOff).total, 3);
assert.equal(requestCharge({ ...span, fromDate: "2026-10-12", toDate: "2026-10-15" }, true, isOff).total, 4);

// Cross-request sandwich: Sat 17 + Mon 19 → Sun 18 charged to the Monday request.
const fri = req({ id: "fri", typeCode: "ML", fromDate: "2026-10-17", toDate: "2026-10-17" });
const mon = req({ id: "mon", typeCode: "ML", fromDate: "2026-10-19", toDate: "2026-10-19" });
const cross = crossSandwichCharges([mon, fri], (c) => c === "ML", isOff);
assert.deepEqual(cross.get("mon"), [{ date: "2026-10-18", charge: 1 }]);
assert.equal(cross.get("fri"), undefined);
assert.equal(crossSandwichCharges([fri, mon], () => false, isOff).size, 0, "rule off → no cross charge");
// A working day in the gap breaks it.
assert.equal(
  crossSandwichCharges([fri, req({ id: "tue", typeCode: "ML", fromDate: "2026-10-20", toDate: "2026-10-20" })], () => true, isOff).size,
  0,
);

// The book.
const carry: CarryForwardRow[] = [
  { fromAy: "2025-26", toAy: AY, staffId: "s1", typeCode: "ML", closingBalance: 7, cap: 5, daysCarried: 5 },
];
const requests: LeaveRequest[] = [
  req({ staffId: "s1", typeCode: "CL", fromDate: "2026-10-10", toDate: "2026-10-13" }), // 3 (no sandwich)
  req({ staffId: "s1", typeCode: "CL", fromDate: "2026-11-02", toDate: "2026-11-02", halfDay: true }), // 0.5
  fri,
  mon, // ML 1 + 1 + Sunday 1 = 3
  req({ staffId: "s1", typeCode: "CL", fromDate: "2026-12-01", toDate: "2026-12-02", status: "pending" }),
  req({ staffId: "s1", typeCode: "CL", fromDate: "2026-12-05", toDate: "2026-12-05", status: "rejected" }),
  req({ staffId: "s1", typeCode: "CL", fromDate: "2025-10-06", toDate: "2025-10-06", academicYearCode: "2025-26" }),
  req({ staffId: "s2", typeCode: "LWP", fromDate: "2026-10-12", toDate: "2026-10-16" }),
];
const book = computeLeaveBook({ ay: AY, policy: pol, deskTypes, staff, requests, carry, isOff });
const row = (s: string, t: string) => book.find((b) => b.staffId === s && b.typeCode === t)!;
assert.equal(book.length, 9, "3 active staff × 3 types; inactive left out");
assert.equal(row("s1", "CL").taken, 3.5);
assert.equal(row("s1", "CL").pending, 2);
assert.equal(row("s1", "CL").balance, 6.5);
assert.deepEqual(row("s1", "CL").takenByMonth, { "2026-10": 3, "2026-11": 0.5 });
assert.equal(row("s1", "ML").opening, 5);
assert.equal(row("s1", "ML").taken, 3);
assert.equal(row("s1", "ML").sandwichDays, 1);
assert.equal(row("s1", "ML").balance, 4, "5 carried + 2 − 3");
assert.equal(row("s2", "LWP").governed, false, "unpaid types are never balance-checked");
assert.equal(row("s2", "LWP").taken, 4, "LWP still counts working days (Wed holiday out)");
assert.equal(row("s2", "CL").allocated, 6);

const months = monthEndBalances(row("s1", "CL"), AY);
assert.equal(months.length, 12);
assert.deepEqual(ayMonths(AY).slice(0, 2), ["2026-04", "2026-05"]);
assert.equal(months.find((m) => m.month === "2026-09")!.balance, 10);
assert.equal(months.find((m) => m.month === "2026-10")!.balance, 7);
assert.equal(months.find((m) => m.month === "2027-03")!.balance, 6.5);

// Approving.
// Half day refused where the type does not allow it.
const mlHalf = req({ id: "mlh", staffId: "s1", typeCode: "ML", fromDate: "2026-12-10", toDate: "2026-12-10", halfDay: true, status: "pending" });
const hd = checkApproval({ ay: AY, policy: pol, deskTypes, staff: staff[0]!, requests: [...requests, mlHalf], carry, requestId: "mlh", isOff });
assert.equal(hd.ok, false);
assert.equal(!hd.ok && hd.reason, "half_day_not_allowed");

// Enough balance → ok with what is left.
const okCheck = checkApproval({ ay: AY, policy: pol, deskTypes, staff: staff[0]!, requests, carry, requestId: requests[4]!.id, isOff });
assert.deepEqual(okCheck, { ok: true, charge: 2, remainingAfter: 4.5 });

// Block mode: s2 has 6 CL; 7 working days asked → refused.
const big = req({ id: "big", staffId: "s2", typeCode: "CL", fromDate: "2026-10-19", toDate: "2026-10-26", status: "pending" });
const blocked = checkApproval({ ay: AY, policy: pol, deskTypes, staff: staff[1]!, requests: [big], carry: [], requestId: "big", isOff });
assert.equal(blocked.ok, false);
assert.ok(!blocked.ok && blocked.reason === "insufficient" && blocked.mode === "block" && blocked.split === null);

// LWP mode: s3 (ML 2, no carry) asks Mon 19 → Thu 22 (4 days): 2 paid, rest LWP from Wed 21.
const ml4 = req({ id: "ml4", staffId: "s3", typeCode: "ML", fromDate: "2026-10-19", toDate: "2026-10-22", status: "pending" });
const lwp = checkApproval({ ay: AY, policy: pol, deskTypes, staff: staff[2]!, requests: [ml4], carry: [], requestId: "ml4", isOff });
assert.ok(!lwp.ok && lwp.reason === "insufficient" && lwp.mode === "lwp");
assert.deepEqual(!lwp.ok && lwp.reason === "insufficient" ? lwp.split : null, { paidToDate: "2026-10-20", lwpFromDate: "2026-10-21", paidCharge: 2 });
// Nothing left at all → the whole request becomes LWP.
const used = req({ id: "used", staffId: "s3", typeCode: "ML", fromDate: "2026-09-07", toDate: "2026-09-08" });
const none = checkApproval({ ay: AY, policy: pol, deskTypes, staff: staff[2]!, requests: [used, ml4], carry: [], requestId: "ml4", isOff });
assert.deepEqual(!none.ok && none.reason === "insufficient" ? none.split : null, { paidToDate: null, lwpFromDate: "2026-10-19", paidCharge: 0 });

// approveOnDesk: the split files a paid part and an LWP part, desk used follows.
const desk: StaffHrState = {
  ...emptyStaffHrState(),
  leaveRequests: [ml4],
  leaveBalances: [
    { id: "b1", academicYearCode: AY, staffId: "s3", typeCode: "ML", allotted: 2, carriedForward: 0, encashed: 0, used: 0 },
    { id: "b2", academicYearCode: AY, staffId: "s3", typeCode: "LWP", allotted: 0, carriedForward: 0, encashed: 0, used: 0 },
  ],
};
const now = "2026-10-11T10:00:00.000Z";
const done = approveOnDesk(desk, {
  requestId: "ml4", decidedBy: "Principal", note: "", now, twoLevel: false,
  split: { paidToDate: "2026-10-20", lwpFromDate: "2026-10-21", lwpTypeCode: "LWP" },
});
assert.ok(!("error" in done));
if (!("error" in done)) {
  assert.equal(done.status, "approved");
  assert.equal(done.approved.length, 2);
  const [paid, rest] = done.approved;
  assert.equal(paid!.toDate, "2026-10-20");
  assert.equal(paid!.days, 2);
  assert.equal(rest!.typeCode, "LWP");
  assert.equal(rest!.fromDate, "2026-10-21");
  assert.equal(rest!.toDate, "2026-10-22");
  assert.equal(rest!.status, "approved");
  assert.equal(done.state.leaveBalances.find((b) => b.id === "b1")!.used, 2);
  assert.equal(done.state.leaveBalances.find((b) => b.id === "b2")!.used, 2);
  // Approving again is refused — idempotent at the desk.
  assert.ok("error" in approveOnDesk(done.state, { requestId: "ml4", decidedBy: "x", note: "", now, twoLevel: false }));
}
// Two-level: level 1 only moves it to pending_l2, no balance change.
const l1 = approveOnDesk(desk, { requestId: "ml4", decidedBy: "HOD", note: "ok", now, twoLevel: true });
assert.ok(!("error" in l1) && l1.status === "pending_l2" && l1.approved.length === 0);

// Approvers: staff > department > school; nobody approves themselves.
const rules: ApproverRule[] = [
  { id: "1", scopeKind: "school", scopeId: "", level: 1, approverStaffId: "p1" },
  { id: "2", scopeKind: "department", scopeId: "d1", level: 1, approverStaffId: "hod1" },
  { id: "3", scopeKind: "department", scopeId: "d1", level: 2, approverStaffId: "p1" },
  { id: "4", scopeKind: "staff", scopeId: "s3", level: 1, approverStaffId: "s1" },
];
assert.deepEqual(resolveApprovers(rules, staff[0]!), { level1: ["hod1"], level2: ["p1"], source: "department" });
assert.deepEqual(resolveApprovers(rules, staff[1]!), { level1: ["p1"], level2: [], source: "school" });
assert.deepEqual(resolveApprovers(rules, staff[2]!), { level1: ["s1"], level2: [], source: "staff" });
assert.deepEqual(resolveApprovers([], staff[0]!).source, "none");
const chain = resolveApprovers(rules, staff[0]!);
assert.equal(canDecide({ chain, approverStaffId: "hod1", isLeadership: false, status: "pending", twoLevel: true }), true);
assert.equal(canDecide({ chain, approverStaffId: "hod1", isLeadership: false, status: "pending_l2", twoLevel: true }), false);
assert.equal(canDecide({ chain, approverStaffId: "p1", isLeadership: false, status: "pending_l2", twoLevel: true }), true);
assert.equal(canDecide({ chain, approverStaffId: "p1", isLeadership: false, status: "pending", twoLevel: false }), true);
assert.equal(canDecide({ chain, approverStaffId: "zz", isLeadership: false, status: "pending", twoLevel: false }), false);
assert.equal(canDecide({ chain, approverStaffId: "zz", isLeadership: true, status: "pending", twoLevel: true }), true);

// Carry-forward: capped, rounded down, and idempotent.
const fromBook = computeLeaveBook({ ay: AY, policy: pol, deskTypes, staff, requests, carry, isOff });
const names = new Map(staff.map((s) => [s.id, s.fullName || s.id]));
const plan = planCarryForward({ fromAy: AY, toAy: "2027-28", fromPolicy: pol, fromBook, existingTo: [], staffNames: names });
// ML cap 5: s1 has 4 → 4; s2, s3 have 2 → 2 each. CL has cap 0 → nothing.
assert.deepEqual(plan.rows.map((r) => [r.staffId, r.typeCode, r.daysCarried]), [["s1", "ML", 4], ["s2", "ML", 2], ["s3", "ML", 2]]);
assert.equal(plan.totalDays, 8);
const again = planCarryForward({ fromAy: AY, toAy: "2027-28", fromPolicy: pol, fromBook, existingTo: plan.rows, staffNames: names });
assert.equal(again.rows.length, 0, "second commit carries nothing");
assert.equal(again.alreadyCarried.length, 3);
const capped = planCarryForward({ fromAy: AY, toAy: "2027-28", fromPolicy: policy({ CL: { carryForwardCap: 2.5 } }), fromBook, existingTo: [], staffNames: names });
assert.equal(capped.rows.find((r) => r.staffId === "s1" && r.typeCode === "CL")!.daysCarried, 2.5);

// Policy → desk: allotted/carried follow the book; never below what is used.
const deskState: StaffHrState = {
  ...emptyStaffHrState(),
  leaveBalances: [
    { id: "x1", academicYearCode: AY, staffId: "s1", typeCode: "CL", allotted: 12, carriedForward: 0, encashed: 0, used: 3.5 },
    { id: "x2", academicYearCode: AY, staffId: "s2", typeCode: "CL", allotted: 6, carriedForward: 0, encashed: 0, used: 0 },
    { id: "x3", academicYearCode: AY, staffId: "s3", typeCode: "CL", allotted: 10, carriedForward: 0, encashed: 0, used: 9 },
  ],
};
const sync = planDeskSync({ ay: AY, state: deskState, book });
assert.ok(sync.changes.some((c) => c.staffId === "s1" && c.typeCode === "CL" && c.allottedAfter === 10));
assert.ok(!sync.changes.some((c) => c.staffId === "s2" && c.typeCode === "CL"), "already in line");
assert.deepEqual(sync.refused.map((r) => [r.staffId, r.typeCode]), [["s3", "CL"]]);
assert.ok(!sync.changes.some((c) => c.typeCode === "LWP"));
const synced = applyDeskSync(deskState, { ay: AY, changes: sync.changes, changedBy: "director", now });
assert.equal(synced.leaveBalances.find((b) => b.id === "x1")!.allotted, 10);
assert.equal(synced.leaveBalances.find((b) => b.staffId === "s1" && b.typeCode === "ML")!.carriedForward, 5);
assert.ok(synced.leaveAllotmentLog.some((l) => l.staffId === "s1" && l.before === 12 && l.after === 10 && l.reason === `Leave policy ${AY}`));

console.log("staffLeaveRules selftest: ok");
