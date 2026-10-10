import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureExamsHydratedServer } from "@/lib/examsPersistence";
import { listExamDateSheet, loadExams } from "@/lib/exams";

export const runtime = "nodejs";

/**
 * GET /api/v1/staff/exams/datesheet?termId= — the exam date sheet, every
 * class, so a teacher can see when each paper sits (invigilation and
 * revision planning happen from here).
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "exams", "view");
    const url = new URL(request.url);
    const termId = url.searchParams.get("termId")?.trim() || "";

    await ensureSchoolMirrorHydrated();
    await ensureExamsHydratedServer();
    const ay = ctx.session.academicYearCode;
    const state = loadExams();
    const termLabel = new Map(state.terms.map((t) => [t.id, t.label]));
    const classNameOf = (id: string) =>
      ctx.masters.classes.find((c) => c.id === id)?.name || "";
    const classOrder = new Map(ctx.masters.classes.map((c) => [c.id, c.sortOrder]));
    const subjectName = (id: string) =>
      state.subjects.find((s) => s.id === id)?.name ||
      ctx.masters.subjects.find((s) => s.id === id)?.nameEn ||
      "";

    const rows = listExamDateSheet(ay, termId || undefined, state)
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          (classOrder.get(a.classId) ?? 0) - (classOrder.get(b.classId) ?? 0) ||
          a.startTime.localeCompare(b.startTime),
      )
      .map((r) => ({
        id: r.id,
        termId: r.examTermId,
        termLabel: termLabel.get(r.examTermId) || "",
        date: r.date,
        startTime: r.startTime,
        durationMinutes: r.durationMinutes,
        classId: r.classId,
        className: classNameOf(r.classId),
        subjectName: subjectName(r.subjectId),
        note: r.note,
      }));
    return apiOk({ academicYearCode: ay, termId: termId || null, rows });
  } catch (e) {
    return apiErr(e);
  }
}
