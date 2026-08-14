import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { authorizeChatThread } from "@/lib/chatAuth.server";
import { getServerTenantContext } from "@/lib/serverTenant";

export const runtime = "nodejs";

type PostBody = { studentId?: string; body?: string };

/** POST /api/v1/chat/send — post one message into a student's chat thread. */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const payload = (await request.json()) as PostBody;
    const studentId = payload.studentId?.trim() || "";
    const body = payload.body?.trim() || "";
    if (!body) throw new ApiError("bad_request", "Message body required", 400);
    if (body.length > 2000) {
      throw new ApiError("bad_request", "Message too long", 400);
    }

    const auth = await authorizeChatThread(ctx, studentId);

    const tenant = await getServerTenantContext();
    if (!tenant) throw new ApiError("server_error", "Tenant unavailable", 503);

    const readCol =
      ctx.session.persona === "parent" ? "read_by_parent_at" : "read_by_staff_at";
    const { data, error } = await tenant.sb
      .from("chat_messages")
      .insert({
        tenant_id: tenant.tenantId,
        student_id: auth.student.id,
        sender_persona: ctx.session.persona,
        sender_id: auth.senderId,
        sender_name: auth.senderName,
        body,
        [readCol]: new Date().toISOString(),
      })
      .select("id, created_at")
      .single();
    if (error) throw new ApiError("server_error", error.message, 500);

    return apiOk({ id: data.id as string, createdAt: data.created_at as string });
  } catch (e) {
    return apiErr(e);
  }
}
