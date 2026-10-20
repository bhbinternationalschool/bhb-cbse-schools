import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { staffSectionScope } from "@/lib/api/v1/staffScope";
import { canSeeCompetition, competitionAudience, competitionDetail, gameNow, settleExpiredCompetitionGames } from "@/lib/learningGames.server";

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
    // Scope first: nothing is written for a competition this person may not see.
    const audience = await competitionAudience(id);
    if (!audience || !canSeeCompetition(audience, ctx.session.staffId || "", scope.unrestricted, scope.sections)) {
      throw new ApiError("not_found", "No such competition.", 404);
    }
    await settleExpiredCompetitionGames(id, nowMs);
    return apiOk(await competitionDetail(id, nowMs));
  } catch (e) {
    return apiErr(e);
  }
}
