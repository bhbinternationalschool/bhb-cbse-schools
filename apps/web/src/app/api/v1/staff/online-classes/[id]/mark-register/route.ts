import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { assertSectionScope } from "@/lib/api/v1/staffScope";
import { markAttendanceServer } from "@/lib/attendanceMark.server";
import { ATTENDANCE_STATUSES, type AttendanceMark, type AttendanceStatus } from "@/lib/attendance";
import { getSession, sectionRoster } from "@/lib/onlineClasses.server";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const CODES = new Set<string>(ATTENDANCE_STATUSES.map((s) => s.code));

/**
 * POST /api/v1/staff/online-classes/:id/mark-register
 *   { marks: [{ studentId, status }], remark? }
 *
 * Writes the section's attendance register for the class's date through
 * the same path the Attendance screen uses. The marks are what the teacher
 * saw and corrected on "Who joined" — the online join only proposed them.
 * Needs attendance.edit, not just online_classes.edit: this is the
 * register, and the register's own permission decides who writes it.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "attendance", "edit");
    await ensureSchoolMirrorHydrated();
    const { id } = await params;
    const s = await getSession(id);
    if (!s) throw new ApiError("not_found", "Class not found", 404);
    if (s.status === "cancelled") {
      throw new ApiError("bad_request", "A cancelled class cannot mark the register", 400);
    }
    await assertSectionScope(ctx, s.classId, s.sectionId);

    const body = (await request.json().catch(() => ({}))) as {
      marks?: { studentId?: unknown; status?: unknown }[];
      remark?: unknown;
    };
    if (!Array.isArray(body.marks) || body.marks.length === 0) {
      throw new ApiError("bad_request", "marks required", 400);
    }
    // Only children of this section, only real codes — the client sends
    // what it showed, but the roster is the server's.
    const roster = new Set(
      (await sectionRoster(s.classId, s.sectionId, s.academicYearCode)).map((c) => c.studentId),
    );
    const marks: AttendanceMark[] = [];
    for (const m of body.marks) {
      const studentId = String(m.studentId ?? "").trim();
      const status = String(m.status ?? "").trim();
      if (!roster.has(studentId)) continue;
      if (!CODES.has(status)) {
        throw new ApiError("bad_request", `Unknown attendance code ${status}`, 400);
      }
      marks.push({ studentId, status: status as AttendanceStatus, note: "" });
    }
    if (marks.length === 0) {
      throw new ApiError("bad_request", "No marks for children of this section", 400);
    }

    const remark = String(body.remark ?? "").trim().slice(0, 300);
    const result = await markAttendanceServer({
      session: ctx.session,
      masters: ctx.masters,
      academicYearCode: s.academicYearCode || undefined,
      classId: s.classId,
      sectionId: s.sectionId,
      date: s.date,
      marks,
      remark: remark || `Online class ${s.startTime}–${s.endTime}`,
    });
    if (!result.ok) throw new ApiError("bad_request", result.error, 400);

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "attendance",
      action: "edit",
      entityType: "register",
      entityId: result.register.id,
      summary: `Marked attendance ${s.date} section ${s.sectionId} from online class ${s.id}`,
      after: {
        date: s.date,
        count: marks.length,
        present: marks.filter((m) => m.status === "P").length,
        onlineClassId: s.id,
      },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return apiOk({
      registerId: result.register.id,
      date: s.date,
      markCount: marks.length,
      present: marks.filter((m) => m.status === "P").length,
      absentAlerts: result.push.sent,
    });
  } catch (e) {
    return apiErr(e);
  }
}
