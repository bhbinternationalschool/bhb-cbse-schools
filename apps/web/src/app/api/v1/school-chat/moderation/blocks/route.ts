import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { requireStaffPermissionOrFeature } from "@/lib/apiRouteAuth.server";
import { CHAT_MODERATE_FEATURE, liftBlock, listBlocks, setBlock } from "@/lib/schoolChat.server";

export const runtime = "nodejs";

/** GET /api/v1/school-chat/moderation/blocks?all=1 — active (or all) mutes and blocks. Moderators only. */
export async function GET(request: Request) {
  // Staff holding School chat moderation (or Discipline · approve) only.
  const gate = await requireStaffPermissionOrFeature(request, "discipline", "approve", CHAT_MODERATE_FEATURE, "approve");
  if (!gate.ok) return gate.response;
  try {
    const ctx = await resolveApiAuth(request);
    return apiOk(await listBlocks(ctx, new URL(request.url).searchParams.get("all") === "1"));
  } catch (e) {
    return apiErr(e);
  }
}

/**
 * POST {op:"set", subjectKind: staff|student|household, subjectId, mode:
 * mute|block, conversationId?, reason} or {op:"lift", id, reason}.
 * mute = may read, may not send; block = neither. "" conversation = school-wide.
 */
export async function POST(request: Request) {
  // Staff holding School chat moderation (or Discipline · approve) only.
  const gate = await requireStaffPermissionOrFeature(request, "discipline", "approve", CHAT_MODERATE_FEATURE, "approve");
  if (!gate.ok) return gate.response;
  try {
    const ctx = await resolveApiAuth(request);
    const p = (await request.json().catch(() => ({}))) as Record<string, string | undefined>;
    if (p.op === "set") {
      return apiOk(
        await setBlock(ctx, {
          subjectKind: String(p.subjectKind || ""),
          subjectId: String(p.subjectId || ""),
          mode: String(p.mode || ""),
          conversationId: p.conversationId,
          reason: String(p.reason || ""),
        }),
      );
    }
    if (p.op === "lift") return apiOk(await liftBlock(ctx, String(p.id || ""), String(p.reason || "")));
    throw new ApiError("bad_request", "op must be set or lift", 400);
  } catch (e) {
    return apiErr(e);
  }
}
