import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureAttendanceHydratedServer } from "@/lib/attendancePersistence";
import { findRegister, loadAttendance } from "@/lib/attendance";
import { loadSis } from "@/lib/sis";

export const runtime = "nodejs";

/**
 * GET /api/v1/attendance/roster?classId=&sectionId=&date=YYYY-MM-DD
 * Students of a section (sorted by roll) plus any existing marks for the
 * date — the attendance-marking screen loads exactly this.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "attendance", "view");

    const url = new URL(request.url);
    const classId = url.searchParams.get("classId")?.trim() || "";
    const sectionId = url.searchParams.get("sectionId")?.trim() || "";
    const date = url.searchParams.get("date")?.trim() || "";
    if (!classId || !sectionId || !date) {
      throw new ApiError("bad_request", "classId, sectionId, date required", 400);
    }

    await ensureSchoolMirrorHydrated();
    await ensureAttendanceHydratedServer();

    const ay = ctx.session.academicYearCode;
    const sis = loadSis();
    const students = sis.students
      .filter(
        (s) =>
          s.status === "active" &&
          s.classId === classId &&
          s.sectionId === sectionId &&
          s.academicYearCode === ay,
      )
      .sort((a, b) => {
        const ra = parseInt(a.rollNo, 10) || 9999;
        const rb = parseInt(b.rollNo, 10) || 9999;
        return ra - rb || a.fullName.localeCompare(b.fullName);
      });

    const register = findRegister(ay, sectionId, date, loadAttendance());
    const markByStudent = new Map(
      (register?.marks ?? []).map((m) => [m.studentId, m.status]),
    );

    return apiOk({
      classId,
      sectionId,
      date,
      academicYearCode: ay,
      attendanceMarked: !!register,
      students: students.map((s) => ({
        id: s.id,
        fullName: s.fullName,
        rollNo: s.rollNo,
        photoUrl: s.photoUrl || null,
        status: markByStudent.get(s.id) ?? null,
      })),
    });
  } catch (e) {
    return apiErr(e);
  }
}
