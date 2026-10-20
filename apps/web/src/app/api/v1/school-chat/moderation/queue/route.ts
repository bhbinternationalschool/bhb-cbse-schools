import { apiErr, apiOk } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { moderationQueue } from "@/lib/schoolChat.server";

export const runtime = "nodejs";

/** GET /api/v1/school-chat/moderation/queue — held messages (urgent first) and flagged staff messages. Moderators only. */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    return apiOk(await moderationQueue(ctx));
  } catch (e) {
    return apiErr(e);
  }
}

