import { apiErr, apiOk } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { chatActor, listConversations } from "@/lib/schoolChat.server";

export const runtime = "nodejs";

/**
 * GET /api/v1/school-chat/unread[?studentId=] — {unread} only: the number
 * the apps' chat badge shows (messages from others since the caller last
 * opened each of their own conversations; moderator oversight never counts).
 * The same reckoning as /conversations, without the list in the answer.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const actor = await chatActor(ctx, new URL(request.url).searchParams.get("studentId"));
    const out = await listConversations(ctx, actor);
    const unread = out.conversations.filter((c) => !c.oversight).reduce((n, c) => n + (c.unread || 0), 0);
    return apiOk({ unread, blocked: out.blocked });
  } catch (e) {
    return apiErr(e);
  }
}
