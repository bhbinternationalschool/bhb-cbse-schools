import { apiErr, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { requireParentHousehold } from "@/lib/api/v1/household";
import { wantsAiStream } from "@/lib/aiStream.server";
import {
  answerParentTutor,
  parseTutorAsk,
  resolveTutorStudent,
  TUTOR_MESSAGE_MAX,
  type TutorAskBody,
} from "@/lib/tutorApi.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/tutor/ask — a parent asks the tutor for one child. The
 * child must be theirs; the class the tutor is pinned to comes from the
 * school's record. Streams when the client sends Accept: text/event-stream;
 * JSON otherwise. 402 with `needsPass: true` when that child's allowance
 * is spent.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const householdId = requireParentHousehold(ctx);
    const body = (await request.json().catch(() => ({}))) as TutorAskBody;
    const ask = parseTutorAsk(body);
    if (!ask.message) throw new ApiError("bad_request", "message required", 400);
    if (ask.message.length > TUTOR_MESSAGE_MAX) {
      throw new ApiError("bad_request", `Keep a message under ${TUTOR_MESSAGE_MAX} characters`, 400);
    }
    const student = await resolveTutorStudent(householdId, ask.studentId);
    return await answerParentTutor({ householdId, student, ask, stream: wantsAiStream(request) });
  } catch (e) {
    return apiErr(e);
  }
}
