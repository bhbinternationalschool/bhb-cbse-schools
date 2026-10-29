import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, loadServerMasters, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { ensureExamsHydratedServer } from "@/lib/examsPersistence";
import {
  componentsForSubject,
  coScholasticAreasForClass,
  effectiveMaxMarks,
  findMarkSheet,
  getExamPolicy,
  gradedPartsForSubject,
  loadExams,
  schemeForClassId,
  subjectsForMarkEntry,
} from "@/lib/exams";
import { coScholasticRatingsFor } from "@/lib/examSchemes";
import { loadSisForStaff } from "@/lib/sis";
import { assertSectionScope, scopeAllowsSubjectCode } from "@/lib/api/v1/staffScope";

export const runtime = "nodejs";

/**
 * GET /api/v1/staff/exams/sheet?termId=&classId=&sectionId= — the mark
 * entry grid for one section and exam: subjects with their max marks, the
 * roster in roll order, and whatever is already entered. Only the section's
 * teachers (or the office) can open it.
 *
 * Since 2026-10-11 a subject may carry `gradedParts` (Handwriting graded
 * A/B/C — `assess: "grade"` with the allowed `grades`) and each student's
 * mark entry the picked letters in `gradedParts`. Both are additive: the
 * old fields keep their meaning, and `marksObtained` is always the whole
 * subject mark, never a graded part.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "exams", "view");
    const url = new URL(request.url);
    const termId = url.searchParams.get("termId")?.trim() || "";
    const classId = url.searchParams.get("classId")?.trim() || "";
    const sectionId = url.searchParams.get("sectionId")?.trim() || "";
    if (!termId || !classId || !sectionId) {
      throw new ApiError("bad_request", "termId, classId, sectionId required", 400);
    }
    const scope = await assertSectionScope(ctx, classId, sectionId);

    await ensureSchoolMirrorHydrated();
    await Promise.all([ensureSisHydratedServer(), ensureExamsHydratedServer()]);
    const ay = scope.academicYearCode;
    const state = loadExams();
    const term = state.terms.find((t) => t.id === termId && t.academicYearCode === ay);
    if (!term) throw new ApiError("not_found", "Exam term not found", 404);

    const sis = loadSisForStaff();
    const students = sis.students
      .filter(
        (s) =>
          s.status === "active" &&
          s.classId === classId &&
          s.sectionId === sectionId &&
          s.academicYearCode === ay,
      )
      .sort((a, b) => {
        const ra = parseInt(a.rollNo, 10) || 9999;
        const rb = parseInt(b.rollNo, 10) || 9999;
        return ra - rb || a.fullName.localeCompare(b.fullName);
      });

    // Only the subjects this teacher teaches here (a class teacher sees all).
    const scheme = schemeForClassId(classId, getExamPolicy(state));
    // 2.3b: the school setup from the server's reference cache (503 when unread).
    const masters = await loadServerMasters();
    const subjects = subjectsForMarkEntry(classId, students, state, { masters, sis })
      .filter((s) => scopeAllowsSubjectCode(scope, classId, sectionId, s.code))
      .map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      maxMarks: effectiveMaxMarks(term, s),
      // A subject marked in parts (English = Written 80 + Oral 20, or a
      // 100-mark subject = 80 + four internals): one numeric column per part,
      // each with its own maximum. Empty = one whole mark out of maxMarks.
      marksParts: componentsForSubject(scheme, term.code, s.code).map((c) => ({
        code: c.code,
        label: c.label,
        maxMarks: c.maxMarks,
        kind: c.kind,
      })),
      gradedParts: gradedPartsForSubject(scheme, term.code, s.code).map((g) => ({
        code: g.code,
        label: g.label,
        assess: "grade" as const,
        grades: g.grades,
      })),
    }));
    const sheet = findMarkSheet(ay, termId, sectionId, state);
    // The whole-subject row only: a graded part's row (marksObtained null)
    // must never stand in for the subject's mark.
    const marks = new Map(
      (sheet?.marks ?? []).filter((m) => !m.component).map((m) => [`${m.studentId}:${m.subjectId}`, m]),
    );
    const partRows = new Map(
      (sheet?.marks ?? [])
        .filter((m) => m.component)
        .map((m) => [`${m.studentId}:${m.subjectId}:${m.component}`, m]),
    );

    // Co-scholastic subjects / activities (Work Education, Music, Discipline…)
    // are graded A/B/C (A–E on a five-band scale), never marked. The areas and
    // the allowed grades come from the class's scheme and Masters — the app
    // never hard-codes a grade list. Empty areas → the app shows no section.
    const coScholasticAreas = coScholasticAreasForClass(classId, getExamPolicy(state), masters);
    const coScholasticGrades = coScholasticRatingsFor(scheme.coScholasticScale);
    const coschByStudent = new Map<string, Map<string, string>>();
    for (const e of sheet?.coScholastic ?? []) {
      if (!e.rating) continue;
      const m = coschByStudent.get(e.studentId) ?? new Map<string, string>();
      m.set(e.domain, e.rating);
      coschByStudent.set(e.studentId, m);
    }

    return apiOk({
      academicYearCode: ay,
      term: { id: term.id, label: term.label, maxMarks: term.maxMarks },
      classId,
      sectionId,
      passPercent: getExamPolicy(state).passPercent,
      locked: !!sheet?.lockedAt,
      updatedAt: sheet?.updatedAt || "",
      enteredBy: sheet?.enteredBy || "",
      subjects,
      // The graded co-scholastic side of the sheet, alongside the marked
      // subjects. Areas empty = this class has none (the app shows nothing).
      coScholastic: {
        scale: scheme.coScholasticScale,
        grades: coScholasticGrades,
        areas: coScholasticAreas.map((a) => ({ code: a.code, label: a.label })),
      },
      students: students.map((st) => ({
        id: st.id,
        fullName: st.fullName,
        rollNo: st.rollNo,
        // One row per co-scholastic area this class has, pre-filled with the
        // letter already given (empty = not yet rated). The app grades these.
        coScholastic: coScholasticAreas.map((a) => ({
          domain: a.code,
          rating: coschByStudent.get(st.id)?.get(a.code) ?? "",
        })),
        marks: subjects.map((sub) => {
          const m = marks.get(`${st.id}:${sub.id}`);
          return {
            subjectId: sub.id,
            marksObtained: m?.marksObtained ?? null,
            grade: m?.grade ?? "",
            // Each numeric marks part's own entry, so the app pre-fills a
            // field per part. Empty when the subject is not split.
            parts: sub.marksParts.map((c) => {
              const row = partRows.get(`${st.id}:${sub.id}:${c.code}`);
              return { component: c.code, marksObtained: row?.marksObtained ?? null };
            }),
            gradedParts: sub.gradedParts.map((g) => {
              const got = partRows.get(`${st.id}:${sub.id}:${g.code}`)?.grade ?? "";
              return { component: g.code, grade: got && got !== "—" ? got : "" };
            }),
          };
        }),
      })),
    });
  } catch (e) {
    return apiErr(e);
  }
}
