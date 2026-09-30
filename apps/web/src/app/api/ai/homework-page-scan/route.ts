/**
 * Homework from a photographed book page — draft only, nothing persisted.
 *
 * The Homework → Compose screen sends one to three photos of the page the
 * teacher is setting, with the class, section, subject and the language the
 * teacher wants the homework in. This route:
 *   1. gates on a staff session + homework:edit, and on the subject being
 *      one the teacher teaches in that section (assertSubjectScope — the
 *      same rule as POST /api/v1/homework/post), BEFORE any paid reading;
 *   2. asks Gemini to read the page (readHomeworkPageJson), keeping only
 *      numbers the page itself bears out;
 *   3. resolves the page's chapter against the class's own book for the
 *      tutor's chapter hint, or leaves it blank;
 *   4. returns the reading + generationId. The teacher ticks the questions,
 *      edits the text in the homework form and posts it the normal way; the
 *      form reports accepted / edited / rejected against the generationId.
 *
 * An unreadable page is a 200 with `reading.readable: false` and the reason
 * — a true answer about the page. A failed call is a 5xx — a claim about
 * us, not the page. The two are never merged.
 */

import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { assertSubjectScope } from "@/lib/api/v1/staffScope";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { readHomeworkPageJson } from "@/lib/aiLlm.server";
import { geminiConfigured } from "@/lib/erpAiGemini.server";
import { chapterHintForPage } from "@/lib/homeworkExpand.server";
import {
  cleanHomeworkPageScanInput,
  HOMEWORK_PAGE_MAX_IMAGES,
} from "@/lib/homeworkPageScanAi";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  return apiOk({
    service: "homework-page-scan",
    configured: geminiConfigured(),
    maxImages: HOMEWORK_PAGE_MAX_IMAGES,
    note: "POST { classId, sectionId, subjectId, language: en|hi, images: [{ imageBase64, mimeType }] } — staff with homework:edit who teach the subject in that section; returns a reading of the page, saves nothing",
  });
}

export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "homework", "edit");

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError("bad_request", "Invalid JSON", 400);
    }
    const input = cleanHomeworkPageScanInput(body);
    if (typeof input === "string") throw new ApiError("bad_request", input, 400);

    // Scope before the model: a refused teacher costs the school nothing.
    await ensureSchoolMirrorHydrated();
    await assertSubjectScope(ctx, input.classId, input.sectionId, input.subjectId);

    const cls = ctx.masters.classes.find((c) => c.id === input.classId);
    const sec = ctx.masters.sections.find((s) => s.id === input.sectionId);
    const sub = (ctx.masters.subjects ?? []).find((s) => s.id === input.subjectId);
    if (!cls || !sub) throw new ApiError("bad_request", "Unknown class or subject", 400);
    const classLabel = [cls.name, sec?.name || ""].filter(Boolean).join(" ");
    const subjectLabel = sub.nameEn || sub.id;

    const r = await readHomeworkPageJson({
      images: input.images,
      classLabel,
      subjectLabel,
      language: input.language,
      requester: ctx.session.email || ctx.session.fullName || "staff",
    });
    if (!r.ok) {
      if (r.failure === "not-configured") {
        throw new ApiError(
          "server_error",
          "Reading book pages is not switched on for this school yet — type the homework instead",
          503,
        );
      }
      if (r.failure === "budget") throw new ApiError("conflict", r.error, 429);
      console.warn("[homework-page-scan] read failed:", r.error);
      throw new ApiError(
        "server_error",
        "Could not read the page just now — try again, or type the homework instead",
        502,
      );
    }

    const chapterHint = r.reading.readable
      ? await chapterHintForPage({
          className: cls.name,
          subjectLabel,
          chapterHeading: r.reading.chapterHeading,
          exercise: r.reading.exercise,
        })
      : "";

    return apiOk({
      reading: r.reading,
      chapterHint,
      language: input.language,
      engine: r.engine,
      /** ai_generations row — the homework form reports accepted/edited/rejected against it */
      generationId: r.generationId,
    });
  } catch (e) {
    return apiErr(e);
  }
}
