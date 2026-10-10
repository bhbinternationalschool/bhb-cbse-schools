import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import {
  assertClassSubjectScope,
  staffSectionScope,
} from "@/lib/api/v1/staffScope";
import {
  visionConfigured,
  visionExtractText,
} from "@/lib/googleVision.server";
import {
  parseSyllabusFromText,
  syllabusOcrQuality,
} from "@/lib/syllabusOcr";

export const runtime = "nodejs";

/** A contents list rarely runs past two pages; four leaves room for an index. */
const MAX_PAGES = 4;

type ScanImage = { imageBase64?: string; mimeType?: string };

/**
 * POST /api/v1/teaching/syllabus-scan — read a contents page into chapter
 * candidates. Used by the staff app and, since 2026-09-30, by the web
 * Teaching → Syllabus screen.
 *
 * Accepts a contents page as EITHER photos (imageBase64, or `images` for a
 * list that runs over more than one page — run through Vision OCR) OR text
 * pasted straight in. The pasted path matters for the e-book shelf: a book
 * on FlipHTML5 is already a clean digital page, so making a teacher
 * photograph their own screen and OCR the photo only adds errors.
 *
 * Several pages are read and joined BEFORE parsing, not parsed one by one:
 * a "3.2" topic at the top of page two belongs to chapter 3 on page one,
 * and parsing the pages apart would orphan it.
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

    const body = (await request.json()) as ScanImage & {
      images?: ScanImage[];
      text?: string;
      classId?: string;
      subjectId?: string;
    };

    // Scope (2026-09-30). The scan saves nothing, but every photo is a paid
    // Vision call and the first step of an import into ONE class's plan — so
    // a teacher scans for a class and subject they teach. The web screen
    // always names them. The staff app (which does not yet) is held to
    // "teaches something": a session with no classes has no plan to import
    // into. The import route checks the class and subject again regardless.
    const classId = String(body.classId || "").trim();
    const subjectId = String(body.subjectId || "").trim();
    if (classId || subjectId) {
      if (!ctx.masters.classes.some((c) => c.id === classId)) {
        throw new ApiError("bad_request", "Unknown class", 400);
      }
      if (!ctx.masters.subjects.some((s) => s.id === subjectId)) {
        throw new ApiError("bad_request", "Unknown subject", 400);
      }
      await assertClassSubjectScope(ctx, classId, "", subjectId);
    } else {
      const scope = await staffSectionScope(ctx);
      if (!scope.unrestricted && scope.teaching.length === 0) {
        throw new ApiError(
          "forbidden",
          "No classes are linked to you yet — ask the office to add them (Staff → Duties)",
          403,
        );
      }
    }

    const pastedText = (body.text || "").trim();
    const images: ScanImage[] = (
      Array.isArray(body.images) && body.images.length
        ? body.images
        : [{ imageBase64: body.imageBase64, mimeType: body.mimeType }]
    ).filter((i) => String(i?.imageBase64 || "").trim());
    if (images.length > MAX_PAGES) {
      throw new ApiError(
        "bad_request",
        `At most ${MAX_PAGES} pages at a time — scan the rest separately`,
        400,
      );
    }

    // Pasted text is taken as-is — it needs no OCR and no Vision key, so an
    // e-book contents list works even where text recognition is switched off.
    let sourceText: string;
    let source: "text" | "ocr";
    if (pastedText) {
      sourceText = pastedText;
      source = "text";
    } else if (images.length) {
      if (!visionConfigured()) {
        throw new ApiError(
          "server_error",
          "Text recognition is not switched on for this school yet — paste the contents list instead",
          503,
        );
      }
      const pages: string[] = [];
      for (const [i, img] of images.entries()) {
        const vision = await visionExtractText({
          imageBase64: String(img.imageBase64).trim(),
          mimeType: img.mimeType,
        });
        if (!vision.ok) {
          // Say which page: "could not read" about a two-page scan when one
          // page was fine sends the teacher off to retake both.
          const which = images.length > 1 ? `Page ${i + 1}: ` : "";
          throw new ApiError("bad_request", `${which}${vision.error}`, 400);
        }
        pages.push(vision.text);
      }
      sourceText = pages.join("\n");
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
