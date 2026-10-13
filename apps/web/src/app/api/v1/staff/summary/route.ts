import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureAttendanceHydratedServer } from "@/lib/attendancePersistence";
import { findRegister, loadAttendance } from "@/lib/attendance";
import { readTimetableStateServer } from "@/lib/api/v1/teachingServer.server";
import { staffPeriodsOn } from "@/lib/api/v1/staffTimetableView";
import { loadSisForStaff, studentsInSession } from "@/lib/sis";
import { staffSectionScope } from "@/lib/api/v1/staffScope";
import { attendanceCoverToday } from "@/lib/attendanceCover.server";

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
 *
 * The timetable is read from its desk slices (until 13 Oct 2026 this read
 * loadTimetable(), empty on the server, so "Today's periods" was always
 * empty). A failed read is a 503, not "no periods today". Published grids
 * only — the home screen shows no "draft" label, and a draft grid grants no
 * section (timetableScope.server.ts); `timetablePublished: false` says why
 * the list is empty.
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
    const [tt] = await Promise.all([
      readTimetableStateServer(),
      ensureAttendanceHydratedServer(),
    ]);

    const scope = await staffSectionScope(ctx);
    const ay = scope.academicYearCode;
    const cover = scope.unrestricted ? [] : await attendanceCoverToday(ctx, ay);
    const { date, weekday } = todayInKolkata();

    const classNameOf = (id: string) =>
      ctx.masters.classes.find((c) => c.id === id)?.name || "";
    const sectionNameOf = (id: string) =>
      ctx.masters.sections.find((s) => s.id === id)?.name || "";

    // Class teacher section (primary link for this AY first).
    const links = (staff?.classTeacherLinks || []).filter((l) =>
      scope.classTeacherOf.has(`${l.classId}|${l.sectionId}`),
    );
    const primary = links.find((l) => l.isPrimary) || links[0] || null;

    let classTeacherOf: Record<string, unknown> | null = null;
    if (primary) {
      const students = studentsInSession(loadSisForStaff(), ay).filter(
        (s) => s.classId === primary.classId && s.sectionId === primary.sectionId,
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

    // Today's periods: published grids only (see above).
    const today = staffPeriodsOn(tt, ctx.masters, { staffId, academicYearCode: ay, weekday });
    const periods = today.periods.map((p) => ({
      periodNo: p.periodNo,
      startTime: p.startTime,
      endTime: p.endTime,
      subjectName: p.subjectName,
      classId: p.classId,
      sectionId: p.sectionId,
      className: p.className,
      sectionName: p.sectionName,
    }));

    // The app's class/section picker. It used to be every class in the
    // school for everyone, so a teacher picked any class and was refused on
    // save. Now: the principal and office see the school; a teacher sees
    // only the sections they teach (class teacher first).
    const classes = scope.unrestricted
      ? ctx.masters.classes
          .filter((c) => c.isActive !== false)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((c) => ({
            id: c.id,
            name: c.name,
            sections: ctx.masters.sections
              .filter((s) => s.classId === c.id && s.isActive !== false)
              .map((s) => ({ id: s.id, name: s.name })),
          }))
          .filter((c) => c.sections.length > 0)
      : (() => {
          const byClass = new Map<string, { id: string; name: string; sections: { id: string; name: string }[] }>();
          for (const t of scope.teaching) {
            let c = byClass.get(t.classId);
            if (!c) {
              c = { id: t.classId, name: t.className, sections: [] };
              byClass.set(t.classId, c);
            }
            c.sections.push({ id: t.sectionId, name: t.sectionName });
          }
          // Today's attendance cover — a substitute or the class's
          // co-ordinator while its teacher is away (13 Oct 2026). Named
          // "· cover today" so the teacher knows why it is there; any other
          // screen using this picker refuses it on save.
          for (const cv of cover) {
            let c = byClass.get(cv.classId);
            if (!c) {
              c = { id: cv.classId, name: classNameOf(cv.classId), sections: [] };
              byClass.set(cv.classId, c);
            }
            if (!c.sections.some((x) => x.id === cv.sectionId)) {
              c.sections.push({ id: cv.sectionId, name: `${sectionNameOf(cv.sectionId)} · cover today` });
            }
          }
          return [...byClass.values()];
        })();

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
      timetablePublished: today.published,
      classes,
      // Newer clients: each of my sections with MY subjects in it.
      teaching: scope.teaching,
      unrestricted: scope.unrestricted,
      homeKind: scope.kind,
    });
  } catch (e) {
    return apiErr(e);
  }
}
