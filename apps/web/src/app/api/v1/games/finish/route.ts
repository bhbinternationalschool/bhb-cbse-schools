import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { requireParentHousehold } from "@/lib/api/v1/household";
import { finishGame, gameNow } from "@/lib/learningGames.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/games/finish { sessionId }
 * → { total, answered, correct, stars, seconds, review[] }
 *
 * The score is counted from the answers the server judged, one per
 * question. A client's own idea of its score ("correct", "stars", "score"
 * in the body) is ignored — never read, never stored.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    requireParentHousehold(ctx);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const sessionId = String(body.sessionId ?? "").slice(0, 60);
    if (!sessionId) throw new ApiError("bad_request", "sessionId required", 400);
    return apiOk(await finishGame(ctx, sessionId, gameNow(request)));
  } catch (e) {
    return apiErr(e);
  }
}
