import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { assertSectionScope, staffWorkingYear } from "@/lib/api/v1/staffScope";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { ensurePtmHydratedServer } from "@/lib/ptmPersistence";
import { ensureExamsHydratedServer } from "@/lib/examsPersistence";
import { ensureHomeworkHydratedServer } from "@/lib/homeworkPersistence";
import { ensureAttendanceHydratedServer } from "@/lib/attendancePersistence";
import { setServerAttendanceResultOverrides } from "@/lib/attendanceResultOverrides";
import { readModuleLocalState } from "@/lib/moduleLocalState.server";
import { emptyDisciplineState, normalizeDisciplineState } from "@/lib/discipline";
import { householdOf, loadSis } from "@/lib/sis";
import { loadPtm } from "@/lib/ptm";
import { buildPtmBriefFacts } from "@/lib/ptmBriefFacts";
import { cleanPtmBriefFacts } from "@/lib/ptmBriefAi";
import { draftPtmBrief } from "@/lib/ptmBriefDraft.server";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  /** The PTM booking the brief is for (its own note is not "earlier"). */
  bookingId?: string;
  /** Or a child directly, for a meeting not booked through the app. */
  studentId?: string;
  teacherNote?: string;
};

/**
 * POST /api/v1/staff/ai/ptm-brief — the staff app's per-student brief before
 * a parent-teacher meeting. The web PTM tab builds the facts in the browser
 * and posts them to /api/ai/ptm-student-brief; a phone holds none of them,
 * so this route builds the SAME facts (lib/ptmBriefFacts) from the server's
 * copies and calls the same generator (lib/ptmBriefDraft) — same permission
 * (ptm.edit) and the same rule: only a child in one of the teacher's own
 * sections. The family's language comes from the register, not the phone.
 *
 * A source that cannot be read is left out ("not available" to the model),
 * never filled with a guess. Nothing is saved.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "ptm", "edit");
    const body = (await request.json().catch(() => ({}))) as Body;
    const bookingId = String(body.bookingId || "").trim();
    let studentId = String(body.studentId || "").trim();

    await ensureSchoolMirrorHydrated();
    await Promise.all([ensureSisHydratedServer(), ensurePtmHydratedServer()]);
    const ptm = loadPtm();
    if (bookingId) {
      const booking = ptm.bookings.find((b) => b.id === bookingId);
      if (!booking) throw new ApiError("not_found", "That booking no longer exists", 404);
      studentId = booking.studentId;
    }
    if (!studentId) throw new ApiError("bad_request", "Which student? bookingId or studentId required", 400);

    const sis = loadSis();
    const student = sis.students.find((s) => s.id === studentId);
    if (!student) throw new ApiError("not_found", "Student not found in the register", 404);
    // The class comes from the register, never from the phone.
    await assertSectionScope(ctx, student.classId, student.sectionId);

    const [, , , discRow, overridesRow] = await Promise.all([
      ensureExamsHydratedServer(),
      ensureHomeworkHydratedServer(),
      ensureAttendanceHydratedServer(),
      readModuleLocalState<unknown>("discipline"),
      readModuleLocalState<unknown>("attendance_result_overrides"),
    ]);
    if (overridesRow?.state) setServerAttendanceResultOverrides(overridesRow.state);
    // A conduct log that could not be read is "not available", not "clean":
    // an empty state makes buildPtmBriefFacts report it as not available.
    const discipline = discRow?.state ? normalizeDisciplineState(discRow.state) : emptyDisciplineState();

    const built = buildPtmBriefFacts({
      sis,
      masters: ctx.masters,
      ptm,
      studentId,
      excludeBookingId: bookingId || undefined,
      academicYearCode: staffWorkingYear(ctx),
      teacherNote: String(body.teacherNote ?? "").slice(0, 500),
      discipline,
    });
    const facts = built ? cleanPtmBriefFacts(built) : null;
    if (!facts) {
      throw new ApiError(
        "bad_request",
        "Nothing to brief on yet — no marks, attendance, homework, conduct or earlier notes for this student",
        400,
      );
    }

    const household = householdOf(sis, student.householdId);
    const r = await draftPtmBrief({ facts, householdLanguage: household?.preferredLanguage ?? "" });
    if (!r.ok) {
      if (/daily AI|budget/i.test(r.error)) throw new ApiError("forbidden", r.error, 429);
      throw new ApiError("server_error", r.error || "The brief could not be written — try again", 502);
    }
    return apiOk({
      studentId,
      studentName: student.fullName,
      engine: r.engine,
      model: r.model,
      language: r.language,
      requestedLanguage: r.requestedLanguage,
      generationId: r.generationId,
      draft: r.draft,
      warnings: r.warnings,
      /** What the brief stood on, so the teacher knows what was missing. */
      basis: {
        terms: facts.terms.map((t) => t.label),
        attendance: facts.attendancePercent != null,
        homework: facts.homework != null,
        conduct: facts.discipline != null,
        earlierNotes: facts.priorFeedback.length,
      },
    });
  } catch (e) {
    return apiErr(e);
  }
}
