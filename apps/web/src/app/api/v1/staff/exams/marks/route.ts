import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, loadServerMasters, requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { loadSis } from "@/lib/sis";
import { assertMobileFeature } from "@/lib/api/v1/mobileAccess.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { ensureExamsHydratedServer } from "@/lib/examsPersistence";
import {
  componentsForSubject,
  coScholasticAreasForClass,
  getExamPolicy,
  gradedPartsForSubject,
  loadExams,
  prepareMarkSheet,
  schemeForClassId,
} from "@/lib/exams";
import { coScholasticRatingsFor } from "@/lib/examSchemes";
import {
  mergeStaffAppCoScholastic,
  mergeStaffAppEntries,
  staffAppCoScholasticProblem,
  staffAppEntriesProblem,
  type StaffAppCoScholasticEntry,
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
  /** Co-scholastic grading (2026-10-29): one letter per student × area, on
   * the sheet's own co-scholastic list — sent instead of `marks`/`subjectId`. */
  coScholastic?: StaffAppCoScholasticEntry[];
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
    assertMobileFeature(ctx, "marks_entry");
    assertPermission(ctx, "exams", "edit");
    const body = (await request.json().catch(() => ({}))) as Body;
    const termId = (body.termId || "").trim();
    const classId = (body.classId || "").trim();
    const sectionId = (body.sectionId || "").trim();
    const coschEntries = Array.isArray(body.coScholastic) ? body.coScholastic : null;
    if (!termId || !classId || !sectionId) {
      throw new ApiError("bad_request", "termId, classId, sectionId required", 400);
    }
    const scope = await assertSectionScope(ctx, classId, sectionId);

    await ensureSchoolMirrorHydrated();
    await Promise.all([ensureSisHydratedServer(), ensureExamsHydratedServer()]);
    const ay = scope.academicYearCode;
    const state = loadExams();
    // The register, read once from the server's hydrated cache and shared by
    // both save paths (prepareMarkSheet needs it for either).
    const sis = loadSis();

    // Co-scholastic grading: letters saved to the sheet's own co-scholastic
    // list (never among the marks, so numeric entry is untouched). Section
    // scope + exams.edit gate it exactly like the marks grid — co-scholastic
    // is rated by whoever enters the class's marks, with no separate
    // class-teacher gate (see lib/exams CoScholasticDomain). No subjectId.
    if (coschEntries) {
      if (!coschEntries.length) throw new ApiError("bad_request", "No grades to save", 400);
      const term = state.terms.find((t) => t.id === termId && t.academicYearCode === ay);
      if (!term) throw new ApiError("not_found", "Exam term not found", 404);
      const policy = getExamPolicy(state);
      const scheme = schemeForClassId(classId, policy);
      const masters = await loadServerMasters();
      const areas = coScholasticAreasForClass(classId, policy, masters);
      const grades = coScholasticRatingsFor(scheme.coScholasticScale);
      const problem = staffAppCoScholasticProblem(coschEntries, { areas, grades });
      if (problem) throw new ApiError("bad_request", problem, 400);
      const existing = (await fetchExamSheetByKeyFromDb(ay, termId, sectionId)) ?? undefined;
      if (existing?.lockedAt) {
        throw new ApiError("forbidden", "This mark sheet is locked by the exams desk", 403);
      }
      const mergedCosch = mergeStaffAppCoScholastic(existing?.coScholastic ?? [], coschEntries);
      // marks: [] keeps every stored mark exactly as it is (prepareMarkSheet
      // keeps subjects not sent); only the co-scholastic list is rewritten.
      const prepared = prepareMarkSheet(
        {
          academicYearCode: ay,
          examTermId: termId,
          classId,
          sectionId,
          marks: [],
          coScholastic: mergedCosch,
          enteredBy: ctx.session.fullName || "Teacher",
        },
        state,
        existing,
        { masters, sis },
      );
      if (!prepared.ok) throw new ApiError("bad_request", prepared.error, 400);
      const pushed = await pushExamSheetToDb(prepared.sheet, {
        subjectsUsed: prepared.subjectsUsed,
        expectedUpdatedAt: existing?.updatedAt ?? null,
      });
      if (!pushed.ok) {
        if (pushed.conflict) throw new ApiError("conflict", pushed.error, 409);
        console.warn("[staff-exams-v1] co-scholastic push failed", pushed.error);
        throw new ApiError("server_error", "Could not save — try again", 503);
      }
      const meta = requestMeta(request);
      await writeAudit({
        session: ctx.session,
        module: "exams",
        action: "edit",
        entityType: "mark_sheet",
        entityId: prepared.sheet.id,
        summary: `Co-scholastic grades entered from app: ${coschEntries.length} entries, section ${sectionId}`,
        after: { termId, sectionId, count: coschEntries.length },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      const codes = new Set(areas.map((a) => a.code));
      return apiOk({
        sheetId: prepared.sheet.id,
        updatedAt: prepared.sheet.updatedAt,
        coScholastic: prepared.sheet.coScholastic
          .filter((e) => codes.has(e.domain))
          .map((e) => ({ studentId: e.studentId, domain: e.domain, rating: e.rating ?? "" })),
      });
    }

    const subjectId = (body.subjectId || "").trim();
    const entries = Array.isArray(body.marks) ? body.marks : [];
    if (!subjectId) {
      throw new ApiError("bad_request", "subjectId required", 400);
    }
    if (!entries.length) throw new ApiError("bad_request", "No marks to save", 400);
    for (const e of entries) {
      if (e?.marksObtained != null && (typeof e.marksObtained !== "number" || !Number.isFinite(e.marksObtained) || e.marksObtained < 0)) {
        throw new ApiError("bad_request", "Marks must be a number ≥ 0 or blank", 400);
      }
    }
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
    // The app enters one number per subject, a number per numeric marks part
    // of a split subject (English = Written 80 + Oral 20, each sent with its
    // `component` and validated against its own max), and the letter of a
    // graded part (Handwriting A/B/C). A grade-only / descriptor scheme is
    // still entered on the desk, where those columns exist.
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
      // 2.3b: the school setup from the server's reference cache (503 when
      // unread), never an empty copy; the register as the lib used to load it.
      { masters: await loadServerMasters(), sis },
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
