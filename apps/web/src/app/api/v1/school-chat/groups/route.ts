import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { chatActor, createStaffGroup } from "@/lib/schoolChat.server";

export const runtime = "nodejs";

/**
 * POST /api/v1/school-chat/groups {title, staffIds: string[], section?:
 * {classId, sectionId}} — a member of staff makes a group (staff only). The
 * maker is always a member; a section's families can read it but not post.
 * The group is a row in school_chat_conversations: every server instance and
 * both apps see it at once.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") throw new ApiError("forbidden", "Only staff can make a group.", 403);
    const p = (await request.json().catch(() => ({}))) as { title?: unknown; staffIds?: unknown; section?: unknown };
    const actor = await chatActor(ctx, null);
    return apiOk(await createStaffGroup(ctx, actor, p));
  } catch (e) {
    return apiErr(e);
  }
}
