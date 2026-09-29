/**
 * Deciding a student's leave request, server-side.
 *
 * The ERP screen decides leave in the browser: `decideStudentLeave` mutates
 * local state and `applyLeaveToAttendance` writes registers through the
 * same localStorage-first path. Neither persists off the browser, so the
 * command desk needs its own route to the database — this is it.
 *
 * Since 2026-09-30 it shares the staff route's one-row path
 * (/api/v1/staff/student-leave/decide): the request is read fresh from the
 * database, the decision is written to that one row only while it is still
 * pending (never a whole-desk push from this instance's cache, which prunes
 * what it does not hold), and the leave mark goes only onto registers that
 * already exist, changing that child's line alone. A date with no register
 * — past or future — is left for the teacher; creating one would mark the
 * rest of the class present on a day nobody took attendance.
 */

import type { DemoSession } from "@/lib/auth";
import type { MastersState } from "@/lib/masters";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import {
  loadStudentLeave,
  writeStudentLeaveLocalRaw,
  type StudentLeaveRequest,
} from "@/lib/studentLeave";
import {
  fetchStudentLeaveRequestFromDb,
  recordStudentLeaveDecisionInDb,
  setStudentLeaveAttendanceAppliedInDb,
} from "@/lib/studentLeaveNormalized.server";
import { applyApprovedLeaveToRegisters } from "@/lib/studentLeaveAttendance.server";
import { loadSis } from "@/lib/sis";
import { sendPushToSubject } from "@/lib/webPush.server";

export type DecideLeaveInput = {
  session: DemoSession;
  masters: MastersState;
  requestId: string;
  approve: boolean;
  note?: string;
  todayIso: string;
};

export type DecideLeaveResult =
  | {
      ok: true;
      request: StudentLeaveRequest;
      studentName: string;
      /** Dates whose register was updated with the leave mark. */
      appliedDates: string[];
      /** Future dates with no register yet — left for the teacher to mark. */
      pendingDates: string[];
      pushSent: number;
    }
  | { ok: false; error: string };

export async function decideStudentLeaveServer(
  input: DecideLeaveInput,
): Promise<DecideLeaveResult> {
  await ensureSchoolMirrorHydrated();
  await ensureSisHydratedServer();

  const found = await fetchStudentLeaveRequestFromDb(input.requestId);
  if (!found.ok) return { ok: false, error: "Could not read the leave request — try again" };
  const req = found.request;
  if (!req) return { ok: false, error: "Request not found" };
  if (req.status !== "pending") {
    return { ok: false, error: `Already ${req.status}` };
  }

  const sis = loadSis();
  const student = sis.students.find((s) => s.id === req.studentId);
  if (!student) return { ok: false, error: "Student not found" };

  const decided: StudentLeaveRequest = {
    ...req,
    status: input.approve ? "approved" : "rejected",
    decidedBy: input.session.fullName,
    decidedAt: new Date().toISOString(),
    decisionNote: input.note || "",
    attendanceApplied: false,
  };
  // The decision is the point of the call; if it cannot be stored, say so
  // rather than reporting a decision that will vanish on the next load.
  const saved = await recordStudentLeaveDecisionInDb(decided);
  if (!saved.ok) return { ok: false, error: saved.error || "Could not save the decision" };

  let appliedDates: string[] = [];
  let pendingDates: string[] = [];
  if (input.approve) {
    const applied = await applyApprovedLeaveToRegisters({
      request: decided,
      sectionId: student.sectionId,
    });
    appliedDates = applied.appliedDates;
    pendingDates = [...applied.unmarkedDates, ...applied.failedDates].sort();
    if (appliedDates.length > 0 && pendingDates.length === 0) {
      const flag = await setStudentLeaveAttendanceAppliedInDb(decided.id, true);
      if (flag.ok) decided.attendanceApplied = true;
    }
  }

  // Keep this instance's cache in step, only when it already holds the row.
  const state = loadStudentLeave();
  if (state.requests.some((r) => r.id === decided.id)) {
    writeStudentLeaveLocalRaw({
      ...state,
      requests: state.requests.map((r) => (r.id === decided.id ? decided : r)),
    });
  }

  let pushSent = 0;
  if (student.householdId) {
    const r = await sendPushToSubject("parent", student.householdId, {
      title: `Leave ${decided.status} · ${student.fullName}`,
      body: `${req.fromDate}${req.toDate && req.toDate !== req.fromDate ? ` to ${req.toDate}` : ""} — ${decided.status} by ${input.session.fullName}.`,
      url: "/leave",
      data: { kind: "leave", requestId: decided.id },
    }).catch(() => ({ sent: 0, expired: 0, failed: 0 }));
    pushSent = r.sent;
  }

  return {
    ok: true,
    request: decided,
    studentName: student.fullName,
    appliedDates,
    pendingDates,
    pushSent,
  };
}
