import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { StudentLeaveRequest } from "./studentLeave";
import { leaveRequestContent, planStudentLeavePush } from "./studentLeavePushPlan";

console.log("studentLeaveStatusGuard.selftest.ts");

/**
 * A leave request leaves "pending" once. An office tab still holding it as
 * pending must not write "pending" back over a teacher's approval or a
 * parent's withdrawal: the desk save writes only what changed, changes only
 * requests still pending in the database, and reports the rest as kept.
 */

const req = (id: string, status: StudentLeaveRequest["status"], extra: Partial<StudentLeaveRequest> = {}): StudentLeaveRequest => ({
  id,
  academicYearCode: "2026-27",
  studentId: "s1",
  fromDate: "2026-10-09",
  toDate: "2026-10-10",
  leaveType: "SL",
  reason: "fever",
  attachmentUrl: "",
  status,
  requestedBy: "parent",
  householdId: "hh1",
  createdAt: "2026-10-08T10:00:00.000Z",
  decidedBy: "",
  decidedAt: "",
  decisionNote: "",
  attendanceApplied: false,
  ...extra,
});

// ── The case: approved on the staff app, the office tab still says pending ──
{
  const stored = new Map([
    ["lr1", req("lr1", "approved", { decidedBy: "t1", decidedAt: "2026-10-09T08:00:00Z", attendanceApplied: true })],
    ["lr2", req("lr2", "cancelled")],
    ["lr3", req("lr3", "pending")],
    ["lr4", req("lr4", "pending")],
  ]);
  const office = [
    req("lr1", "pending"), // stale
    req("lr2", "pending"), // stale: the parent withdrew it
    req("lr3", "pending", { reason: "fever, doctor's note" }), // a real edit
    req("lr4", "pending"), // unchanged
    req("lr5", "pending"), // new
  ];
  const plan = planStudentLeavePush(office, stored);
  assert.deepEqual(plan.kept, ["lr1", "lr2"], "decided and withdrawn requests are kept");
  assert.deepEqual(plan.update.map((r) => r.id), ["lr3"], "only the pending request that changed is written");
  assert.deepEqual(plan.insert.map((r) => r.id), ["lr5"]);
}

// ── The office's own decision on a pending request goes through ────────────
{
  const plan = planStudentLeavePush(
    [req("lr1", "rejected", { decidedBy: "office" })],
    new Map([["lr1", req("lr1", "pending")]]),
  );
  assert.deepEqual(plan.update.map((r) => r.status), ["rejected"]);
  assert.deepEqual(plan.kept, []);
}

// ── A copy equal to the database is not written, whatever its status ───────
{
  const a = req("lr1", "approved", { decidedAt: "2026-10-09T08:00:00Z" });
  const plan = planStudentLeavePush([a, a], new Map([["lr1", { ...a, toDate: "2026-10-10T00:00:00" }]]));
  assert.deepEqual(plan, { insert: [], update: [], kept: [] }, "same content (dates compared by day), duplicates ignored");
  assert.equal(leaveRequestContent(req("x", "pending")), leaveRequestContent({ ...req("x", "pending"), createdAt: "other" }));
}

// ── Wiring ─────────────────────────────────────────────────────────────────
{
  const read = (f: string) => readFileSync(join(__dirname, f), "utf8");
  const push = read("studentLeaveNormalized.server.ts");
  const body = push.slice(push.indexOf("export async function pushStudentLeaveDeskToDb("), push.indexOf("export async function fetchStudentLeaveDeskFromDb("));
  assert.ok(/if \(stored\.error\) return \{ ok: false, error: stored\.error \};/.test(body), "a failed read writes nothing");
  assert.ok(/planStudentLeavePush\(/.test(body));
  assert.ok(/ignoreDuplicates: true/.test(body), "new requests never overwrite one that appeared meanwhile");
  assert.ok(/\.eq\("status", "pending"\)\s*\.select\("id"\)/.test(body), "changes are conditional on still pending");
  assert.ok(/kept\.push\(req\.id\)/.test(body), "a request decided between read and write is kept");
  assert.equal(/requests\.map\(\(req\) => requestToRow/.test(body), false, "no blanket upsert of the whole desk");
  assert.ok(/return \{ ok: true, kept \}/.test(body));
  const route = read("../app/api/school-data/student-leave-desk/route.ts");
  assert.ok(/const kept = result\.kept \?\? \[\];/.test(route) && /ok: true,\s*kept,/.test(route), "the desk route reports kept requests");
  assert.ok(/body\.kept\?\.length/.test(read("studentLeaveNormalizedClient.ts")) && /resetDeskHydrated\("student_leave"\)/.test(read("studentLeaveNormalizedClient.ts")), "the browser reloads on kept");
  assert.ok(/pushed\.kept\?\.includes\(id\)/.test(read("../app/api/v1/leave/cancel/route.ts")), "a parent's late cancel is told the decision stands");
}

console.log("studentLeaveStatusGuard.selftest: all assertions passed");
