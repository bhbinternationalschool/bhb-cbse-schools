import { apiErr, apiOk } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { requireStaffPermissionOrFeature } from "@/lib/apiRouteAuth.server";
import { CHAT_MODERATE_FEATURE, decideMessage } from "@/lib/schoolChat.server";

export const runtime = "nodejs";

/**
 * POST /api/v1/school-chat/moderation/decide {messageId, decision:
 * approve|remove|warn, note} — approve shows a held message to the group;
 * remove hides it; warn removes it and warns the sender. Logged with the
 * original text. A message someone else already decided is a 409.
 */
export async function POST(request: Request) {
  // Staff holding School chat moderation (or Discipline · approve) only.
  const gate = await requireStaffPermissionOrFeature(request, "discipline", "approve", CHAT_MODERATE_FEATURE, "approve");
  if (!gate.ok) return gate.response;
  try {
    const ctx = await resolveApiAuth(request);
    const p = (await request.json().catch(() => ({}))) as { messageId?: string; decision?: string; note?: string };
    return apiOk(await decideMessage(ctx, String(p.messageId || ""), String(p.decision || ""), String(p.note || "")));
  } catch (e) {
    return apiErr(e);
  }
}

