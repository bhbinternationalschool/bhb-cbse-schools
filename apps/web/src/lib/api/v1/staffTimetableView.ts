/**
 * A staff member's periods, built from a timetable the caller has READ FROM
 * THE DATABASE (readTimetableStateServer) — never loadTimetable(), which is
 * empty on the server.
 *
 * Which grids:
 *  - staffWeekGrids: the published grids; while nothing is published, the
 *    working draft — and says so (`published: false`), so the staff app's
 *    timetable screen can label it "working draft".
 *  - staffPeriodsOn: the published grids ONLY. The home screen lists these
 *    as "Today's periods" with no draft label, and only a published grid
 *    grants a teacher the section (timetableScope.server.ts) — a draft
 *    period there would be a class the teacher is then refused on.
 */
import type { MastersState } from "@/lib/masters";
import { periodBell, type TimetableGrid, type TimetableState } from "@/lib/timetable";

export type StaffPeriod = {
  periodNo: number;
  startTime: string;
  endTime: string;
  classId: string;
  sectionId: string;
  className: string;
  sectionName: string;
  subjectId: string;
  subjectName: string;
  roomId: string;
};

type Names = Pick<MastersState, "classes" | "sections" | "subjects">;

const inYear = (ay: string) => (g: TimetableGrid) => !g.academicYearCode || g.academicYearCode === ay;

export function staffWeekGrids(
  tt: TimetableState,
  academicYearCode: string,
): { published: boolean; grids: TimetableGrid[] } {
  const published = tt.publishedGrids.length > 0;
  return { published, grids: (published ? tt.publishedGrids : tt.grids).filter(inYear(academicYearCode)) };
}

/** `staffId`'s periods on `weekday` in `grids`, in bell order. */
export function staffPeriodsIn(
  tt: TimetableState,
  grids: TimetableGrid[],
  masters: Names,
  staffId: string,
  weekday: number,
): StaffPeriod[] {
  if (!staffId) return [];
  // Each period's time from its own class's bell (pre-primary may differ).
  const at = (classId: string, periodNo: number) => periodBell(tt, classId, periodNo);
  const className = (id: string) => masters.classes.find((c) => c.id === id)?.name || "";
  const sectionName = (id: string) => masters.sections.find((s) => s.id === id)?.name || "";
  const subjectName = (id: string) => masters.subjects.find((s) => s.id === id)?.nameEn || "";
  return grids
    .flatMap((g) =>
      g.slots
        .filter((s) => s.teacherId === staffId && s.weekday === weekday)
        .map((s) => ({
          periodNo: s.periodNo,
          startTime: at(g.classId, s.periodNo)?.startTime || "",
          endTime: at(g.classId, s.periodNo)?.endTime || "",
          classId: g.classId,
          sectionId: g.sectionId,
          className: className(g.classId),
          sectionName: sectionName(g.sectionId),
          subjectId: s.subjectId,
          subjectName: subjectName(s.subjectId),
          roomId: s.roomId,
        })),
    )
    .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.periodNo - b.periodNo);
}

/** Published periods only (see the file note). */
export function staffPeriodsOn(
  tt: TimetableState,
  masters: Names,
  opts: { staffId: string; academicYearCode: string; weekday: number },
): { published: boolean; periods: StaffPeriod[] } {
  const grids = tt.publishedGrids.filter(inYear(opts.academicYearCode));
  return {
    published: tt.publishedGrids.length > 0,
    periods: staffPeriodsIn(tt, grids, masters, opts.staffId, opts.weekday),
  };
}
