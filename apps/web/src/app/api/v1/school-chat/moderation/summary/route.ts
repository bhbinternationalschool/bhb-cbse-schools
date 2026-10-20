import { apiErr, apiOk } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { behaviourSummary, requireModerator } from "@/lib/schoolChat.server";

export const runtime = "nodejs";

/** GET /api/v1/school-chat/moderation/summary?days=7 — per-person held / removed / warned counts, repeat flags, active mutes. */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    requireModerator(ctx);
    return apiOk(await behaviourSummary(Number(new URL(request.url).searchParams.get("days") || 7)));
  } catch (e) {
    return apiErr(e);
  }
}

