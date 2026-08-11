import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureAttendanceHydratedServer } from "@/lib/attendancePersistence";
import { ensureTimetableHydratedServer } from "@/lib/timetablePersistence";
import { findRegister, loadAttendance } from "@/lib/attendance";
import { loadTimetable, teachingPeriods } from "@/lib/timetable";
import { loadSis } from "@/lib/sis";

export const runtime = "nodejs";

function todayInKolkata(): { date: string; weekday: number } {
  const now = new Date();
  const date = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const dayName = now.toLocaleDateString("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
  });
  const weekday =
    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(dayName);
  return { date, weekday };
}

/**
 * GET /api/v1/staff/summary — the teacher home screen payload: who I am,
 * which section I'm class teacher of (with today's attendance status),
 * and my periods today from the published timetable.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }

    const url = new URL(request.url);
    // session.staffId is set by real Supabase logins; dev/demo sessions may
    // pass ?staffId= instead. Many schools haven't synced the staff roster
    // to the DB yet, so a missing record degrades gracefully: the app then
    // offers a class/section picker instead of a class-teacher banner.
    const staffId =
      ctx.session.staffId || url.searchParams.get("staffId")?.trim() || "";
    const staff = staffId
      ? ctx.masters.staff.find((s) => s.id === staffId) || null
      : null;

    await ensureSchoolMirrorHydrated();
    await Promise.all([
      ensureTimetableHydratedServer(),
      ensureAttendanceHydratedServer(),
    ]);

    const ay = ctx.session.academicYearCode;
    const { date, weekday } = todayInKolkata();

    const classNameOf = (id: string) =>
      ctx.masters.classes.find((c) => c.id === id)?.name || "";
    const sectionNameOf = (id: string) =>
      ctx.masters.sections.find((s) => s.id === id)?.name || "";
    const subjectNameOf = (id: string) =>
      ctx.masters.subjects.find((s) => s.id === id)?.nameEn || "";

    // Class teacher section (primary link for this AY first).
    const links = (staff?.classTeacherLinks || []).filter(
      (l) => !l.academicYearCode || l.academicYearCode === ay,
    );
    const primary = links.find((l) => l.isPrimary) || links[0] || null;

    let classTeacherOf: Record<string, unknown> | null = null;
    if (primary) {
      const sis = loadSis();
      const students = sis.students.filter(
        (s) =>
          s.status === "active" &&
          s.classId === primary.classId &&
          s.sectionId === primary.sectionId &&
          s.academicYearCode === ay,
      );
      const register = findRegister(ay, primary.sectionId, date, loadAttendance());
      classTeacherOf = {
        classId: primary.classId,
        sectionId: primary.sectionId,
        className: classNameOf(primary.classId),
        sectionName: sectionNameOf(primary.sectionId),
        studentCount: students.length,
        attendanceDate: date,
        attendanceMarked: !!register,
        markedCount: register?.marks.length ?? 0,
      };
    }

    // Today's periods across published grids (fallback: working grids).
    const tt = loadTimetable();
    const grids = tt.publishedGrids.length ? tt.publishedGrids : tt.grids;
    const bell = teachingPeriods(tt.bellTemplate);
    const bellByNo = new Map(bell.map((b) => [b.no, b]));

    const periods = grids
      .filter((g) => !g.academicYearCode || g.academicYearCode === ay)
      .flatMap((g) =>
        g.slots
          .filter((s) => s.teacherId === staffId && s.weekday === weekday)
          .map((s) => ({
            periodNo: s.periodNo,
            startTime: bellByNo.get(s.periodNo)?.startTime || "",
            endTime: bellByNo.get(s.periodNo)?.endTime || "",
            subjectName: subjectNameOf(s.subjectId),
            classId: g.classId,
            sectionId: g.sectionId,
            className: classNameOf(g.classId),
            sectionName: sectionNameOf(g.sectionId),
          })),
      )
      .sort((a, b) => a.periodNo - b.periodNo);

    // Active classes with their sections — the app's class/section picker
    // for teachers without a class-teacher link (or for other sections).
    const classes = ctx.masters.classes
      .filter((c) => c.isActive !== false)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((c) => ({
        id: c.id,
        name: c.name,
        sections: ctx.masters.sections
          .filter((s) => s.classId === c.id && s.isActive !== false)
          .map((s) => ({ id: s.id, name: s.name })),
      }));

    return apiOk({
      staff: staff
        ? {
            id: staff.id,
            fullName: staff.fullName,
            empCode: staff.empCode,
            photoUrl: staff.photoUrl || null,
          }
        : null,
      fullName: staff?.fullName || ctx.session.fullName,
      date,
      weekday,
      academicYearCode: ay,
      classTeacherOf,
      periodsToday: periods,
      classes,
    });
  } catch (e) {
    return apiErr(e);
  }
}
