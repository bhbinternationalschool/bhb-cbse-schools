import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { syllabusChaptersFromBooks } from "@/lib/syllabusFromBooks.server";

export const runtime = "nodejs";

/**
 * GET /api/v1/teaching/syllabus-from-books?classId=&subjectId=
 *
 * What the school's own book for this class and subject would put on the
 * syllabus. Reads only — the teacher sees it, then saves it through the
 * ordinary import, which skips anything already in the plan.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "teaching", "view");

    const url = new URL(request.url);
    const classId = String(url.searchParams.get("classId") || "");
    const subjectId = String(url.searchParams.get("subjectId") || "");
    const klass = ctx.masters.classes.find((c) => c.id === classId);
    const subject = ctx.masters.subjects.find((s) => s.id === subjectId);
    if (!klass) throw new ApiError("bad_request", "Unknown class", 400);
    if (!subject) throw new ApiError("bad_request", "Unknown subject", 400);

    await ensureSchoolMirrorHydrated();
    const found = await syllabusChaptersFromBooks({
      className: klass.name,
      subjectName: subject.nameEn,
    });
    return apiOk(found);
  } catch (e) {
    return apiErr(e);
  }
}
