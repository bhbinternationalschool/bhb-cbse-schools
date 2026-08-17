import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import {
  assertPermission,
  requestMeta,
  resolveApiAuth,
} from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import {
  ensureTeachingHydratedServer,
  pushTeachingRemoteServer,
} from "@/lib/teachingPersistence";
import {
  loadTeaching,
  upsertLessonPlan,
  writeTeachingLocalRaw,
} from "@/lib/teaching";

export const runtime = "nodejs";

type Body = {
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
};

/**
 * POST /api/v1/teaching/lesson-plan — create or update one lesson plan
 * from the mobile app.
 *
 * Class and subject are validated against masters; the unit references
 * are validated inside upsertLessonPlan against that subject's own plan.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "teaching", "edit");

    const body = (await request.json()) as Body;
    const classId = String(body.classId || "");
    const subjectId = String(body.subjectId || "");

    if (!ctx.masters.classes.some((c) => c.id === classId)) {
      throw new ApiError("bad_request", "Unknown class", 400);
    }
    if (!ctx.masters.subjects.some((s) => s.id === subjectId)) {
      throw new ApiError("bad_request", "Unknown subject", 400);
    }

    await ensureSchoolMirrorHydrated();
    await ensureTeachingHydratedServer();

    const result = upsertLessonPlan(loadTeaching(), {
      id: body.id || undefined,
      academicYearCode: ctx.session.academicYearCode,
      classId,
      subjectId,
      sectionId: String(body.sectionId || ""),
      title: String(body.title || ""),
      unitIds: Array.isArray(body.unitIds) ? body.unitIds.map(String) : [],
      plannedDate: String(body.plannedDate || ""),
      plannedPeriods: Number(body.plannedPeriods) || 1,
      objectives: String(body.objectives || ""),
      teachingAids: String(body.teachingAids || ""),
      activities: String(body.activities || ""),
      assessment: String(body.assessment || ""),
      homework: String(body.homework || ""),
      createdBy: ctx.session.staffId || "",
    });
    if (!result.ok) throw new ApiError("bad_request", result.error, 400);

    writeTeachingLocalRaw(result.value.state);
    const push = await pushTeachingRemoteServer(result.value.state);
    if (!push.ok) {
      console.warn("[teaching-v1] lesson plan push failed", push.error);
      throw new ApiError(
        "server_error",
        "Could not reach the school server — try again",
        502,
      );
    }

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "teaching",
      action: body.id ? "edit" : "create",
      entityType: "lesson_plan",
      entityId: result.value.plan.id,
      summary: `${body.id ? "Updated" : "Wrote"} lesson plan "${result.value.plan.title}"`,
      after: { classId, subjectId, title: result.value.plan.title },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return apiOk({ id: result.value.plan.id, title: result.value.plan.title });
  } catch (e) {
    return apiErr(e);
  }
}
