import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import {
  visionConfigured,
  visionExtractText,
} from "@/lib/googleVision.server";
import {
  parseSyllabusFromText,
  syllabusOcrQuality,
} from "@/lib/syllabusOcr";

export const runtime = "nodejs";

/**
 * POST /api/v1/teaching/syllabus-scan — mobile twin of
 * /api/ocr/syllabus, on bearer auth.
 *
 * Read-only: returns chapter candidates for the teacher to review in the
 * app. Saving goes through /api/v1/teaching/syllabus-import.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "teaching", "view");

    const body = (await request.json()) as {
      imageBase64?: string;
      mimeType?: string;
    };
    const imageBase64 = (body.imageBase64 || "").trim();
    if (!imageBase64) {
      throw new ApiError("bad_request", "imageBase64 required", 400);
    }

    if (!visionConfigured()) {
      throw new ApiError(
        "server_error",
        "Text recognition is not switched on for this school yet",
        503,
      );
    }

    const vision = await visionExtractText({
      imageBase64,
      mimeType: body.mimeType,
    });
    if (!vision.ok) {
      throw new ApiError("bad_request", vision.error, 400);
    }

    const parsed = parseSyllabusFromText(vision.text);
    return apiOk({
      chapters: parsed.chapters,
      ignored: parsed.ignored,
      quality: syllabusOcrQuality(parsed),
      rawText: vision.text,
    });
  } catch (e) {
    return apiErr(e);
  }
}
