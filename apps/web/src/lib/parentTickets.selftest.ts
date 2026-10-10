/**
 * Self-test: what the parent app's leave and complaint routes lean on —
 * the household ticket union, and the leave rules the request route
 * inherits from createStudentLeaveRequest.
 * Run: npx tsx apps/web/src/lib/parentTickets.selftest.ts
 */

import assert from "node:assert/strict";
import { mergeTicketsForHousehold, type ComplaintTicket } from "@/lib/complaints";
import { createStudentLeaveRequest } from "@/lib/studentLeave";

function ticket(over: Partial<ComplaintTicket>): ComplaintTicket {
  return {
    id: "t",
    householdId: "hh_a",
    studentId: null,
    raisedByName: "P",
    raisedByMobile: "",
    category: "other",
    subject: "s",
    description: "d",
    date: "2026-09-04",
    assignedToStaffId: null,
    dueByDate: null,
    status: "open",
    resolutionNote: "",
    resolvedAt: null,
    source: "parent_portal",
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z",
    ...over,
  };
}

// --- complaints: office copy wins by id, intake fills the gaps, other
// households never leak, newest first.
{
  const office = [
    ticket({ id: "c1", status: "resolved", resolutionNote: "fixed", createdAt: "2026-09-01T00:00:00Z" }),
    ticket({ id: "c9", householdId: "hh_b" }),
  ];
  const intake = [
    ticket({ id: "c1", status: "open", createdAt: "2026-09-01T00:00:00Z" }),
    ticket({ id: "c2", createdAt: "2026-09-03T00:00:00Z" }),
    ticket({ id: "c8", householdId: "hh_b" }),
  ];
  const mine = mergeTicketsForHousehold(office, intake, "hh_a");
  assert.deepEqual(mine.map((t) => t.id), ["c2", "c1"]);
  assert.equal(mine[1]!.status, "resolved", "office triage must win over intake");
  assert.equal(mine[1]!.resolutionNote, "fixed");
  assert.deepEqual(mergeTicketsForHousehold(office, intake, "hh_none"), []);
}

// --- leave: the rules the route relies on (its own save is a server no-op,
// which is why the route folds the request into state itself).
{
  const base = {
    academicYearCode: "2026-27",
    studentId: "stu_1",
    requestedBy: "Parent",
    householdId: "hh_a",
  };
  const ok = createStudentLeaveRequest({ ...base, fromDate: "2026-09-08", toDate: "2026-09-09", leaveType: "SL", reason: "Fever" });
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.request.status, "pending");
    assert.equal(ok.request.householdId, "hh_a");
    assert.equal(ok.request.toDate, "2026-09-09");
  }
  const halfDay = createStudentLeaveRequest({ ...base, fromDate: "2026-09-08", toDate: "2026-09-09", leaveType: "HD_AM", reason: "Doctor" });
  assert.ok(!halfDay.ok, "half-day leave must be a single date");
  const backwards = createStudentLeaveRequest({ ...base, fromDate: "2026-09-09", toDate: "2026-09-08", leaveType: "SL", reason: "x" });
  assert.ok(!backwards.ok, "to date before from date must be refused");
  const noReason = createStudentLeaveRequest({ ...base, fromDate: "2026-09-08", toDate: "", leaveType: "SL", reason: "  " });
  assert.ok(!noReason.ok, "reason is required");
  const single = createStudentLeaveRequest({ ...base, fromDate: "2026-09-08", toDate: "", leaveType: "SL", reason: "x" });
  assert.ok(single.ok && single.request.toDate === "2026-09-08", "blank toDate means the same day");
}

console.log("parentTickets.selftest: ok");
