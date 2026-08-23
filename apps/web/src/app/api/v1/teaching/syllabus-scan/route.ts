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
 * Accepts a contents page as EITHER a photo (imageBase64, run through Vision
 * OCR) OR text pasted straight in. The pasted path matters for the e-book
 * shelf: a book on FlipHTML5 is already a clean digital page, so making a
 * teacher photograph their own screen and OCR the photo only adds errors.
 * The book's structure is not machine-readable from the flipbook viewer, so a
 * person still copies the contents list — but they copy it once, and the
 * parser and the teacher's review do the rest.
 *
 * Read-only either way: returns chapter candidates for the teacher to confirm.
 * Nothing is written until /api/v1/teaching/syllabus-import, and nothing is
 * invented that was not on the page.
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
      text?: string;
    };
    const pastedText = (body.text || "").trim();
    const imageBase64 = (body.imageBase64 || "").trim();

    // Pasted text is taken as-is — it needs no OCR and no Vision key, so an
    // e-book contents list works even where text recognition is switched off.
    let sourceText: string;
    let source: "text" | "ocr";
    if (pastedText) {
      sourceText = pastedText;
      source = "text";
    } else if (imageBase64) {
      if (!visionConfigured()) {
        throw new ApiError(
          "server_error",
          "Text recognition is not switched on for this school yet — paste the contents list instead",
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
      sourceText = vision.text;
      source = "ocr";
    } else {
      throw new ApiError(
        "bad_request",
        "Paste the contents list, or send a photo of it",
        400,
      );
    }

    const parsed = parseSyllabusFromText(sourceText);
    return apiOk({
      chapters: parsed.chapters,
      ignored: parsed.ignored,
      quality: syllabusOcrQuality(parsed),
      rawText: sourceText,
      source,
    });
  } catch (e) {
    return apiErr(e);
  }
}
