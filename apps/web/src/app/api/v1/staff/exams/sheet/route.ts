import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { ensureExamsHydratedServer } from "@/lib/examsPersistence";
import {
  effectiveMaxMarks,
  findMarkSheet,
  getExamPolicy,
  loadExams,
  subjectsForMarkEntry,
} from "@/lib/exams";
import { loadSis } from "@/lib/sis";
import { assertSectionScope } from "@/lib/api/v1/staffScope";

export const runtime = "nodejs";

/**
 * GET /api/v1/staff/exams/sheet?termId=&classId=&sectionId= — the mark
 * entry grid for one section and exam: subjects with their max marks, the
 * roster in roll order, and whatever is already entered. Only the section's
 * teachers (or the office) can open it.
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
    await assertSectionScope(ctx, classId, sectionId);

    await ensureSchoolMirrorHydrated();
    await Promise.all([ensureSisHydratedServer(), ensureExamsHydratedServer()]);
    const ay = ctx.session.academicYearCode;
    const state = loadExams();
    const term = state.terms.find((t) => t.id === termId && t.academicYearCode === ay);
    if (!term) throw new ApiError("not_found", "Exam term not found", 404);

    const sis = loadSis();
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

    const subjects = subjectsForMarkEntry(classId, students, state).map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      maxMarks: effectiveMaxMarks(term, s),
    }));
    const sheet = findMarkSheet(ay, termId, sectionId, state);
    const marks = new Map((sheet?.marks ?? []).map((m) => [`${m.studentId}:${m.subjectId}`, m]));

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
      students: students.map((st) => ({
        id: st.id,
        fullName: st.fullName,
        rollNo: st.rollNo,
        marks: subjects.map((sub) => {
          const m = marks.get(`${st.id}:${sub.id}`);
          return {
            subjectId: sub.id,
            marksObtained: m?.marksObtained ?? null,
            grade: m?.grade ?? "",
          };
        }),
      })),
    });
  } catch (e) {
    return apiErr(e);
  }
}
