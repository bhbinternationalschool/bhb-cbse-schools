import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { requireParentHousehold } from "@/lib/api/v1/household";
import {
  competitionDetail,
  competitionAudience,
  gameNow,
  resolveGameChild,
  settleExpiredCompetitionGames,
  weeklyBoard,
} from "@/lib/learningGames.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/games/leaderboard?studentId=&competitionId=
 *   with competitionId: that competition's sections and top players (the
 *     child's section must be in it);
 *   without: this week's stars in the child's section and in the school.
 * First names and class only — no surname, phone, photo or id.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    requireParentHousehold(ctx);
    const url = new URL(request.url);
    const child = await resolveGameChild(ctx, url.searchParams.get("studentId") ?? "");
    const nowMs = gameNow(request);
    const competitionId = url.searchParams.get("competitionId") ?? "";
    if (competitionId) {
      // The child's section first: a family outside the competition must
      // not be able to make the server close (write) anyone's games.
      const audience = await competitionAudience(competitionId);
      if (!audience || !audience.sections.some((s) => s.sectionId === child.student.sectionId)) {
        throw new ApiError("not_found", "This competition is not for your class.", 404);
      }
      await settleExpiredCompetitionGames(competitionId, nowMs);
      const d = await competitionDetail(competitionId, nowMs);
      const { createdByStaffId: _hidden, ...competition } = d.competition;
      void _hidden;
      return apiOk({ kind: "competition", competition, playing: d.playing, finished: d.finished, sections: d.sections, players: d.players });
    }
    const [section, school] = await Promise.all([weeklyBoard(nowMs, child.student.sectionId), weeklyBoard(nowMs)]);
    return apiOk({
      kind: "week",
      weekStart: school.weekStart,
      classLabel: child.classLabel,
      classPlayers: section.players,
      schoolSections: school.sections.slice(0, 15).map(({ label, stars, players }) => ({ label, stars, players })),
      schoolPlayers: school.players,
    });
  } catch (e) {
    return apiErr(e);
  }
}
