/** POST /api/v1/staff/class-gallery/complete { albumId, photoId, path, caption? } — record it and copy to Drive. */
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { finishClassUpload } from "@/lib/classGallery.server";

export const runtime = "nodejs";
// A 100 MB video is read back from storage and sent on to Drive.
export const maxDuration = 300;

export async function POST(request: Request) {
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
      }),
    );
  } catch (e) {
    return apiErr(e);
  }
}
