import { apiErr, apiOk } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { chatActor, listConversations } from "@/lib/schoolChat.server";

export const runtime = "nodejs";

/**
 * GET /api/v1/school-chat/conversations?studentId= — the caller's groups and
 * direct chats, with the last message and unread count. A family names the
 * child it is acting for (the parent app's child picker). A moderator adds
 * oversight=1 to list every group of the school.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const url = new URL(request.url);
    const actor = await chatActor(ctx, url.searchParams.get("studentId"));
    const out = await listConversations(ctx, actor, { oversight: url.searchParams.get("oversight") === "1" });
    return apiOk({
      ...out,
      me: actor.kind === "staff" ? { kind: "staff", staffId: actor.staffId } : { kind: "family", studentId: actor.student.id, section: actor.section },
    });
  } catch (e) {
    return apiErr(e);
  }
}

