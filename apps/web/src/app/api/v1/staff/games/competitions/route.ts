import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { sectionKey, staffSectionScope } from "@/lib/api/v1/staffScope";
import { cancelCompetition, canSeeCompetition, competitionDetail, createCompetition, gameNow, listCompetitions } from "@/lib/learningGames.server";
import { competitionGradeProblem, gameGrade, readCompetitionInput } from "@/lib/learningGames";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/v1/staff/games/competitions — the last 30 days' competitions this
 *      member of staff may see (created by them, or for one of their sections;
 *      principal / office: all).
 * POST { op: "create", game, sections:[{classId, sectionId}], subjectKey?,
 *        textbookId?, chapterPosition?, questionClassId?, questionCount?,
 *        opensAt?, durationMinutes, title? }
 *      A teacher may launch only for sections they teach (Staff → Duties /
 *      timetable). The sections must be in the same or neighbouring grade
 *      bands; the window is 5–60 minutes on one IST day. Quiz questions come from ONE class's approved pool
 *      (questionClassId, default the first section's class) and every player
 *      gets the same questions.
 * POST { op: "cancel", id } — its creator, or principal / office.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const scope = await staffSectionScope(ctx);
    const staffId = ctx.session.staffId || "";
    const list = await listCompetitions((c) => canSeeCompetition(c, staffId, scope.unrestricted, scope.sections), gameNow(request));
    return apiOk({ competitions: list });
  } catch (e) {
    return apiErr(e);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const scope = await staffSectionScope(ctx);
    const nowMs = gameNow(request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    if (body.op === "cancel") {
      const id = String(body.id ?? "");
      const d = await competitionDetail(id, nowMs);
      const mine = !!ctx.session.staffId && d.competition.createdByStaffId === ctx.session.staffId;
      if (!mine && !scope.unrestricted) throw new ApiError("forbidden", "Only the teacher who launched it, or the office, can cancel it.", 403);
      await cancelCompetition(id);
      return apiOk({ cancelled: true });
    }
    if (body.op !== "create") throw new ApiError("bad_request", "op must be create or cancel", 400);

    const read = readCompetitionInput(body, nowMs);
    if (!read.ok) throw new ApiError("bad_request", read.error, 400);
    const input = read.input;
    const classOf = (id: string) => ctx.masters.classes.find((c) => c.id === id);
    const sectionOf = (id: string) => ctx.masters.sections.find((s) => s.id === id);
    for (const s of input.sections) {
      const sec = sectionOf(s.sectionId);
      if (!sec || sec.classId !== s.classId || !classOf(s.classId)) throw new ApiError("bad_request", "One of the sections is not in Masters.", 400);
      if (!scope.unrestricted && !scope.sections.has(sectionKey(s.classId, s.sectionId))) {
        throw new ApiError("forbidden", `You do not teach ${classOf(s.classId)?.name}-${sec.name}. Pick only your own sections.`, 403);
      }
    }
    // Same or neighbouring grade bands only (pre-primary, I–II, III–V, VI–VIII, IX–X, XI–XII).
    const sectionGrades = input.sections.map((s) => gameGrade(classOf(s.classId)?.name));
    const bandProblem = competitionGradeProblem(sectionGrades);
    if (bandProblem) throw new ApiError("bad_request", bandProblem, 400, { reason: "grade_bands" });
    const grades = sectionGrades.filter((g): g is number => g !== null);
    let grade: number | null;
    if (input.game === "quiz") {
      const qClass = String(body.questionClassId || input.sections[0]!.classId);
      if (!input.sections.some((s) => s.classId === qClass)) throw new ApiError("bad_request", "The questions must come from one of the competing classes.", 400);
      grade = gameGrade(classOf(qClass)?.name);
    } else {
      grade = grades.length ? Math.min(...grades) : null;
    }
    const label = (classId: string, sectionId: string) => [classOf(classId)?.name, sectionOf(sectionId)?.name].filter(Boolean).join("-");
    const created = await createCompetition(ctx, input, grade, label, nowMs);
    return apiOk({ competition: created });
  } catch (e) {
    return apiErr(e);
  }
}
