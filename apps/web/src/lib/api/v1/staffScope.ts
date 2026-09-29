import { ApiError } from "@/lib/api/v1/errors";
import type { ApiAuthContext } from "@/lib/api/v1/auth";
import { resolveSessionRoles } from "@/lib/rbac";
import { currentAcademicYearCode } from "@/lib/masters";
import { ensureTimetableHydratedServer } from "@/lib/timetablePersistence";
import { loadTimetable } from "@/lib/timetable";
import { resolveStaffHomeKind } from "@/lib/staffHomeKind.server";
import type { StaffHomeKind } from "@/lib/staffHomeKind";
import {
  sectionKey,
  teachingSectionsFor,
  type TeachingSection,
} from "@/lib/staffTeachingScope";

export { sectionKey };
export type { TeachingSection };

export type StaffScope = {
  kind: StaffHomeKind;
  /** Leadership / an office or admin role: every section. */
  unrestricted: boolean;
  /** "classId|sectionId" the teacher is class teacher of, teaches a subject
   * in, or has periods in on the timetable. */
  sections: Set<string>;
  classTeacherOf: Set<string>;
  /** Subjects taught per section key. A class teacher's own section is
   * absent from here on purpose — they may act for every subject of it. */
  subjectsBySection: Map<string, Set<string>>;
  /** The teacher's sections, class-ordered, for pickers. Empty when
   * unrestricted (the caller lists the whole school instead). */
  teaching: TeachingSection[];
  academicYearCode: string;
};

/**
 * The year a staff session works in. The staff app has no year selector,
 * and a cookie minted before 2026-09-06 carries the closed 2025-26 — which
 * silently emptied every roster and link filter. Masters' current year
 * wins; the session's own year is the fallback when Masters has none.
 */
export function staffWorkingYear(ctx: ApiAuthContext): string {
  try {
    const cur = currentAcademicYearCode(ctx.masters);
    if (cur) return cur;
  } catch {
    /* fall through */
  }
  return ctx.session.academicYearCode;
}

const SCHOOL_WIDE_ROLES = new Set(["owner", "principal", "admin", "office"]);

/**
 * School-wide reach comes from leadership, or from a role the school GAVE
 * the person (Masters → Roles) or that their designation says outright.
 * It used to also come from the "office" home kind, whose designation
 * regex matches counsellor, computer operator, librarian, nurse and
 * coordinator — so a counsellor could mark any class's register.
 */
export function isSchoolWideSession(ctx: ApiAuthContext, kind: StaffHomeKind): boolean {
  if (kind === "leadership") return true;
  try {
    const roles = resolveSessionRoles(ctx.rbac, ctx.session, ctx.masters);
    return roles.some((r) => SCHOOL_WIDE_ROLES.has(r.code));
  } catch {
    return false;
  }
}

/**
 * Which sections (and subjects) this staff session may act for.
 *
 * Sources, all for the working year: class-teacher links, subject-teacher
 * links (Staff → Duties / Allocate teaching — until 2026-09-29 these were
 * never read, so every subject teacher was refused), and the timetable.
 */
export async function staffSectionScope(ctx: ApiAuthContext): Promise<StaffScope> {
  if (ctx.session.persona !== "staff") {
    throw new ApiError("forbidden", "Staff session required", 403);
  }
  const ay = staffWorkingYear(ctx);
  const staffId = ctx.session.staffId || "";

  let grids: Awaited<ReturnType<typeof loadTimetable>>["grids"] = [];
  if (staffId) {
    await ensureTimetableHydratedServer();
    const tt = loadTimetable();
    grids = tt.publishedGrids.length ? tt.publishedGrids : tt.grids;
  }

  const teaching = teachingSectionsFor({
    staffId,
    masters: ctx.masters,
    grids,
    academicYearCodes: [ay, ctx.session.academicYearCode],
  });

  const sections = new Set<string>();
  const classTeacherOf = new Set<string>();
  const subjectsBySection = new Map<string, Set<string>>();
  for (const t of teaching) {
    const key = sectionKey(t.classId, t.sectionId);
    sections.add(key);
    if (t.isClassTeacher) classTeacherOf.add(key);
    subjectsBySection.set(key, new Set(t.subjects.map((s) => s.id)));
  }

  const kind = resolveStaffHomeKind(ctx.session, ctx.masters, {
    teachesClasses: teaching.length > 0,
  });
  const unrestricted = isSchoolWideSession(ctx, kind);
  return {
    kind,
    unrestricted,
    sections,
    classTeacherOf,
    subjectsBySection,
    teaching: unrestricted ? [] : teaching,
    academicYearCode: ay,
  };
}

export function scopeAllows(scope: StaffScope, classId: string, sectionId: string): boolean {
  return scope.unrestricted || scope.sections.has(sectionKey(classId, sectionId));
}

/** A class teacher may act for every subject of their own section; a
 * subject teacher only for the subjects they were given. */
export function scopeAllowsSubject(
  scope: StaffScope,
  classId: string,
  sectionId: string,
  subjectId: string,
): boolean {
  if (scope.unrestricted) return true;
  const key = sectionKey(classId, sectionId);
  if (scope.classTeacherOf.has(key)) return true;
  if (!subjectId) return scope.sections.has(key);
  return scope.subjectsBySection.get(key)?.has(subjectId) ?? false;
}

/** Same rule as scopeAllowsSubject, for the exams desk, whose subjects
 * carry their own ids and match Masters only by code. */
export function scopeAllowsSubjectCode(
  scope: StaffScope,
  classId: string,
  sectionId: string,
  code: string,
): boolean {
  if (scope.unrestricted) return true;
  const key = sectionKey(classId, sectionId);
  if (scope.classTeacherOf.has(key)) return true;
  const want = (code || "").trim().toUpperCase();
  if (!want) return false;
  const sec = scope.teaching.find((t) => t.classId === classId && t.sectionId === sectionId);
  return !!sec?.subjects.some((s) => s.code === want);
}

function sectionLabel(ctx: ApiAuthContext, classId: string, sectionId: string): string {
  const cls = ctx.masters.classes.find((c) => c.id === classId)?.name || "this class";
  const sec = ctx.masters.sections.find((s) => s.id === sectionId)?.name || "";
  return `${cls} ${sec}`.trim();
}

/** 403 unless the session teaches (or leads) this section. */
export async function assertSectionScope(
  ctx: ApiAuthContext,
  classId: string,
  sectionId: string,
): Promise<StaffScope> {
  const scope = await staffSectionScope(ctx);
  if (!scopeAllows(scope, classId, sectionId)) {
    throw new ApiError(
      "forbidden",
      `You are not a teacher of ${sectionLabel(ctx, classId, sectionId)}` +
        " — ask the office to add it to your classes (Staff → Duties)",
      403,
    );
  }
  return scope;
}

/** 403 unless the session teaches this subject in this section (or is its
 * class teacher, or school-wide). */
export async function assertSubjectScope(
  ctx: ApiAuthContext,
  classId: string,
  sectionId: string,
  subjectId: string,
): Promise<StaffScope> {
  const scope = await assertSectionScope(ctx, classId, sectionId);
  if (!scopeAllowsSubject(scope, classId, sectionId, subjectId)) {
    const sub = ctx.masters.subjects.find((s) => s.id === subjectId)?.nameEn || "this subject";
    throw new ApiError(
      "forbidden",
      `${sub} in ${sectionLabel(ctx, classId, sectionId)} is not one of your subjects` +
        " — ask the office to add it (Staff → Duties)",
      403,
    );
  }
  return scope;
}

/** 403 unless the session may see the whole school (leadership / office
 * or admin role). The principal snapshot and its drill-down lists used to
 * need only "home.view", which every role — even support — holds. */
export async function assertSchoolWide(ctx: ApiAuthContext): Promise<StaffScope> {
  const scope = await staffSectionScope(ctx);
  if (!scope.unrestricted) {
    throw new ApiError(
      "forbidden",
      "This view is for the principal and the office",
      403,
    );
  }
  return scope;
}
