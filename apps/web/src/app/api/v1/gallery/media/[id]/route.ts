/**
 * GET /api/v1/gallery/media/<photoId> — one class-gallery photo or video.
 *
 * The viewer is checked on every request: staff, or a parent with a child on
 * roll in the album's class, once the item passed its check. Then a redirect to a storage link that lasts ten
 * minutes — never stored, so it cannot leak into a record, and a video
 * streams from storage rather than through Cloud Run.
 */
import { NextResponse } from "next/server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { albumVisibleTo } from "@/lib/classGallery";
import { parentSections, readClassMedia, signedMediaUrl } from "@/lib/classGallery.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { loadSis } from "@/lib/sis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(request: Request, rctx: RouteCtx) {
  try {
    const ctx = await resolveApiAuth(request);
    const { id } = await rctx.params;
    const media = await readClassMedia(String(id ?? "").slice(0, 60));
    if (!media || !media.path) throw new ApiError("not_found", "Not found", 404);
    // Staff see an item while it is checked or held (the principal decides on
    // it); a parent only once it passed.
    let allowed = ctx.session.persona === "staff" && media.reviewStatus !== "removed";
    if (!allowed && ctx.session.persona === "parent" && ctx.session.householdId && media.reviewStatus === "ok") {
      await ensureSisHydratedServer();
      const hh = loadSis().students.filter((s) => s.householdId === ctx.session.householdId);
      allowed = albumVisibleTo({ sectionIds: media.sectionIds }, { staff: false, sections: parentSections(hh, ctx.session.academicYearCode || "") });
    }
    if (!allowed) throw new ApiError("forbidden", "This photo is for another class's families.", 403);
    const link = await signedMediaUrl(media.path);
    // ?link=1: the app asks with its login, then hands the link to the
    // phone's video player (which cannot send the login itself).
    if (new URL(request.url).searchParams.get("link") === "1") return apiOk({ url: link, expiresInSec: 600 });
    return NextResponse.redirect(link, { status: 302, headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return apiErr(e);
  }
}
