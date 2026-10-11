import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { ensureExamsHydratedServer } from "@/lib/examsPersistence";
import {
  componentsForSubject,
  getExamPolicy,
  gradedPartsForSubject,
  loadExams,
  prepareMarkSheet,
  schemeForClassId,
} from "@/lib/exams";
import {
  mergeStaffAppEntries,
  staffAppEntriesProblem,
  type StaffAppMarkEntry,
} from "@/lib/staffExamMarks";
import {
  fetchExamSheetByKeyFromDb,
  pushExamSheetToDb,
} from "@/lib/examsNormalized.server";
import { assertSectionScope, scopeAllowsSubjectCode } from "@/lib/api/v1/staffScope";

export const runtime = "nodejs";

type Body = {
  termId?: string;
  classId?: string;
  sectionId?: string;
  subjectId?: string;
  /** `{ studentId, marksObtained }` = the whole mark (every app build).
   * `{ studentId, component, grade }` = a graded part's letter (2026-10-11). */
  marks?: StaffAppMarkEntry[];
};

/**
 * POST /api/v1/staff/exams/marks — save one subject's marks for a section
 * and exam. Merges into the section's mark sheet (other subjects untouched),
 * validates against max marks the way the exams desk does, and writes THAT
 * sheet to the desk tables. null = not entered / absent. A graded part
 * (Handwriting A/B/C) takes `component` + `grade` from its list — a number
 * or a letter off the list is refused (lib/staffExamMarks).
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
      if (e?.marksObtained != null && (typeof e.marksObtained !== "number" || !Number.isFinite(e.marksObtained) || e.marksObtained < 0)) {
        throw new ApiError("bad_request", "Marks must be a number ≥ 0 or blank", 400);
      }
    }
    const scope = await assertSectionScope(ctx, classId, sectionId);

    await ensureSchoolMirrorHydrated();
    await Promise.all([ensureSisHydratedServer(), ensureExamsHydratedServer()]);
    const ay = scope.academicYearCode;
    const state = loadExams();
    // Exam subjects carry their own ids; the teacher's subjects are matched
    // by code. A class teacher may enter every subject of their section.
    const examSubject = state.subjects.find((x) => x.id === subjectId);
    if (!scopeAllowsSubjectCode(scope, classId, sectionId, examSubject?.code || "")) {
      throw new ApiError(
        "forbidden",
        `${examSubject?.name || "This subject"} is not one of your subjects in this class — ask the office to add it (Staff → Duties)`,
        403,
      );
    }
    // The app enters one number per subject, and the letter of a graded
    // part. A class assessed component-wise (80 + 20, theory + practical) or
    // by grades / descriptors is entered on the desk, where those columns
    // exist. Per subject: English split into Written + Oral goes to the
    // desk, while a one-mark subject in the same class can still be entered
    // here — and English's Handwriting grade can be picked here too.
    const term = state.terms.find((t) => t.id === termId);
    const scheme = schemeForClassId(classId, getExamPolicy(state));
    const gradedParts = term ? gradedPartsForSubject(scheme, term.code, examSubject?.code || "") : [];
    const gradedCodes = new Set(gradedParts.map((g) => g.code));
    const problem = staffAppEntriesProblem(entries, {
      subjectName: examSubject?.name || "This subject",
      termLabel: term?.label || "this exam",
      marksParts: term ? componentsForSubject(scheme, term.code, examSubject?.code || "") : [],
      gradedParts,
      gradeOnlyScheme: scheme.displayMode !== "marks_grade",
    });
    if (problem) throw new ApiError("bad_request", problem, 400);
    const existing = (await fetchExamSheetByKeyFromDb(ay, termId, sectionId)) ?? undefined;
    if (existing?.lockedAt) {
      throw new ApiError("forbidden", "This mark sheet is locked by the exams desk", 403);
    }

    // Keyed by student × subject × part: a whole mark from an old app build
    // never lands on (or wipes) a graded part's row.
    const merged = mergeStaffAppEntries(existing?.marks ?? [], subjectId, entries);

    const prepared = prepareMarkSheet(
      {
        academicYearCode: ay,
        examTermId: termId,
        classId,
        sectionId,
        // Only the posted subject: every other subject's rows stay exactly
        // as stored (prepareMarkSheet keeps subjects not sent) and are not
        // re-validated — a stale letter elsewhere never blocks this save.
        marks: merged.filter((m) => m.subjectId === subjectId),
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
      // `marks` keeps its old shape: whole-subject rows only, one per
      // student, so an old build mapping rows by student never reads a
      // graded row as the mark. Graded letters go in an additive list.
      marks: saved
        .filter((m) => !m.component)
        .map((m) => ({
          studentId: m.studentId,
          marksObtained: m.marksObtained,
          grade: m.grade,
        })),
      gradedParts: saved
        .filter((m) => m.component && m.marksObtained == null && gradedCodes.has(m.component))
        .map((m) => ({
          studentId: m.studentId,
          component: m.component,
          grade: m.grade && m.grade !== "—" ? m.grade : "",
        })),
    });
  } catch (e) {
    return apiErr(e);
  }
}
