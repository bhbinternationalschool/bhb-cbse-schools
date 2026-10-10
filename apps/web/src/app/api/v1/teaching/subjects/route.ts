import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";

export const runtime = "nodejs";

/**
 * GET /api/v1/teaching/subjects — active classes with the subjects
 * linked to each, so the app can ask "which plan am I adding to?"
 * before a scan.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "teaching", "view");

    await ensureSchoolMirrorHydrated();

    const links = ctx.masters.classSubjects ?? [];
    const subjects = ctx.masters.subjects ?? [];

    const classes = (ctx.masters.classes ?? [])
      .filter((c) => c.isActive !== false)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((c) => ({
        id: c.id,
        name: c.name,
        subjects: links
          .filter((l) => l.classId === c.id && l.isActive)
          .map((l) => subjects.find((s) => s.id === l.subjectId))
          .filter((s): s is NonNullable<typeof s> => !!s)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((s) => ({ id: s.id, name: s.nameEn })),
      }));

    return apiOk({ classes });
  } catch (e) {
    return apiErr(e);
  }
}
