/**
 * POST /api/v1/staff/class-gallery/upload-url { albumId, fileName, contentType, bytes }
 * → { photoId, path, uploadUrl, contentType, kind } — the phone PUTs the file to uploadUrl.
 */
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { startClassUpload } from "@/lib/classGallery.server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") throw new ApiError("forbidden", "Staff session required", 403);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return apiOk(
      await startClassUpload(ctx, {
        albumId: String(body.albumId ?? ""),
        fileName: String(body.fileName ?? ""),
        contentType: String(body.contentType ?? ""),
        bytes: Number(body.bytes) || 0,
      }),
    );
  } catch (e) {
    return apiErr(e);
  }
}
