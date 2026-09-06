/**
 * Deciding a student's leave request, server-side.
 *
 * The ERP screen decides leave in the browser: `decideStudentLeave` mutates
 * local state and `applyLeaveToAttendance` writes registers through the
 * same localStorage-first path. Neither persists off the browser, so the
 * command desk needs its own route to the database — this is it.
 *
 * One deliberate difference from the browser path. `applyLeaveToAttendance`
 * creates a register for every date in the range, marking every *other*
 * child present. For leave approved in advance that pre-marks a whole class
 * present on days nobody has taught yet, which then reads as "attendance
 * done" in the summary. Here, a future date is only touched when its
 * register already exists; the caller is told how many dates were left for
 * the teacher to mark normally.
 */

import type { DemoSession } from "@/lib/auth";
import type { MastersState } from "@/lib/masters";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureAttendanceHydratedServer } from "@/lib/attendancePersistence";
import { ensureStudentLeaveHydratedServer } from "@/lib/studentLeavePersistence";
import {
  findRegister,
  loadAttendance,
  upsertRegister,
  writeAttendanceLocalRaw,
  type AttendanceStatus,
} from "@/lib/attendance";
import {
  STUDENT_LEAVE_TYPES,
  loadStudentLeave,
  writeStudentLeaveLocalRaw,
  type StudentLeaveRequest,
} from "@/lib/studentLeave";
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

function daysBetween(fromDate: string, toDate: string): string[] {
  const out: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) return out;
  const end = /^\d{4}-\d{2}-\d{2}$/.test(toDate) ? toDate : fromDate;
  const d = new Date(`${fromDate}T00:00:00Z`);
  const stop = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || Number.isNaN(stop.getTime())) return out;
  // A runaway range must not spin forever; a term's leave is well under this.
  for (let i = 0; i <= 120 && d <= stop; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export async function decideStudentLeaveServer(
  input: DecideLeaveInput,
): Promise<DecideLeaveResult> {
  await ensureSchoolMirrorHydrated();
  await ensureStudentLeaveHydratedServer();

  const state = loadStudentLeave();
  const i = state.requests.findIndex((r) => r.id === input.requestId);
  if (i < 0) return { ok: false, error: "Request not found" };
  const req = state.requests[i]!;
  if (req.status !== "pending") {
    return { ok: false, error: `Already ${req.status}` };
  }

  const sis = loadSis();
  const student = sis.students.find((s) => s.id === req.studentId);
  if (!student) return { ok: false, error: "Student not found" };

  const appliedDates: string[] = [];
  const pendingDates: string[] = [];

  if (input.approve) {
    await ensureAttendanceHydratedServer();
    const typeMeta = STUDENT_LEAVE_TYPES.find((t) => t.code === req.leaveType);
    const status: AttendanceStatus = typeMeta?.attendance ?? "LE";
    const note = `Leave ${req.leaveType}: ${req.reason}`.slice(0, 120);
    const roster = sis.students.filter(
      (st) =>
        st.status === "active" &&
        st.sectionId === student.sectionId &&
        st.academicYearCode === req.academicYearCode,
    );
    const { pushAttendanceRegisterToDb } = await import(
      "@/lib/attendanceNormalized.server"
    );
    for (const date of daysBetween(req.fromDate, req.toDate)) {
      const existing = findRegister(
        req.academicYearCode,
        student.sectionId,
        date,
        loadAttendance(),
      );
      // Future dates with no register are the teacher's to mark; creating
      // one here would mark the rest of the class present in advance.
      if (!existing && date > input.todayIso) {
        pendingDates.push(date);
        continue;
      }
      if (!roster.length) {
        pendingDates.push(date);
        continue;
      }
      const marks = roster.map((st) => {
        if (st.id === student.id) return { studentId: st.id, status, note };
        const prev = existing?.marks.find((m) => m.studentId === st.id);
        return {
          studentId: st.id,
          status: prev?.status ?? ("P" as AttendanceStatus),
          note: prev?.note ?? "",
        };
      });
      const res = upsertRegister({
        academicYearCode: req.academicYearCode,
        campusId: "",
        classId: student.classId,
        sectionId: student.sectionId,
        date,
        marks,
        markedBy: input.session.fullName,
        remark: `Leave ${req.leaveType} applied`,
        skipLockCheck: true,
      });
      if (!res.ok) {
        pendingDates.push(date);
        continue;
      }
      // upsertRegister saves through the browser path, so mirror the change
      // into the server cache before pushing it.
      const cur = loadAttendance();
      const registers = cur.registers.some((x) => x.id === res.register.id)
        ? cur.registers.map((x) => (x.id === res.register.id ? res.register : x))
        : [res.register, ...cur.registers];
      writeAttendanceLocalRaw({ ...cur, registers });
      const push = await pushAttendanceRegisterToDb(res.register);
      if (!push.ok) {
        console.warn("[leaveDecide] register push failed", push.error);
      }
      appliedDates.push(date);
    }
  }

  const decided: StudentLeaveRequest = {
    ...req,
    status: input.approve ? "approved" : "rejected",
    decidedBy: input.session.fullName,
    decidedAt: new Date().toISOString(),
    decisionNote: input.note || "",
    attendanceApplied: input.approve && appliedDates.length > 0,
  };
  const requests = [...state.requests];
  requests[i] = decided;
  const nextState = { ...state, requests };
  writeStudentLeaveLocalRaw(nextState);

  const { pushStudentLeaveDeskToDb } = await import(
    "@/lib/studentLeaveNormalized.server"
  );
  const dbPush = await pushStudentLeaveDeskToDb(nextState);
  if (!dbPush.ok) {
    // The decision is the point of the call; if it cannot be stored, say so
    // rather than reporting a decision that will vanish on the next load.
    return { ok: false, error: dbPush.error || "Could not save the decision" };
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
