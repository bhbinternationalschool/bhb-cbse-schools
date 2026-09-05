import { ApiError } from "@/lib/api/v1/errors";
import type { ApiAuthContext } from "@/lib/api/v1/auth";
import { inferRoleCodes } from "@/lib/rbac";
import { ensureTimetableHydratedServer } from "@/lib/timetablePersistence";
import { loadTimetable } from "@/lib/timetable";
import { resolveStaffHomeKind } from "@/lib/staffHomeKind.server";
import { isSchoolWideKind, type StaffHomeKind } from "@/lib/staffHomeKind";

export type StaffScope = {
  kind: StaffHomeKind;
  /** Leadership / office: every section. */
  unrestricted: boolean;
  /** "classId|sectionId" the teacher is class teacher of or teaches on the timetable. */
  sections: Set<string>;
  classTeacherOf: Set<string>;
};

export function sectionKey(classId: string, sectionId: string): string {
  return `${classId}|${sectionId}`;
}

/**
 * Which sections this staff session may write for.
 *
 * The v1 write routes used to check only the module permission, so any
 * login carrying the default "teacher" role — a peon's does — could mark
 * attendance or post homework for any class. Scope is the class-teacher
 * links plus the published timetable; leadership and office roles keep the
 * school-wide reach the desk gives them.
 */
export async function staffSectionScope(ctx: ApiAuthContext): Promise<StaffScope> {
  if (ctx.session.persona !== "staff") {
    throw new ApiError("forbidden", "Staff session required", 403);
  }
  const ay = ctx.session.academicYearCode;
  const staffId = ctx.session.staffId || "";
  const staff = staffId
    ? (ctx.masters.staff ?? []).find((s) => s.id === staffId) || null
    : null;

  const classTeacherOf = new Set<string>();
  for (const l of staff?.classTeacherLinks ?? []) {
    if (l.academicYearCode && l.academicYearCode !== ay) continue;
    classTeacherOf.add(sectionKey(l.classId, l.sectionId));
  }

  const sections = new Set(classTeacherOf);
  let teachesClasses = classTeacherOf.size > 0;
  if (staffId) {
    await ensureTimetableHydratedServer();
    const tt = loadTimetable();
    const grids = tt.publishedGrids.length ? tt.publishedGrids : tt.grids;
    for (const g of grids) {
      if (g.academicYearCode && g.academicYearCode !== ay) continue;
      if (g.slots.some((s) => s.teacherId === staffId)) {
        sections.add(sectionKey(g.classId, g.sectionId));
        teachesClasses = true;
      }
    }
  }

  const kind = resolveStaffHomeKind(ctx.session, ctx.masters, { teachesClasses });
  let unrestricted = isSchoolWideKind(kind);
  if (!unrestricted) {
    try {
      const codes = inferRoleCodes(ctx.session, ctx.masters);
      unrestricted = codes.some((c) =>
        c === "owner" || c === "principal" || c === "admin" || c === "office",
      );
    } catch {
      /* stay restricted */
    }
  }
  return { kind, unrestricted, sections, classTeacherOf };
}

export function scopeAllows(scope: StaffScope, classId: string, sectionId: string): boolean {
  return scope.unrestricted || scope.sections.has(sectionKey(classId, sectionId));
}

/** 403 unless the session teaches (or leads) this section. */
export async function assertSectionScope(
  ctx: ApiAuthContext,
  classId: string,
  sectionId: string,
): Promise<StaffScope> {
  const scope = await staffSectionScope(ctx);
  if (!scopeAllows(scope, classId, sectionId)) {
    const cls = ctx.masters.classes.find((c) => c.id === classId)?.name || "this class";
    const sec = ctx.masters.sections.find((s) => s.id === sectionId)?.name || "";
    throw new ApiError(
      "forbidden",
      `You are not a teacher of ${cls} ${sec}`.trim() +
        " — only its class teacher, its subject teachers on the timetable, or the office can do this",
      403,
    );
  }
  return scope;
}
