/**
 * GET /api/v1/staff/class-gallery — the class teacher's class(es) and their
 * events (lib/classGallery). ?section=<classId|sectionId> picks one when the
 * teacher has more than one (leadership: any section).
 */
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { assertMaySection, classLabelFor, listClassEvents, postableSections } from "@/lib/classGallery.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") throw new ApiError("forbidden", "Staff session required", 403);
    const mine = await postableSections(ctx);
    const asked = new URL(request.url).searchParams.get("section") || "";
    const section = asked || mine.sections[0] || "";
    if (!section) {
      return apiOk({ classes: [], section: "", classLabel: "", events: [], note: "The class gallery is for class teachers." });
    }
    await assertMaySection(ctx, section);
    return apiOk({
      classes: mine.sections.map((s) => ({ section: s, classLabel: classLabelFor(ctx.masters, s) })),
      section,
      classLabel: classLabelFor(ctx.masters, section),
      events: await listClassEvents(section),
    });
  } catch (e) {
    return apiErr(e);
  }
}
