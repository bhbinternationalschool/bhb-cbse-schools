import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { authorizeChatThread } from "@/lib/chatAuth.server";
import { getServerTenantContext } from "@/lib/serverTenant";

export const runtime = "nodejs";

/**
 * GET /api/v1/chat/thread?studentId= — the parent<->class-teacher
 * conversation for one child. Marks the caller's side as read.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const url = new URL(request.url);
    const studentId = url.searchParams.get("studentId")?.trim() || "";
    const auth = await authorizeChatThread(ctx, studentId);

    const tenant = await getServerTenantContext();
    if (!tenant) throw new ApiError("server_error", "Tenant unavailable", 503);

    const { data, error } = await tenant.sb
      .from("chat_messages")
      .select("id, sender_persona, sender_name, body, created_at")
      .eq("tenant_id", tenant.tenantId)
      .eq("student_id", auth.student.id)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) throw new ApiError("server_error", error.message, 500);

    const readCol =
      ctx.session.persona === "parent" ? "read_by_parent_at" : "read_by_staff_at";
    await tenant.sb
      .from("chat_messages")
      .update({ [readCol]: new Date().toISOString() })
      .eq("tenant_id", tenant.tenantId)
      .eq("student_id", auth.student.id)
      .is(readCol, null);

    return apiOk({
      studentId: auth.student.id,
      studentName: auth.student.fullName,
      teacherName: auth.teacherName || null,
      messages: (data || []).map((m) => ({
        id: m.id as string,
        senderPersona: m.sender_persona as "parent" | "staff",
        senderName: m.sender_name as string,
        body: m.body as string,
        createdAt: m.created_at as string,
        mine: m.sender_persona === ctx.session.persona,
      })),
    });
  } catch (e) {
    return apiErr(e);
  }
}
