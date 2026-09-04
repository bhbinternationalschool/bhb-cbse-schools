import { apiErr, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { childOfHousehold, requireParentHousehold } from "@/lib/api/v1/household";
import { wantsAiStream } from "@/lib/aiStream.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadSis } from "@/lib/sis";
import {
  answerParentTutor,
  parseTutorAsk,
  TUTOR_MESSAGE_MAX,
  type TutorAskBody,
} from "@/lib/tutorApi.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/tutor/ask — a parent asks the tutor. Streams when the
 * client sends Accept: text/event-stream; JSON otherwise. 402 with
 * `needsPass: true` when the household's allowance is spent.
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
    if (ask.studentId) {
      // The child named must be this household's — the context it carries
      // (name, class, assignment) is otherwise a parent's own claim.
      await ensureSchoolMirrorHydrated();
      childOfHousehold(loadSis(), ask.studentId, householdId);
    }
    return await answerParentTutor({ householdId, ask, stream: wantsAiStream(request) });
  } catch (e) {
    return apiErr(e);
  }
}
