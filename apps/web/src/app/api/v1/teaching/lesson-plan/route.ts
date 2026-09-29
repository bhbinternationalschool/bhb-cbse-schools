import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import {
  assertPermission,
  requestMeta,
  resolveApiAuth,
} from "@/lib/api/v1/auth";
import { assertClassSubjectScope } from "@/lib/api/v1/staffScope";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import {
  ensureTeachingHydratedServer,
  pushTeachingRemoteServer,
} from "@/lib/teachingPersistence";
import {
  addResourceLink,
  loadTeaching,
  normalizeLessonPlanSource,
  removeLessonPlan,
  removeResourceLink,
  upsertLessonPlan,
  writeTeachingLocalRaw,
  type LessonPlan,
  type ResourceKind,
  type TeachingState,
} from "@/lib/teaching";

export const runtime = "nodejs";

type Action = "save" | "remove" | "add_resource" | "remove_resource";

type Body = {
  /** Omitted = "save" (the mobile app's only call). */
  action?: Action;
  id?: string;
  classId?: string;
  subjectId?: string;
  sectionId?: string;
  title?: string;
  unitIds?: string[];
  plannedDate?: string;
  plannedPeriods?: number;
  objectives?: string;
  teachingAids?: string;
  activities?: string;
  assessment?: string;
  homework?: string;
  source?: string;
  aiModel?: string;
  /** add_resource */
  resource?: { kind?: ResourceKind; title?: string; url?: string; locator?: string };
  /** remove_resource */
  resourceId?: string;
};

function parseAction(v: unknown): Action {
  return v === "remove" || v === "add_resource" || v === "remove_resource"
    ? v
    : "save";
}

/**
 * POST /api/v1/teaching/lesson-plan — create, update or remove one lesson
 * plan, or add / remove a content link on it. Used by the mobile app and,
 * since 2026-09-29, by the web Teaching desk for every teacher-mode write
 * (the whole-blob push is office-only now).
 *
 * Class and subject are validated against masters, then against the
 * session's own classes: a teacher may write plans only for a subject
 * they teach (or a section they are class teacher of). An edit or removal
 * is checked against the plan AS STORED too, so a plan cannot be pulled
 * out of another teacher's class by re-saving it under one's own.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "teaching", "edit");

    const body = (await request.json()) as Body;
    const action = parseAction(body.action);
    const staffId = ctx.session.staffId || "";

    await ensureSchoolMirrorHydrated();
    await ensureTeachingHydratedServer();
    const state = loadTeaching();

    const planId = String(body.id || "");
    const existing: LessonPlan | null = planId
      ? state.lessonPlans.find((p) => p.id === planId) ?? null
      : null;
    if (planId && !existing) {
      throw new ApiError("not_found", "That lesson plan no longer exists", 404);
    }
    if (action !== "save" && !existing) {
      throw new ApiError("bad_request", "Which lesson plan?", 400);
    }
    if (existing) {
      await assertClassSubjectScope(
        ctx,
        existing.classId,
        existing.sectionId,
        existing.subjectId,
      );
    }

    let next: TeachingState;
    let entityId = existing?.id || "";
    let title = existing?.title || "";
    let summary = "";
    let auditAction: "create" | "edit" | "delete" = "edit";
    const drop: string[] = [];

    if (action === "save") {
      const classId = String(body.classId || "");
      const subjectId = String(body.subjectId || "");
      const sectionId = String(body.sectionId || "");
      if (!ctx.masters.classes.some((c) => c.id === classId)) {
        throw new ApiError("bad_request", "Unknown class", 400);
      }
      if (!ctx.masters.subjects.some((s) => s.id === subjectId)) {
        throw new ApiError("bad_request", "Unknown subject", 400);
      }
      if (
        sectionId &&
        !ctx.masters.sections.some((s) => s.id === sectionId && s.classId === classId)
      ) {
        throw new ApiError("bad_request", "Unknown section for this class", 400);
      }
      await assertClassSubjectScope(ctx, classId, sectionId, subjectId);

      const result = upsertLessonPlan(state, {
        id: existing?.id,
        academicYearCode: existing?.academicYearCode || ctx.session.academicYearCode,
        classId,
        subjectId,
        sectionId,
        title: String(body.title || ""),
        unitIds: Array.isArray(body.unitIds) ? body.unitIds.map(String) : [],
        plannedDate: String(body.plannedDate || ""),
        plannedPeriods: Number(body.plannedPeriods) || 1,
        objectives: String(body.objectives || ""),
        teachingAids: String(body.teachingAids || ""),
        activities: String(body.activities || ""),
        assessment: String(body.assessment || ""),
        homework: String(body.homework || ""),
        source: normalizeLessonPlanSource(body.source),
        aiModel: String(body.aiModel || ""),
        createdBy: staffId,
      });
      if (!result.ok) throw new ApiError("bad_request", result.error, 400);
      next = result.value.state;
      entityId = result.value.plan.id;
      title = result.value.plan.title;
      auditAction = existing ? "edit" : "create";
      summary = `${existing ? "Updated" : "Wrote"} lesson plan "${title}"`;
    } else if (action === "remove") {
      next = removeLessonPlan(state, planId);
      drop.push(planId);
      auditAction = "delete";
      summary = `Removed lesson plan "${title}"`;
    } else if (action === "add_resource") {
      const r = body.resource ?? {};
      const result = addResourceLink(
        state,
        { kind: "lessonPlan", id: planId },
        {
          kind: r.kind,
          title: String(r.title || ""),
          url: String(r.url || ""),
          locator: String(r.locator || ""),
        },
        staffId,
      );
      if (!result.ok) throw new ApiError("bad_request", result.error, 400);
      next = result.value.state;
      summary = `Added a link to lesson plan "${title}"`;
    } else {
      next = removeResourceLink(
        state,
        { kind: "lessonPlan", id: planId },
        String(body.resourceId || ""),
      );
      summary = `Removed a link from lesson plan "${title}"`;
    }

    writeTeachingLocalRaw(next);
    const push = await pushTeachingRemoteServer(next, { dropLessonPlanIds: drop });
    if (!push.ok) {
      console.warn("[teaching-v1] lesson plan push failed", push.error);
      throw new ApiError(
        "server_error",
        "Could not reach the school server — try again",
        502,
      );
    }

    const plan = next.lessonPlans.find((p) => p.id === entityId) ?? null;
    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "teaching",
      action: auditAction,
      entityType: "lesson_plan",
      entityId,
      summary,
      after: plan
        ? { classId: plan.classId, subjectId: plan.subjectId, title: plan.title }
        : undefined,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return apiOk({ id: entityId, title, action, plan });
  } catch (e) {
    return apiErr(e);
  }
}
