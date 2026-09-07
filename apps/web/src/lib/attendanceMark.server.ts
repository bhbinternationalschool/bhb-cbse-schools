/**
 * Marking a section's attendance register, server-side — one path, every
 * caller.
 *
 * Upsert the register, push it to the database, then alert the household of
 * each child marked absent *in this request* (so re-saving a register does
 * not re-alert families who were already told). The v1 route had all of it
 * inline; the ERP command desk needs exactly the same thing, and a second
 * copy is how two near-identical bugs ship.
 *
 * Audit stays with the caller — the route stamps the request's IP and user
 * agent, the command desk stamps the channel and the original message.
 */

import type { DemoSession } from "@/lib/auth";
import type { MastersState } from "@/lib/masters";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureAttendanceHydratedServer } from "@/lib/attendancePersistence";
import {
  upsertRegister,
  type AttendanceMark,
  type AttendanceRegister,
} from "@/lib/attendance";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { loadSis } from "@/lib/sis";
import { classLabel } from "@/lib/homework";
import { sendPushToSubject } from "@/lib/webPush.server";

export type MarkAttendanceInput = {
  session: DemoSession;
  masters: MastersState;
  academicYearCode?: string;
  classId: string;
  sectionId: string;
  date: string;
  marks: AttendanceMark[];
  remark?: string;
};

export type MarkAttendanceResult =
  | {
      ok: true;
      register: AttendanceRegister;
      push: { sent: number; expired: number; failed: number };
    }
  | { ok: false; error: string };

export async function markAttendanceServer(
  input: MarkAttendanceInput,
): Promise<MarkAttendanceResult> {
  await ensureSchoolMirrorHydrated();
  await ensureAttendanceHydratedServer();

  const result = upsertRegister({
    academicYearCode: input.academicYearCode || input.session.academicYearCode,
    campusId: "",
    classId: input.classId,
    sectionId: input.sectionId,
    date: input.date,
    marks: input.marks,
    markedBy: input.session.fullName,
    remark: input.remark || "",
    skipLockCheck: true,
  });
  if (!result.ok) return { ok: false, error: result.error };

  const { pushAttendanceRegisterToDb } = await import(
    "@/lib/attendanceNormalized.server"
  );
  const dbPush = await pushAttendanceRegisterToDb(result.register);
  if (!dbPush.ok) {
    console.warn("[attendanceMark] db push failed", dbPush.error);
  }

  // Absent alert per household — only the marks in THIS request, so
  // re-saving a register doesn't re-alert everyone. Best-effort.
  let push = { sent: 0, expired: 0, failed: 0 };
  try {
    const absent = input.marks.filter((m) => m.status === "A");
    if (absent.length) {
      await ensureSisHydratedServer();
      const sis = loadSis();
      const label = classLabel(input.masters, input.classId, input.sectionId);
      for (const m of absent) {
        const stu = sis.students.find((s) => s.id === m.studentId);
        if (!stu?.householdId) continue;
        const r = await sendPushToSubject("parent", stu.householdId, {
          title: `${stu.fullName} marked absent`,
          body: `${label} · ${input.date}. If this is unexpected, please contact the class teacher.`,
          url: `/attendance?studentId=${encodeURIComponent(stu.id)}`,
          data: { kind: "attendance", studentId: stu.id, date: input.date },
        });
        push = {
          sent: push.sent + r.sent,
          expired: push.expired + r.expired,
          failed: push.failed + r.failed,
        };
      }
    }
  } catch (e) {
    console.warn("[attendanceMark] push failed", (e as Error)?.message);
  }

  return { ok: true, register: result.register, push };
}
