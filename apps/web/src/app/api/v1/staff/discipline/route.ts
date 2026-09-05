import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { loadSis } from "@/lib/sis";
import {
  DISCIPLINE_CATEGORIES,
  ESCALATION_LEVELS,
  disciplineCategoryLabel,
  emptyDisciplineState,
  escalationLevelLabel,
  normalizeDisciplineState,
  recentIncidentCount,
  studentPointsTotal,
  suggestEscalationLevel,
  upsertIncident,
  type DisciplineCategory,
  type DisciplineState,
  type EscalationLevel,
} from "@/lib/discipline";
import { readModuleLocalState, writeModuleLocalState } from "@/lib/moduleLocalState.server";
import { scopeAllows, staffSectionScope } from "@/lib/api/v1/staffScope";
import { sendPushToSubject } from "@/lib/webPush.server";

export const runtime = "nodejs";

const CATEGORY_CODES = new Set(DISCIPLINE_CATEGORIES.map((c) => c.value));
const LEVEL_CODES = new Set(ESCALATION_LEVELS.map((l) => l.value));
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

async function loadState(): Promise<DisciplineState> {
  const row = await readModuleLocalState<unknown>("discipline");
  if (row === null) throw new ApiError("server_error", "Discipline records are unavailable right now", 503);
  return row.state ? normalizeDisciplineState(row.state) : emptyDisciplineState();
}

/**
 * GET /api/v1/staff/discipline?classId=&sectionId=[&studentId=] — recent
 * incidents for a section (or one child), newest first, within scope.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "discipline", "view");
    const url = new URL(request.url);
    const classId = url.searchParams.get("classId")?.trim() || "";
    const sectionId = url.searchParams.get("sectionId")?.trim() || "";
    const studentId = url.searchParams.get("studentId")?.trim() || "";
    const scope = await staffSectionScope(ctx);

    await ensureSchoolMirrorHydrated();
    await ensureSisHydratedServer();
    const sis = loadSis();
    const ay = ctx.session.academicYearCode;
    const wanted = sis.students.filter(
      (s) =>
        s.academicYearCode === ay &&
        (studentId ? s.id === studentId : s.classId === classId && s.sectionId === sectionId) &&
        scopeAllows(scope, s.classId, s.sectionId),
    );
    if (!wanted.length && (studentId || classId)) {
      throw new ApiError("forbidden", "Not a student of your class", 403);
    }
    const ids = new Set(wanted.map((s) => s.id));
    const nameOf = new Map(wanted.map((s) => [s.id, s.fullName]));
    const staffNameOf = (id: string) =>
      ctx.masters.staff.find((s) => s.id === id)?.fullName || "";

    const state = await loadState();
    const incidents = state.incidents
      .filter((i) => ids.has(i.studentId) && (!i.academicYearCode || i.academicYearCode === ay))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
      .slice(0, 100)
      .map((i) => ({
        id: i.id,
        studentId: i.studentId,
        studentName: nameOf.get(i.studentId) || "",
        date: i.date,
        category: i.category,
        categoryLabel: disciplineCategoryLabel(i.category),
        pointsDelta: i.pointsDelta,
        description: i.description,
        reportedBy: staffNameOf(i.reportedByStaffId),
        escalationLevel: i.escalationLevel,
        escalationLabel: escalationLevelLabel(i.escalationLevel),
        status: i.status,
        notifiedParentAt: i.notifiedParentAt,
      }));

    return apiOk({
      categories: DISCIPLINE_CATEGORIES,
      levels: ESCALATION_LEVELS,
      incidents,
    });
  } catch (e) {
    return apiErr(e);
  }
}

type Body = {
  studentId?: string;
  date?: string;
  category?: string;
  pointsDelta?: number;
  description?: string;
  escalationLevel?: string;
  notifyParent?: boolean;
};

/** POST /api/v1/staff/discipline — record an incident (merit or demerit) for one child. */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "discipline", "create");
    const body = (await request.json().catch(() => ({}))) as Body;
    const studentId = (body.studentId || "").trim();
    const date = (body.date || "").trim();
    const category = (body.category || "").trim() as DisciplineCategory;
    const description = (body.description || "").trim().slice(0, 800);
    const points = Number.isFinite(body.pointsDelta) ? Math.round(Number(body.pointsDelta)) : -1;
    const level = (body.escalationLevel || "").trim() as EscalationLevel;
    if (!studentId) throw new ApiError("bad_request", "studentId required", 400);
    if (!ISO_DAY.test(date)) throw new ApiError("bad_request", "date must be YYYY-MM-DD", 400);
    if (!CATEGORY_CODES.has(category)) throw new ApiError("bad_request", "Unknown category", 400);
    if (description.length < 5) throw new ApiError("bad_request", "Describe what happened", 400);
    if (level && !LEVEL_CODES.has(level)) throw new ApiError("bad_request", "Unknown escalation level", 400);
    if (Math.abs(points) > 20) throw new ApiError("bad_request", "Points must be between -20 and 20", 400);

    const scope = await staffSectionScope(ctx);
    await ensureSchoolMirrorHydrated();
    await ensureSisHydratedServer();
    const sis = loadSis();
    const student = sis.students.find((s) => s.id === studentId);
    if (!student) throw new ApiError("not_found", "Student not found", 404);
    if (!scopeAllows(scope, student.classId, student.sectionId)) {
      throw new ApiError("forbidden", "Not a student of your class", 403);
    }

    const state = await loadState();
    const ay = ctx.session.academicYearCode;
    const escalation =
      level ||
      suggestEscalationLevel(
        studentPointsTotal(state, studentId, ay) + points,
        recentIncidentCount(state, studentId) + (points < 0 ? 1 : 0),
      );
    const now = new Date().toISOString();
    const { state: next, incident } = upsertIncident(state, {
      studentId,
      academicYearCode: ctx.session.academicYearCode,
      date,
      category,
      pointsDelta: points,
      description,
      reportedByStaffId: ctx.session.staffId || "",
      escalationLevel: escalation,
      status: "open",
      notifiedParentAt: body.notifyParent && student.householdId ? now : null,
    });
    const written = await writeModuleLocalState("discipline", next);
    if (!written.ok) throw new ApiError("server_error", "Could not save — try again", 503);

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "discipline",
      action: "create",
      entityType: "incident",
      entityId: incident.id,
      summary: `${points >= 0 ? "Merit" : "Incident"} for ${student.fullName}: ${disciplineCategoryLabel(category)} (${points > 0 ? "+" : ""}${points})`,
      after: { studentId, date, category, points, escalation },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    let parentNotified = false;
    if (body.notifyParent && student.householdId) {
      const r = await sendPushToSubject("parent", student.householdId, {
        title: points >= 0 ? `Well done, ${student.fullName}` : `A note from school about ${student.fullName}`,
        body: `${disciplineCategoryLabel(category)} · ${date}: ${description.slice(0, 140)}`,
        url: `/profile?studentId=${encodeURIComponent(student.id)}`,
        data: { kind: "discipline", studentId: student.id, incidentId: incident.id },
      }).catch(() => ({ sent: 0, expired: 0, failed: 0 }));
      parentNotified = r.sent > 0;
    }

    return apiOk({
      id: incident.id,
      escalationLevel: incident.escalationLevel,
      escalationLabel: escalationLevelLabel(incident.escalationLevel),
      parentNotified,
    });
  } catch (e) {
    return apiErr(e);
  }
}
