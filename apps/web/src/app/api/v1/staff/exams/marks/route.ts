import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { ensureExamsHydratedServer } from "@/lib/examsPersistence";
import {
  componentsForTerm,
  getExamPolicy,
  loadExams,
  prepareMarkSheet,
  schemeForClassId,
} from "@/lib/exams";
import {
  fetchExamSheetByKeyFromDb,
  pushExamSheetToDb,
} from "@/lib/examsNormalized.server";
import { assertSectionScope } from "@/lib/api/v1/staffScope";

export const runtime = "nodejs";

type Body = {
  termId?: string;
  classId?: string;
  sectionId?: string;
  subjectId?: string;
  marks?: { studentId: string; marksObtained: number | null }[];
};

/**
 * POST /api/v1/staff/exams/marks — save one subject's marks for a section
 * and exam. Merges into the section's mark sheet (other subjects untouched),
 * validates against max marks the way the exams desk does, and writes THAT
 * sheet to the desk tables. null = not entered / absent.
 *
 * The sheet being merged into is read from the database for this request,
 * not from the process-wide exams cache: two teachers saving different
 * subjects of the same section at once used to interleave on that cache,
 * and the second push could carry a sheet without the first one's marks. The
 * write is refused (409) if the sheet changed between the read and the
 * write, and the app re-fetches and retries.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "exams", "edit");
    const body = (await request.json().catch(() => ({}))) as Body;
    const termId = (body.termId || "").trim();
    const classId = (body.classId || "").trim();
    const sectionId = (body.sectionId || "").trim();
    const subjectId = (body.subjectId || "").trim();
    const entries = Array.isArray(body.marks) ? body.marks : [];
    if (!termId || !classId || !sectionId || !subjectId) {
      throw new ApiError("bad_request", "termId, classId, sectionId, subjectId required", 400);
    }
    if (!entries.length) throw new ApiError("bad_request", "No marks to save", 400);
    for (const e of entries) {
      if (e.marksObtained != null && (!Number.isFinite(e.marksObtained) || e.marksObtained < 0)) {
        throw new ApiError("bad_request", "Marks must be a number ≥ 0 or blank", 400);
      }
    }
    await assertSectionScope(ctx, classId, sectionId);

    await ensureSchoolMirrorHydrated();
    await Promise.all([ensureSisHydratedServer(), ensureExamsHydratedServer()]);
    const ay = ctx.session.academicYearCode;
    const state = loadExams();
    // The app enters one number per subject. A class assessed component-wise
    // (80 + 20, theory + practical) or by grades / descriptors is entered on
    // the desk, where those columns exist.
    const term = state.terms.find((t) => t.id === termId);
    const scheme = schemeForClassId(classId, getExamPolicy(state));
    if (term && componentsForTerm(scheme, term.code).length > 0) {
      throw new ApiError(
        "bad_request",
        `This class is assessed component-wise for ${term.label} (${componentsForTerm(scheme, term.code).map((c) => c.label).join(" + ")}). Enter these marks on the exams desk.`,
        400,
      );
    }
    if (scheme.displayMode !== "marks_grade") {
      throw new ApiError(
        "bad_request",
        "This class is assessed by grades, not marks. Enter them on the exams desk.",
        400,
      );
    }
    const existing = (await fetchExamSheetByKeyFromDb(ay, termId, sectionId)) ?? undefined;
    if (existing?.lockedAt) {
      throw new ApiError("forbidden", "This mark sheet is locked by the exams desk", 403);
    }

    const byKey = new Map(
      (existing?.marks ?? []).map((m) => [`${m.studentId}:${m.subjectId}`, m]),
    );
    for (const e of entries) {
      const key = `${e.studentId}:${subjectId}`;
      const prev = byKey.get(key);
      byKey.set(key, {
        studentId: e.studentId,
        subjectId,
        component: "",
        marksObtained: e.marksObtained == null ? null : Math.round(e.marksObtained * 2) / 2,
        grade: prev?.grade ?? "",
        remark: prev?.remark ?? "",
        remarkSource: prev?.remarkSource ?? "manual",
      });
    }

    const prepared = prepareMarkSheet(
      {
        academicYearCode: ay,
        examTermId: termId,
        classId,
        sectionId,
        marks: [...byKey.values()],
        enteredBy: ctx.session.fullName || "Teacher",
      },
      state,
      existing,
    );
    if (!prepared.ok) throw new ApiError("bad_request", prepared.error, 400);
    const pushed = await pushExamSheetToDb(prepared.sheet, {
      subjectsUsed: prepared.subjectsUsed,
      expectedUpdatedAt: existing?.updatedAt ?? null,
    });
    if (!pushed.ok) {
      if (pushed.conflict) throw new ApiError("conflict", pushed.error, 409);
      console.warn("[staff-exams-v1] push failed", pushed.error);
      throw new ApiError("server_error", "Could not save — try again", 503);
    }

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "exams",
      action: "edit",
      entityType: "mark_sheet",
      entityId: prepared.sheet.id,
      summary: `Marks entered from app: ${entries.length} students, subject ${subjectId}, section ${sectionId}`,
      after: { termId, subjectId, count: entries.length },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    const saved = prepared.sheet.marks.filter((m) => m.subjectId === subjectId);
    return apiOk({
      sheetId: prepared.sheet.id,
      updatedAt: prepared.sheet.updatedAt,
      marks: saved.map((m) => ({
        studentId: m.studentId,
        marksObtained: m.marksObtained,
        grade: m.grade,
      })),
    });
  } catch (e) {
    return apiErr(e);
  }
}
