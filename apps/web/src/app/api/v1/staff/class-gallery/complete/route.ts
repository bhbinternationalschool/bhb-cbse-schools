/**
 * POST /api/v1/staff/class-gallery/complete { albumId, photoId, path, caption? }
 * — record it, run the AI check, and (once passed) copy it to Drive.
 * Returns status: "ok" (parents see it), "held" (the principal decides) or
 * "pending" (still checking; the scheduled tick finishes it).
 */
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { finishClassUpload } from "@/lib/classGallery.server";

export const runtime = "nodejs";
// A five-minute video is streamed to the AI check and on to Drive.
export const maxDuration = 300;

export async function POST(request: Request) {
  const deadline = Date.now() + 240_000;
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") throw new ApiError("forbidden", "Staff session required", 403);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return apiOk(
      await finishClassUpload(ctx, {
        albumId: String(body.albumId ?? ""),
        photoId: String(body.photoId ?? ""),
        path: String(body.path ?? ""),
        caption: String(body.caption ?? ""),
      }, deadline),
    );
  } catch (e) {
    return apiErr(e);
  }
}
