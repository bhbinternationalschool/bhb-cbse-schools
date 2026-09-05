import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureExamsHydratedServer } from "@/lib/examsPersistence";
import { listExamTerms, loadExams } from "@/lib/exams";

export const runtime = "nodejs";

/** GET /api/v1/staff/exams/terms — active exam terms this year, in order. */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "exams", "view");
    await ensureSchoolMirrorHydrated();
    await ensureExamsHydratedServer();
    const ay = ctx.session.academicYearCode;
    const state = loadExams();
    const terms = listExamTerms(ay, state).map((t) => ({
      id: t.id,
      code: t.code,
      label: t.label,
      maxMarks: t.maxMarks,
      startsOn: t.startsOn,
      endsOn: t.endsOn,
      note: t.note,
      sheetCount: state.sheets.filter(
        (s) => s.academicYearCode === ay && s.examTermId === t.id,
      ).length,
    }));
    return apiOk({ academicYearCode: ay, terms });
  } catch (e) {
    return apiErr(e);
  }
}
