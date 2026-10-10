/** POST /api/v1/staff/class-gallery/event { section, name } — an event of the class (made if new). */
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { staffWorkingYear } from "@/lib/api/v1/staffScope";
import { assertMaySection, classLabelFor, ensureClassEvent } from "@/lib/classGallery.server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") throw new ApiError("forbidden", "Staff session required", 403);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const section = String(body.section ?? "");
    if (!/^[^|]+\|[^|]+$/.test(section)) throw new ApiError("bad_request", "section required", 400);
    await assertMaySection(ctx, section);
    const album = await ensureClassEvent({
      section,
      name: String(body.name ?? ""),
      classLabel: classLabelFor(ctx.masters, section),
      academicYear: staffWorkingYear(ctx),
      by: ctx.session.fullName || "Class teacher",
    });
    return apiOk({ id: album.id, title: album.title });
  } catch (e) {
    return apiErr(e);
  }
}
