/**
 * Shared checks and reads for the staff app's teacher AI tools
 * (/api/v1/staff/ai/*, 2026-10-13).
 *
 * The web ERP's /api/ai/* routes take the facts the browser already holds
 * (ticked chapters with their outcomes, a student's marks). A phone holds
 * none of that, so these routes take ids and read the facts here — the
 * teaching plan from its stored blob, never from the client — and then call
 * the very same generator the web route calls.
 *
 * Teacher scope on top of the web's module permission: a teacher may ask for
 * a paper, worksheet or plan only for a subject they teach in that class (or
 * a class they are class teacher of); leadership and the office are
 * school-wide, exactly as on every other v1 write.
 */

import "server-only";
import { ApiError } from "@/lib/api/v1/errors";
import type { ApiAuthContext } from "@/lib/api/v1/auth";
import { assertClassSubjectScope, staffWorkingYear } from "@/lib/api/v1/staffScope";
import { normalizeTeachingState, type SyllabusUnit, type TeachingState } from "@/lib/teaching";
import type { ExamPaperUnitFact } from "@/lib/examPaperAiLlm.server";
import type { ExamPaperQuestion, ExamPaperSection } from "@/lib/examPapers";

/** 400 for an unknown class / subject, 403 outside the teacher's subjects. */
export async function assertAiClassSubject(
  ctx: ApiAuthContext,
  classId: string,
  subjectId: string,
): Promise<void> {
  if (!classId || !subjectId) {
    throw new ApiError("bad_request", "classId and subjectId required", 400);
  }
  if (!ctx.masters.classes.some((c) => c.id === classId)) {
    throw new ApiError("bad_request", "Unknown class", 400);
  }
  if (!ctx.masters.subjects.some((s) => s.id === subjectId)) {
    throw new ApiError("bad_request", "Unknown subject", 400);
  }
  await assertClassSubjectScope(ctx, classId, "", subjectId);
}

/**
 * The class + subject's chapters and topics from the Teaching plan, in
 * teaching order, for the session's working year.
 *
 * Read from the stored blob on purpose: the module's own loader is
 * browser-only and returns an empty plan on the server. `available: false`
 * means the plan could not be read at all (or was never set up) — the app
 * says so instead of showing "no chapters".
 */
export async function loadClassSubjectUnits(
  ctx: ApiAuthContext,
  classId: string,
  subjectId: string,
): Promise<{ available: boolean; units: SyllabusUnit[] }> {
  const { fetchServerBlob } = await import("@/lib/serverBlob");
  const remote = await fetchServerBlob<TeachingState>("teaching_state");
  if (!remote.state) return { available: false, units: [] };
  const state = normalizeTeachingState(remote.state);
  const ay = staffWorkingYear(ctx);
  const units = state.units
    .filter(
      (u) =>
        u.isActive &&
        u.academicYearCode === ay &&
        u.classId === classId &&
        u.subjectId === subjectId,
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return { available: true, units };
}

/**
 * The units the teacher ticked, in the order they were ticked; unknown ids
 * (another class's chapter, a deleted one) are dropped, never trusted.
 */
export function pickUnits(all: SyllabusUnit[], unitIds: unknown, max = 12): SyllabusUnit[] {
  const byId = new Map(all.map((u) => [u.id, u]));
  const ids = Array.isArray(unitIds) ? unitIds.map((x) => String(x ?? "").trim()) : [];
  const seen = new Set<string>();
  const out: SyllabusUnit[] = [];
  for (const id of ids) {
    const u = byId.get(id);
    if (!u || seen.has(id)) continue;
    seen.add(id);
    out.push(u);
    if (out.length >= max) break;
  }
  return out;
}

/** The exam-paper generator's unit facts — what the web editor sends. */
export function unitFactsOf(units: SyllabusUnit[]): ExamPaperUnitFact[] {
  return units.map((u) => ({
    id: u.id,
    code: u.code,
    title: u.title,
    level: u.level,
    learningOutcomes: u.learningOutcomes,
    competencyCodes: u.competencyCodes,
  }));
}

/**
 * A question as the phone shows and copies it — what a teacher reads on a
 * printed paper plus the key and marking steps (teacher copy). Pictures are
 * not carried: the app says a question has one, never pretends it has none.
 */
export function compactQuestion(q: ExamPaperQuestion) {
  return {
    type: q.type,
    text: q.text,
    marks: q.marks,
    hardness: q.hardness,
    options: q.options ?? [],
    answerKey: q.answerKey ?? "",
    markingScheme: q.markingScheme ?? [],
    pairs: q.pairs ?? [],
    attemptAny: q.attemptAny ?? 0,
    hasImages: (q.images ?? []).length > 0,
    subQuestions: (q.subQuestions ?? []).map((s) => ({
      text: s.text,
      marks: s.marks,
      type: s.type,
      options: s.options ?? [],
      answerKey: s.answerKey ?? "",
    })),
  };
}

export function compactSection(s: ExamPaperSection) {
  return {
    title: s.title,
    instructions: s.instructions,
    questions: (s.questions ?? []).map(compactQuestion),
  };
}
