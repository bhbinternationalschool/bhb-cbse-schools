import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { postClassWork, withdrawHomeworkFromChat } from "@/lib/schoolChatWork.server";

export const runtime = "nodejs";
// Homework is written out for parents (the model) and WhatsApped, as
// POST /api/v1/homework/post — the same slow path.
export const maxDuration = 60;

/**
 * POST /api/v1/school-chat/work — in a class or subject group:
 *  {conversationId, kind: "homework", subjectId, title, body, dueAt?, attachments?}
 *    → a homework post in the Homework module (POST /api/v1/homework/post's
 *      path: push + the WhatsApp homework loop, once), shown as a card;
 *  {conversationId, kind: "classwork", subjectId?, title, body}
 *    → a class-diary entry, shown as a card;
 *  {conversationId, kind: "notice", title, body} → a chat message.
 *  {op: "withdraw", postId} → the homework is withdrawn (card and post go).
 * Staff with Homework · edit, for a section / subject they teach, who are
 * members of the group (lib/schoolChatWork.server).
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") throw new ApiError("forbidden", "Only staff post homework, classwork and notices.", 403);
    assertPermission(ctx, "homework", "edit");
    const p = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (p.op === "withdraw") return apiOk(await withdrawHomeworkFromChat(ctx, String(p.postId || "")));
    const conversationId = String(p.conversationId || "").trim();
    if (!conversationId) throw new ApiError("bad_request", "conversationId required", 400);
    return apiOk(await postClassWork(ctx, conversationId, p));
  } catch (e) {
    return apiErr(e);
  }
}
