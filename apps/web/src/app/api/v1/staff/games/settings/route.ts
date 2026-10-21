import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { assertSchoolWide, staffSectionScope } from "@/lib/api/v1/staffScope";
import { gameNow, readGameSettings, saveGameSettings } from "@/lib/learningGames.server";
import { normalizeGameSettings, settingsProblems } from "@/lib/learningGames";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/v1/staff/games/settings → the school's game limits (any staff).
 * POST /api/v1/staff/games/settings {dailyMinutes, playFrom, playUntil,
 *   schoolStart, schoolEnd, schoolDays, enabled} — principal / office only.
 * The limits are enforced by the game routes, not by the app.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const scope = await staffSectionScope(ctx);
    return apiOk({ settings: await readGameSettings(), canEdit: scope.unrestricted });
  } catch (e) {
    return apiErr(e);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    await assertSchoolWide(ctx);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const s = normalizeGameSettings(body);
    const problems = settingsProblems(s);
    if (problems.length) throw new ApiError("bad_request", problems.join(" "), 400);
    await saveGameSettings(s, ctx.session.fullName || ctx.session.email || "staff", gameNow(request));
    return apiOk({ settings: await readGameSettings(), canEdit: true });
  } catch (e) {
    return apiErr(e);
  }
}
