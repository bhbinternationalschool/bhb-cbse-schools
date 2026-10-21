import { apiErr, apiOk } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { requireParentHousehold } from "@/lib/api/v1/household";
import { gameNow, gameStatus, resolveGameChild } from "@/lib/learningGames.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/games/status?studentId= — what the Games screen opens with,
 * for one child of the signed-in family: today's minutes played and left,
 * whether practice is open now (and why not), stars today / this week / in
 * all, the last seven days, open competitions for the child's section, and
 * the subjects and chapters with enough approved questions to practise.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    requireParentHousehold(ctx);
    const studentId = new URL(request.url).searchParams.get("studentId") ?? "";
    const child = await resolveGameChild(ctx, studentId);
    return apiOk(await gameStatus(ctx, child, gameNow(request)));
  } catch (e) {
    return apiErr(e);
  }
}
