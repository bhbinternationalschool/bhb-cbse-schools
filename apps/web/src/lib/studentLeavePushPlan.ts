/**
 * Which requests a student leave desk save may write.
 *
 * The save carries the whole desk, and every request in it used to be
 * upserted — so an office tab still holding a request as "pending" wrote
 * "pending" back over the approval a teacher gave on the staff app, or over
 * the parent's withdrawal from the parent app.
 *
 * A request has one open state: pending. Approved, rejected and cancelled
 * are final, and nothing in the ERP edits a request once it leaves pending.
 * So:
 *  - a request the database lacks is inserted (never over one that appears
 *    meanwhile);
 *  - a request whose copy matches the database is not written at all;
 *  - a request that is still pending in the database may be changed — and
 *    the write itself is conditional on it still being pending;
 *  - a request the database holds as decided or withdrawn is kept as it is,
 *    and reported back so the browser reloads.
 */

import type { StudentLeaveRequest } from "@/lib/studentLeave";

const FIELDS: (keyof StudentLeaveRequest)[] = [
  "academicYearCode",
  "studentId",
  "fromDate",
  "toDate",
  "leaveType",
  "reason",
  "attachmentUrl",
  "status",
  "requestedBy",
  "householdId",
  "decidedBy",
  "decidedAt",
  "decisionNote",
  "attendanceApplied",
];

/** The fields a save can change, compared as the database stores them. */
export function leaveRequestContent(r: StudentLeaveRequest): string {
  return JSON.stringify(
    FIELDS.map((f) => {
      const v = r[f];
      if (f === "attendanceApplied") return !!v;
      if (f === "fromDate" || f === "toDate") return String(v ?? "").slice(0, 10);
      return v == null ? "" : String(v);
    }),
  );
}

export type StudentLeavePushPlan = {
  /** Not in the database: insert, never overwrite. */
  insert: StudentLeaveRequest[];
  /** Pending in the database and changed by this save: update while still pending. */
  update: StudentLeaveRequest[];
  /** Decided or withdrawn in the database and different here: not written. */
  kept: string[];
};

export function planStudentLeavePush(
  incoming: StudentLeaveRequest[],
  stored: Map<string, StudentLeaveRequest>,
): StudentLeavePushPlan {
  const plan: StudentLeavePushPlan = { insert: [], update: [], kept: [] };
  const seen = new Set<string>();
  for (const r of incoming) {
    if (!r?.id || seen.has(r.id)) continue;
    seen.add(r.id);
    const cur = stored.get(r.id);
    if (!cur) plan.insert.push(r);
    else if (leaveRequestContent(r) === leaveRequestContent(cur)) continue;
    else if (cur.status === "pending") plan.update.push(r);
    else plan.kept.push(r.id);
  }
  return plan;
}
