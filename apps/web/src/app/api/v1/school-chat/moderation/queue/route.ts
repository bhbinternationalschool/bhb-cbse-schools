import { apiErr, apiOk } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { requireStaffPermissionOrFeature } from "@/lib/apiRouteAuth.server";
import { CHAT_MODERATE_FEATURE, moderationQueue } from "@/lib/schoolChat.server";

export const runtime = "nodejs";

/** GET /api/v1/school-chat/moderation/queue — held messages (urgent first) and flagged staff messages. Moderators only. */
export async function GET(request: Request) {
  // Staff holding School chat moderation (or Discipline · approve) only.
  const gate = await requireStaffPermissionOrFeature(request, "discipline", "approve", CHAT_MODERATE_FEATURE, "approve");
  if (!gate.ok) return gate.response;
  try {
    const ctx = await resolveApiAuth(request);
    return apiOk(await moderationQueue(ctx));
  } catch (e) {
    return apiErr(e);
  }
}

