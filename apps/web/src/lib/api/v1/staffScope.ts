import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/v1/errors";
import type { ApiAuthContext } from "@/lib/api/v1/auth";
import { resolveSessionRoles } from "@/lib/rbac";
import { currentAcademicYearCode } from "@/lib/masters";
import { loadScopeTimetable } from "@/lib/api/v1/timetableScope.server";
import type { TimetableGrid } from "@/lib/timetable";
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
 * never read, so every subject teacher was refused), and the timetable —
 * read from the database (timetableScope.server.ts). Until 13 Oct 2026 the
 * timetable came from loadTimetable(), which is always empty on the server,
 * so a teacher whose only tie was the timetable had no sections at all.
 *
 * Throws ApiError 403 for a session that is not staff, and ApiError 503 when
 * the timetable cannot be read and this process has no copy and the session
 * is not school-wide: the scope is then unknown, which is not the same as
 * "no sections". A school-wide session does not depend on the timetable.
 *
 * Computed once per request: the answer is kept against the request's
 * ApiAuthContext (a new object per resolveApiAuth), so a route that checks
 * scope twice — or a gate and then the route — does the work once.
 */
export async function staffSectionScope(ctx: ApiAuthContext): Promise<StaffScope> {
  if (ctx.session.persona !== "staff") {
    throw new ApiError("forbidden", "Staff session required", 403);
  }
  const held = scopeByRequest.get(ctx);
  if (held) return held;
  const pending = computeStaffSectionScope(ctx);
  scopeByRequest.set(ctx, pending);
  // A failure is not kept: a later call in the same request reads again.
  pending.catch(() => {
    if (scopeByRequest.get(ctx) === pending) scopeByRequest.delete(ctx);
  });
  return pending;
}

const scopeByRequest = new WeakMap<ApiAuthContext, Promise<StaffScope>>();

/**
 * For the school-data routes, whose whole-desk rule applies to callers that
 * are not staff: null = not a staff session. Any other failure (the scope is
 * unknown) is a 503 response, never a null — a null there has meant "not a
 * teacher, give the whole desk".
 */
export async function readStaffScopeForDesk(
  ctx: ApiAuthContext,
): Promise<{ ok: true; scope: StaffScope | null } | { ok: false; response: NextResponse }> {
  if (ctx.session.persona !== "staff") return { ok: true, scope: null };
  try {
    return { ok: true, scope: await staffSectionScope(ctx) };
  } catch (e) {
    const message =
      e instanceof ApiError && e.status >= 500 ? e.message : "Could not work out your classes — please try again.";
    if (!(e instanceof ApiError)) console.error("[staffScope] scope failed", e);
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: message, scopeUnknown: true }, { status: 503 }),
    };
  }
}

async function computeStaffSectionScope(ctx: ApiAuthContext): Promise<StaffScope> {
  const ay = staffWorkingYear(ctx);
  const staffId = ctx.session.staffId || "";

  // School-wide reach never depends on the timetable (leadership is read
  // before teaching in staffHomeKind, and roles do not look at it), so it is
  // known before the timetable is read. For a school-wide session a failed
  // timetable read changes nothing it may do: it goes on without the
  // timetable (logged). For anyone else it makes the scope unknown: 503.
  const schoolWide = isSchoolWideSession(
    ctx,
    resolveStaffHomeKind(ctx.session, ctx.masters, { teachesClasses: false }),
  );
  let grids: TimetableGrid[] = [];
  if (staffId) {
    try {
      grids = (await loadScopeTimetable()).grids;
    } catch (e) {
      if (!schoolWide) throw e;
      console.warn(
        `[staffScope] timetable unknown for school-wide ${staffId} — scope built without it:`,
        e instanceof Error ? e.message : e,
      );
    }
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
  const unrestricted = schoolWide || isSchoolWideSession(ctx, kind);
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

/**
 * 403 unless the session teaches this subject in this class. With a
 * section, exactly assertSubjectScope. Without one (a lesson plan or a
 * syllabus written for the whole class), ANY section of the class where
 * the session teaches the subject — or is its class teacher — will do.
 *
 * Added 2026-09-29: the lesson-plan and syllabus-import routes checked
 * only that the class and subject existed, so any teacher could write
 * plans for any class in the school.
 */
export async function assertClassSubjectScope(
  ctx: ApiAuthContext,
  classId: string,
  sectionId: string,
  subjectId: string,
): Promise<StaffScope> {
  if (sectionId) return assertSubjectScope(ctx, classId, sectionId, subjectId);
  const scope = await staffSectionScope(ctx);
  if (scope.unrestricted) return scope;
  const ok = ctx.masters.sections.some(
    (s) => s.classId === classId && scopeAllowsSubject(scope, classId, s.id, subjectId),
  );
  if (!ok) {
    const cls = ctx.masters.classes.find((c) => c.id === classId)?.name || "this class";
    const sub = ctx.masters.subjects.find((s) => s.id === subjectId)?.nameEn || "this subject";
    throw new ApiError(
      "forbidden",
      `${sub} in ${cls} is not one of your subjects` +
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
