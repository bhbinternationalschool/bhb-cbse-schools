import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { requireParentHousehold } from "@/lib/api/v1/household";
import { answerGame, gameNow } from "@/lib/learningGames.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/games/answer { sessionId, index, choice }
 * → { correct, correctIndex (null in a competition), secondsLeft }
 *
 * Judged against the server's copy of the question. Each question takes one
 * answer (409 reason "answered"); none after the game's deadline (409
 * "time_up"); a question or option that does not exist is a 400. Nothing
 * else in the body is read.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    requireParentHousehold(ctx);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const sessionId = String(body.sessionId ?? "").slice(0, 60);
    if (!sessionId) throw new ApiError("bad_request", "sessionId required", 400);
    return apiOk(await answerGame(ctx, sessionId, Number(body.index), Number(body.choice), gameNow(request)));
  } catch (e) {
    return apiErr(e);
  }
}
