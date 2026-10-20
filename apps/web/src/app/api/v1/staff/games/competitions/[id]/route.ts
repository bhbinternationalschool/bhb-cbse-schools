import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { staffSectionScope } from "@/lib/api/v1/staffScope";
import { canSeeCompetition, competitionDetail, gameNow, settleExpiredCompetitionGames } from "@/lib/learningGames.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/staff/games/competitions/<id> — the live leaderboard: each
 * section's players, right answers and stars, ranked by right answers per
 * player, and the top players (first name + class). Polled by the ERP while
 * the competition is open.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await resolveApiAuth(request);
    const scope = await staffSectionScope(ctx);
    const { id } = await params;
    const nowMs = gameNow(request);
    await settleExpiredCompetitionGames(id, nowMs);
    const d = await competitionDetail(id, nowMs);
    if (!canSeeCompetition(d.competition, ctx.session.staffId || "", scope.unrestricted, scope.sections)) {
      throw new ApiError("not_found", "No such competition.", 404);
    }
    return apiOk(d);
  } catch (e) {
    return apiErr(e);
  }
}
