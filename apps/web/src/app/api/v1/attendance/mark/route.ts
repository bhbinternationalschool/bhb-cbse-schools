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
    });
  } catch (e) {
    return apiErr(e);
  }
}
