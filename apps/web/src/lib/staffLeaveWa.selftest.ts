/**
 * Self-test: staff applying for CL / ML on WhatsApp — reading the ask, the
 * leave master's rules (CL once a month, one day per application, the
 * year's balance), the Leave Without Pay offer, and the approvers' codes.
 * Director's brief, 29 Sep 2026.
 *
 * Run: npx tsx src/lib/staffLeaveWa.selftest.ts
 */

import assert from "node:assert/strict";

import {
  composeLeaveApproverRequest,
  composeLeaveBalances,
  composeLeaveLwpOffer,
  formatLeaveDates,
  isLeaveBalanceAsk,
  leaveDecisionOpen,
  leaveUsedInMonth,
  leaveVerdict,
  parseLeaveApplyStart,
  parseLeaveCodeDecision,
  parseLeaveDates,
  parseLeaveType,
} from "./staffLeaveWa";
import { emptyStaffHrState, type LeaveRequest, type StaffHrState } from "./staffHr";

const TODAY = "2026-09-29"; // a Tuesday

/* ── Reading the ask ───────────────────────────────────────────────── */

{
  const a = parseLeaveApplyStart("CL tomorrow", TODAY);
  assert.deepEqual(a, { typeCode: "CL", dates: { from: "2026-09-30", to: "2026-09-30" }, halfDay: false, halfDaySession: "" });
  const b = parseLeaveApplyStart("ML 2 Oct to 4 Oct fever", TODAY);
  assert.equal(b?.typeCode, "ML");
  assert.deepEqual(b?.dates, { from: "2026-10-02", to: "2026-10-04" });
  const c = parseLeaveApplyStart("kal chutti chahiye", TODAY);
  assert.equal(c?.typeCode, null);
  assert.deepEqual(c?.dates, { from: "2026-09-30", to: "2026-09-30" });
  assert.equal(parseLeaveApplyStart("CL today half day", TODAY)?.halfDay, true);
  assert.ok(parseLeaveApplyStart("apply leave", TODAY), "an application with nothing filled in yet");
  // Not applications: the approvers' queue, a student's leave, the word alone.
  for (const t of ["leave requests", "LEAVE", "approve Riya leave", "pending leave", "8A students on leave", "hello", ""]) {
    assert.equal(parseLeaveApplyStart(t, TODAY), null, t);
  }
}
assert.equal(parseLeaveType("casual leave"), "CL");
assert.equal(parseLeaveType("bukhar hai"), "ML");
assert.equal(parseLeaveType("ML"), "ML");
assert.equal(parseLeaveType("hello"), null);

assert.deepEqual(parseLeaveDates("02/10", TODAY), { from: "2026-10-02", to: "2026-10-02" });
assert.deepEqual(parseLeaveDates("today", TODAY), { from: TODAY, to: TODAY });
assert.deepEqual(parseLeaveDates("4 Oct to 2 Oct", TODAY), { from: "2026-10-02", to: "2026-10-04" }, "a reversed range is put right");
assert.equal(parseLeaveDates("fever", TODAY), null);

for (const t of ["my leave", "leave balance", "kitni CL bachi hai", "meri chutti"]) assert.equal(isLeaveBalanceAsk(t), true, t);
for (const t of ["CL tomorrow", "leave requests", "hello"]) assert.equal(isLeaveBalanceAsk(t), false, t);

/* ── The leave master's rules ──────────────────────────────────────── */

function req(p: Partial<LeaveRequest>): LeaveRequest {
  return {
    id: p.id ?? `r_${Math.random().toString(36).slice(2, 8)}`,
    academicYearCode: "2026-27",
    staffId: "s1",
    typeCode: "CL",
    fromDate: "2026-09-10",
    toDate: "2026-09-10",
    days: 1,
    halfDay: false,
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
  };
}
function stateWith(requests: LeaveRequest[], slUsed = 0): StaffHrState {
  const s = emptyStaffHrState();
  return {
    ...s,
    leaveRequests: requests,
    leaveBalances: [
      { id: "b1", academicYearCode: "2026-27", staffId: "s1", typeCode: "CL", allotted: 12, carriedForward: 0, encashed: 0, used: 1, },
      { id: "b2", academicYearCode: "2026-27", staffId: "s1", typeCode: "ML", allotted: 10, carriedForward: 0, encashed: 0, used: slUsed },
    ],
  };
}
const base = { staffId: "s1", academicYearCode: "2026-27", halfDay: false, todayIso: TODAY };

{
  // CL already taken this month → Leave Without Pay, in the words asked for.
  const v = leaveVerdict({ ...base, state: stateWith([req({})]), typeCode: "CL", from: "2026-09-30", to: "2026-09-30" });
  assert.equal(v.kind, "lwp");
  assert.ok(v.kind === "lwp" && v.why.includes("already used this month's CL entitlement"), JSON.stringify(v));
  // A pending CL in the month counts too; a rejected one does not.
  assert.equal(leaveVerdict({ ...base, state: stateWith([req({ status: "pending" })]), typeCode: "CL", from: "2026-09-30", to: "2026-09-30" }).kind, "lwp");
  assert.equal(leaveVerdict({ ...base, state: stateWith([req({ status: "rejected" })]), typeCode: "CL", from: "2026-09-30", to: "2026-09-30" }).kind, "ok");
  // Another staff member's CL is theirs.
  assert.equal(leaveVerdict({ ...base, state: stateWith([req({ staffId: "s2" })]), typeCode: "CL", from: "2026-09-30", to: "2026-09-30" }).kind, "ok");
  // Next month is a fresh month.
  assert.equal(leaveVerdict({ ...base, state: stateWith([req({})]), typeCode: "CL", from: "2026-10-01", to: "2026-10-01" }).kind, "ok");
}
{
  // CL is one day per application.
  const v = leaveVerdict({ ...base, state: stateWith([]), typeCode: "CL", from: "2026-10-01", to: "2026-10-02" });
  assert.equal(v.kind, "refuse");
  // A day that has ended cannot be applied for; today still can, until midnight.
  assert.equal(leaveVerdict({ ...base, state: stateWith([]), typeCode: "ML", from: "2026-09-28", to: "2026-09-28" }).kind, "refuse");
  assert.equal(leaveVerdict({ ...base, state: stateWith([]), typeCode: "ML", from: TODAY, to: TODAY }).kind, "ok");
  // ML beyond the year's balance → Leave Without Pay.
  const sl = leaveVerdict({ ...base, state: stateWith([], 9), typeCode: "ML", from: "2026-10-01", to: "2026-10-03" });
  assert.equal(sl.kind, "lwp");
  assert.ok(sl.kind === "lwp" && sl.why.includes("only 1 ML day left"), JSON.stringify(sl));
  // Leave Without Pay itself has no caps.
  assert.equal(leaveVerdict({ ...base, state: stateWith([req({})]), typeCode: "LWP", from: "2026-09-30", to: "2026-09-30" }).kind, "ok");
}

const offer = composeLeaveLwpOffer({
  why: "You have already used this month's CL entitlement (1 day)",
  asked: "CL (Casual leave)",
  dates: formatLeaveDates("2026-09-30", "2026-09-30", false),
});
assert.ok(offer.includes("*Leave Without Pay*") && offer.includes("Reply *YES*") && offer.includes("Wed 30 Sep"), offer);

/* ── The approvers ─────────────────────────────────────────────────── */

assert.deepEqual(parseLeaveCodeDecision("LEAVE OK 4821"), { approve: true, code: "4821" });
assert.deepEqual(parseLeaveCodeDecision("leave no #4821"), { approve: false, code: "4821" });
assert.deepEqual(parseLeaveCodeDecision("lv approve 4821"), { approve: true, code: "4821" });
// The 6 PM brief's list positions are not codes.
for (const t of ["LEAVE OK 1", "LEAVE OK 12", "LEAVE", "leave ok", "leave ok 48210"]) assert.equal(parseLeaveCodeDecision(t), null, t);

{
  const msg = composeLeaveApproverRequest({
    code: "4821", staffName: "Riya Verma", empCode: "STF-011", designation: "TGT", typeCode: "LWP",
    dates: "Wed 30 Sep", days: 1, reason: "family function", lwpWhy: "You have already used this month's CL entitlement (1 day)",
  });
  assert.ok(msg.includes("LEAVE OK 4821") && msg.includes("LEAVE NO 4821"), msg);
  assert.ok(msg.includes("Leave without pay") && msg.includes("Leave Without Pay:"), "the approver sees why it is unpaid");
  assert.ok(msg.includes("first reply decides"));
}

// Approvable through the whole of the leave's first day, not after.
assert.equal(leaveDecisionOpen(TODAY, TODAY), true);
assert.equal(leaveDecisionOpen("2026-09-30", TODAY), true);
assert.equal(leaveDecisionOpen("2026-09-28", TODAY), false);

{
  const rs = [req({}), req({ fromDate: "2026-10-05", toDate: "2026-10-05" }), req({ status: "rejected" })];
  assert.equal(leaveUsedInMonth(rs, "s1", "CL", "2026-09"), 1);
  const text = composeLeaveBalances({
    types: emptyStaffHrState().leaveTypes,
    left: { CL: 11, ML: 10, EL: 15 },
    usedThisMonth: { CL: 1 },
  });
  assert.ok(text.includes("CL (Casual leave) — 11 left · this month 1/1 used"), text);
  assert.ok(text.includes("ML (Medical leave) — 10 left"), text);
  assert.ok(!text.includes("LWP"), "no balance line for unpaid leave");
}

console.log("staffLeaveWa.selftest.ts\n  ok");
