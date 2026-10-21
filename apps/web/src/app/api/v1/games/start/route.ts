import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { requireParentHousehold } from "@/lib/api/v1/household";
import { gameNow, resolveGameChild, startGame } from "@/lib/learningGames.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/games/start
 *   { studentId, game: "quiz", subjectKey, textbookId?, chapterPosition? }
 *   { studentId, game: "maths_speed", lang? }
 *   { studentId, competitionId }
 * → { sessionId, items: [{prompt, options, picture?}], deadlineAt, secondsLeft }
 *
 * The limits are decided here (lib/learningGames playVerdict): 403 with
 * error.details.reason night | school_hours | daily_cap | competition_closed
 * | disabled. The items carry no answers.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    requireParentHousehold(ctx);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const child = await resolveGameChild(ctx, String(body.studentId ?? ""));
    const competitionId = String(body.competitionId ?? "").slice(0, 60);
    const game = body.game === "maths_speed" ? "maths_speed" : body.game === "quiz" ? "quiz" : null;
    if (!competitionId && !game) throw new ApiError("bad_request", "game must be quiz or maths_speed", 400);
    const chapter = body.chapterPosition === undefined || body.chapterPosition === null || body.chapterPosition === "" ? null : Number(body.chapterPosition);
    const started = await startGame(
      ctx,
      child,
      {
        game: game ?? "quiz",
        subjectKey: String(body.subjectKey ?? "").slice(0, 30),
        textbookId: String(body.textbookId ?? "").slice(0, 120),
        chapterPosition: chapter !== null && Number.isInteger(chapter) ? chapter : null,
        competitionId: competitionId || undefined,
        lang: body.lang === "hi" ? "hi" : "en",
      },
      gameNow(request),
    );
    return apiOk(started);
  } catch (e) {
    return apiErr(e);
  }
}
