import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureTimetableHydratedServer } from "@/lib/timetablePersistence";
import { loadTimetable, teachingPeriods, WEEKDAY_SHORT } from "@/lib/timetable";

export const runtime = "nodejs";

const WEEKDAY_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function istToday(): { date: string; weekday: number } {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return {
    date: ist.toISOString().slice(0, 10),
    weekday: ist.getUTCDay(),
  };
}

/** Monday..Sunday dates of the ISO week containing `date` (YYYY-MM-DD). */
function weekDates(date: string): string[] {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0 = Sun
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - ((dow + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(monday);
    x.setUTCDate(monday.getUTCDate() + i);
    return x.toISOString().slice(0, 10);
  });
}

/**
 * GET /api/v1/staff/timetable — the signed-in staff member's week from the
 * published grids (working grids when nothing is published yet), with the
 * bell times, plus this week's substitutions that touch them either way.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "timetable", "view");

    const url = new URL(request.url);
    const staffId =
      ctx.session.staffId || url.searchParams.get("staffId")?.trim() || "";
    if (!staffId) {
      throw new ApiError("bad_request", "No staff record on this session", 400);
    }

    await ensureSchoolMirrorHydrated();
    await ensureTimetableHydratedServer();

    const ay = ctx.session.academicYearCode;
    const tt = loadTimetable();
    const published = tt.publishedGrids.length > 0;
    const grids = (published ? tt.publishedGrids : tt.grids).filter(
      (g) => !g.academicYearCode || g.academicYearCode === ay,
    );
    const bell = teachingPeriods(tt.bellTemplate);
    const bellByNo = new Map(bell.map((b) => [b.no, b]));

    const classNameOf = (id: string) =>
      ctx.masters.classes.find((c) => c.id === id)?.name || "";
    const sectionNameOf = (id: string) =>
      ctx.masters.sections.find((s) => s.id === id)?.name || "";
    const subjectNameOf = (id: string) =>
      ctx.masters.subjects.find((s) => s.id === id)?.nameEn || "";
    const staffNameOf = (id: string) =>
      ctx.masters.staff.find((s) => s.id === id)?.fullName || "";

    const weekdays = (tt.workingWeekdays.length ? tt.workingWeekdays : [1, 2, 3, 4, 5, 6])
      .slice()
      .sort((a, b) => a - b);

    const days = weekdays.map((weekday) => ({
      weekday,
      short: WEEKDAY_SHORT[weekday],
      label: WEEKDAY_LONG[weekday],
      periods: grids
        .flatMap((g) =>
          g.slots
            .filter((s) => s.teacherId === staffId && s.weekday === weekday)
            .map((s) => ({
              periodNo: s.periodNo,
              startTime: bellByNo.get(s.periodNo)?.startTime || "",
              endTime: bellByNo.get(s.periodNo)?.endTime || "",
              classId: g.classId,
              sectionId: g.sectionId,
              className: classNameOf(g.classId),
              sectionName: sectionNameOf(g.sectionId),
              subjectId: s.subjectId,
              subjectName: subjectNameOf(s.subjectId),
              roomId: s.roomId,
            })),
        )
        .sort((a, b) => a.periodNo - b.periodNo),
    }));

    const today = istToday();
    const week = new Set(weekDates(today.date));
    const substitutions = tt.substitutions
      .filter(
        (s) =>
          (!s.academicYearCode || s.academicYearCode === ay) &&
          week.has(s.date) &&
          (s.substituteTeacherId === staffId || s.absentTeacherId === staffId),
      )
      .sort((a, b) => a.date.localeCompare(b.date) || a.periodNo - b.periodNo)
      .map((s) => ({
        date: s.date,
        periodNo: s.periodNo,
        startTime: bellByNo.get(s.periodNo)?.startTime || "",
        endTime: bellByNo.get(s.periodNo)?.endTime || "",
        className: classNameOf(s.classId),
        sectionName: sectionNameOf(s.sectionId),
        subjectName: subjectNameOf(s.subjectId),
        role: s.substituteTeacherId === staffId ? "substitute" : "absent",
        otherTeacherName:
          s.substituteTeacherId === staffId
            ? staffNameOf(s.absentTeacherId)
            : staffNameOf(s.substituteTeacherId),
        note: s.note,
      }));

    return apiOk({
      staffId,
      academicYearCode: ay,
      published,
      todayWeekday: today.weekday,
      today: today.date,
      bell: bell.map((b) => ({
        no: b.no,
        startTime: b.startTime,
        endTime: b.endTime,
        label: (b as { label?: string }).label || `Period ${b.no}`,
      })),
      days,
      substitutions,
      periodCount: days.reduce((n, d) => n + d.periods.length, 0),
    });
  } catch (e) {
    return apiErr(e);
  }
}
