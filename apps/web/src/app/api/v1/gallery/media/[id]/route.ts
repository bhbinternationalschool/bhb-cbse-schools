/**
 * GET /api/v1/gallery/media/<photoId> — one class-gallery photo or video.
 *
 * The viewer is checked on every request: staff, or a parent with a child on
 * roll in the album's class, once the item passed its check. Then a redirect to a storage link that lasts ten
 * minutes — never stored, so it cannot leak into a record, and a video
 * streams from storage rather than through Cloud Run.
 *
 * After 30 days the bucket copy is gone (lib/classGalleryReview) and the item
 * is streamed from Drive through here; the phone's video player gets a
 * ten-minute signed link to this route instead (lib/classMediaLinkToken).
 */
import { NextResponse } from "next/server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { albumVisibleTo } from "@/lib/classGallery";
import { parentSections, readClassMedia, signedMediaUrl } from "@/lib/classGallery.server";
import { signClassMediaLink, verifyClassMediaLink } from "@/lib/classMediaLinkToken.server";
import { getDriveFileContent } from "@/lib/googleDrive.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { loadSis } from "@/lib/sis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

/** Drive serves an item past its 30 days in the bucket; a video player's Range is passed on so it can seek. */
async function fromDrive(driveFileId: string, request: Request): Promise<Response> {
  const range = request.headers.get("range") || undefined;
  const r = await getDriveFileContent(driveFileId, { range });
  if (!r.ok) throw new ApiError("server_error", "Could not open the file — try again", 503);
  const headers: Record<string, string> = {
    "Content-Type": r.meta.mimeType || "application/octet-stream",
    "Cache-Control": "private, max-age=600",
    "Accept-Ranges": "bytes",
  };
  if (r.contentLength) headers["Content-Length"] = r.contentLength;
  if (r.contentRange) headers["Content-Range"] = r.contentRange;
  return new Response(r.body, { status: r.status === 206 ? 206 : 200, headers });
}

export async function GET(request: Request, rctx: RouteCtx) {
  try {
    const { id: rawId } = await rctx.params;
    const id = String(rawId ?? "").slice(0, 60);
    const q = new URL(request.url).searchParams;

    // A signed link handed to the phone's video player (it cannot log in).
    if (q.get("sig")) {
      if (!verifyClassMediaLink(id, q.get("exp"), q.get("sig"))) throw new ApiError("forbidden", "This link has expired.", 403);
      const media = await readClassMedia(id);
      if (!media || media.reviewStatus === "removed") throw new ApiError("not_found", "Not found", 404);
      if (media.evicted && media.driveFileId) return fromDrive(media.driveFileId, request);
      if (!media.path) throw new ApiError("not_found", "Not found", 404);
      return NextResponse.redirect(await signedMediaUrl(media.path), { status: 302, headers: { "Cache-Control": "private, no-store" } });
    }

    const ctx = await resolveApiAuth(request);
    const media = await readClassMedia(id);
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

    // ?link=1: the app asks with its login, then hands the link to the
    // phone's video player (which cannot send the login itself).
    const wantLink = q.get("link") === "1";
    if (media.evicted) {
      if (!media.driveFileId) throw new ApiError("not_found", "This file is no longer available.", 404);
      if (!wantLink) return fromDrive(media.driveFileId, request);
      const signed = signClassMediaLink(id);
      if (!signed) throw new ApiError("server_error", "Could not open the file — try again", 503);
      const base = (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, "");
      return apiOk({
        url: `${base}/api/v1/gallery/media/${encodeURIComponent(id)}?exp=${signed.exp}&sig=${signed.sig}`,
        expiresInSec: 600,
      });
    }
    const link = await signedMediaUrl(media.path);
    if (wantLink) return apiOk({ url: link, expiresInSec: 600 });
    return NextResponse.redirect(link, { status: 302, headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return apiErr(e);
  }
}
