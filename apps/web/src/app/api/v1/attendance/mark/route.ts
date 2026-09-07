import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import {
  assertPermission,
  requestMeta,
  resolveApiAuth,
} from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { assertSectionScope } from "@/lib/api/v1/staffScope";
import { markAttendanceServer } from "@/lib/attendanceMark.server";
import type { AttendanceMark, AttendanceStatus } from "@/lib/attendance";

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
      throw new ApiError(
        "bad_request",
        "classId, sectionId, date, marks required",
        400,
      );
    }

    await ensureSchoolMirrorHydrated();
    // Class teacher, a subject teacher on the section's timetable, or the
    // office — the module permission alone let any staff login mark any class.
    // This is the route's own guard; the command desk checks its own scope.
    await assertSectionScope(ctx, body.classId, body.sectionId);

    const marks: AttendanceMark[] = body.marks.map((m) => ({
      studentId: m.studentId,
      status: m.status,
      note: m.note || "",
    }));

    // Upsert + persist + alert live in one server-side helper, shared with
    // the ERP command desk so both cannot drift apart.
    const result = await markAttendanceServer({
      session: ctx.session,
      masters: ctx.masters,
      academicYearCode: body.academicYearCode,
      classId: body.classId,
      sectionId: body.sectionId,
      date: body.date,
      marks,
      remark: body.remark,
    });
    if (!result.ok) throw new ApiError("bad_request", result.error, 400);

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
      push: result.push,
    });
  } catch (e) {
    return apiErr(e);
  }
}
