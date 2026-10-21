import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { chatActor, openDirectChat } from "@/lib/schoolChat.server";

export const runtime = "nodejs";

/**
 * POST /api/v1/school-chat/direct {with: {kind:"staff", id} | {kind:"parent",
 * studentId}, studentId?} — open (or find) a direct chat. There is no
 * child↔child or family↔family chat: those requests are a 403.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const p = (await request.json().catch(() => ({}))) as { with?: { kind?: string; id?: string; studentId?: string }; studentId?: string };
    if (!p.with || typeof p.with !== "object") throw new ApiError("bad_request", "Say who to message (with).", 400);
    const actor = await chatActor(ctx, p.studentId ?? null);
    return apiOk(await openDirectChat(ctx, actor, { kind: String(p.with.kind || ""), id: p.with.id, studentId: p.with.studentId }));
  } catch (e) {
    return apiErr(e);
  }
}
