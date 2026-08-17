import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk } from "@/lib/api/v1/errors";
import {
  assertPermission,
  requestMeta,
  resolveApiAuth,
} from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureAttendanceHydratedServer } from "@/lib/attendancePersistence";
import { upsertRegister, type AttendanceMark, type AttendanceStatus } from "@/lib/attendance";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { loadSis } from "@/lib/sis";
import { classLabel } from "@/lib/homework";
import { sendPushToSubject } from "@/lib/webPush.server";

export const runtime = "nodejs";

type MarkBody = {
  academicYearCode?: string;
  classId: string;
  sectionId: string;
  date: string;
  marks: { studentId: string; status: AttendanceStatus; note?: string }[];
  remark?: string;
};

/** POST /api/v1/attendance/mark — bulk mark a section register */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertPermission(ctx, "attendance", "edit");

    const body = (await request.json()) as MarkBody;
    if (!body.sectionId || !body.classId || !body.date || !body.marks?.length) {
      const { ApiError } = await import("@/lib/api/v1/errors");
      throw new ApiError("bad_request", "classId, sectionId, date, marks required", 400);
    }

    await ensureSchoolMirrorHydrated();
    await ensureAttendanceHydratedServer();

    const marks: AttendanceMark[] = body.marks.map((m) => ({
      studentId: m.studentId,
      status: m.status,
      note: m.note || "",
    }));

    const result = upsertRegister({
      academicYearCode: body.academicYearCode || ctx.session.academicYearCode,
      campusId: "",
      classId: body.classId,
      sectionId: body.sectionId,
      date: body.date,
      marks,
      markedBy: ctx.session.fullName,
      remark: body.remark || "",
      skipLockCheck: true,
    });

    if (!result.ok) {
      const { ApiError } = await import("@/lib/api/v1/errors");
      throw new ApiError("bad_request", result.error, 400);
    }

    const { pushAttendanceRegisterToDb } = await import(
      "@/lib/attendanceNormalized.server"
    );
    const dbPush = await pushAttendanceRegisterToDb(result.register);
    if (!dbPush.ok) {
      console.warn("[attendance-v1] db push failed", dbPush.error);
    }

    // Absent alert to each absent child's household — only for the marks
    // in THIS request that are absent, so re-saving a register doesn't
    // re-alert everyone. Best-effort.
    let push = { sent: 0, expired: 0, failed: 0 };
    try {
      const absent = marks.filter((m) => m.status === "A");
      if (absent.length) {
        await ensureSisHydratedServer();
        const sis = loadSis();
        const label = classLabel(ctx.masters, body.classId, body.sectionId);
        for (const m of absent) {
          const stu = sis.students.find((s) => s.id === m.studentId);
          if (!stu?.householdId) continue;
          const r = await sendPushToSubject("parent", stu.householdId, {
            title: `${stu.fullName} marked absent`,
            body: `${label} · ${body.date}. If this is unexpected, please contact the class teacher.`,
            url: `/attendance?studentId=${encodeURIComponent(stu.id)}`,
            data: { kind: "attendance", studentId: stu.id, date: body.date },
          });
          push = {
            sent: push.sent + r.sent,
            expired: push.expired + r.expired,
            failed: push.failed + r.failed,
          };
        }
      }
    } catch (e) {
      console.warn("[attendance-v1] push failed", (e as Error)?.message);
    }

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "attendance",
      action: "edit",
      entityType: "register",
      entityId: result.register.id,
      summary: `Marked attendance ${body.date} section ${body.sectionId}`,
      after: { date: body.date, count: marks.length },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return apiOk({
      registerId: result.register.id,
      date: body.date,
      markCount: marks.length,
      push,
    });
  } catch (e) {
    return apiErr(e);
  }
}
