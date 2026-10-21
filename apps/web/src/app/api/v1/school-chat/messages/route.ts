import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { chatActor, readMessages } from "@/lib/schoolChat.server";

export const runtime = "nodejs";

/**
 * GET /api/v1/school-chat/messages?conversationId=&studentId= — the last
 * 300 messages the caller may see (visible ones; the caller's own held /
 * removed ones, marked; everything for a moderator). Marks it read.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const url = new URL(request.url);
    const conversationId = url.searchParams.get("conversationId")?.trim() || "";
    if (!conversationId) throw new ApiError("bad_request", "conversationId required", 400);
    const actor = await chatActor(ctx, url.searchParams.get("studentId"));
    return apiOk(await readMessages(ctx, actor, conversationId));
  } catch (e) {
    return apiErr(e);
  }
}
