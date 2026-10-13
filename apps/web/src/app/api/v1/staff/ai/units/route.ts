import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { assertAiClassSubject, loadClassSubjectUnits } from "@/lib/api/v1/staffAi.server";

export const runtime = "nodejs";

/**
 * GET /api/v1/staff/ai/units?classId&subjectId — the chapters (each with its
 * topics) of the class + subject's Teaching plan, for the teacher AI tools'
 * "which chapters?" list. These are the school's own chapters (mapped to its
 * books on the Teaching desk), so a paper or plan is drawn from what the
 * children hold.
 *
 * `available: false` = the Teaching plan could not be read (or was never set
 * up): the app says so, never "this subject has no chapters".
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "teaching", "view");
    const url = new URL(request.url);
    const classId = (url.searchParams.get("classId") || "").trim();
    const subjectId = (url.searchParams.get("subjectId") || "").trim();
    await ensureSchoolMirrorHydrated();
    await assertAiClassSubject(ctx, classId, subjectId);

    const { available, units } = await loadClassSubjectUnits(ctx, classId, subjectId);
    const chapters = units
      .filter((u) => u.level === "chapter")
      .map((c) => ({
        id: c.id,
        code: c.code,
        title: c.title,
        plannedPeriods: c.plannedPeriods,
        hasOutcomes: !!c.learningOutcomes.trim(),
        topics: units
          .filter((t) => t.level === "topic" && t.parentId === c.id)
          .map((t) => ({ id: t.id, code: t.code, title: t.title })),
      }));
    return apiOk({ available, chapters });
  } catch (e) {
    return apiErr(e);
  }
}
