import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { chatActor, sendMessage } from "@/lib/schoolChat.server";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/v1/school-chat/send {conversationId, body, studentId?} — one
 * message. A child's / family's message is checked first (rules, then the
 * model); flagged or unchecked = held for review and the sender is told.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const p = (await request.json().catch(() => ({}))) as { conversationId?: string; body?: string; studentId?: string };
    const conversationId = String(p.conversationId || "").trim();
    if (!conversationId) throw new ApiError("bad_request", "conversationId required", 400);
    const actor = await chatActor(ctx, p.studentId ?? null);
    return apiOk(await sendMessage(ctx, actor, conversationId, String(p.body || "")));
  } catch (e) {
    return apiErr(e);
  }
}
