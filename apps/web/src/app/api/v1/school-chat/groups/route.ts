import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { chatActor, createStaffGroup, manageStaffGroup } from "@/lib/schoolChat.server";

export const runtime = "nodejs";

/**
 * POST /api/v1/school-chat/groups — staff only.
 *
 * Without `op`: make a group {title, staffIds: string[], section?:
 * {classId, sectionId}}. The maker is always a member; a section's families
 * can read it but not post. The group is a row in school_chat_conversations:
 * every server instance and both apps see it at once.
 *
 * With `op` (director, 30 Oct 2026): change one {op, conversationId, rev, …}
 *   rename        {title}
 *   addStaff      {staffIds}
 *   removeStaff   {staffIds}
 *   setSection    {section: {classId, sectionId}}
 *   clearSection
 *   leave         (yourself)
 * `rev` is conversation.manage.rev from GET /messages; a group changed
 * since answers 409. Who may: the maker (while in it) or a chat moderator;
 * leave — any member, for themselves (lib/schoolChat.server manageStaffGroup).
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") throw new ApiError("forbidden", "Only staff can make or change a group.", 403);
    const p = (await request.json().catch(() => ({}))) as { op?: unknown; title?: unknown; staffIds?: unknown; section?: unknown };
    const actor = await chatActor(ctx, null);
    if (p.op != null && p.op !== "") return apiOk(await manageStaffGroup(ctx, actor, p));
    return apiOk(await createStaffGroup(ctx, actor, p));
  } catch (e) {
    return apiErr(e);
  }
}
