import { apiErr, apiOk } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { chatActor, chatContacts } from "@/lib/schoolChat.server";

export const runtime = "nodejs";

/** GET /api/v1/school-chat/contacts?studentId= — who the caller may start a direct chat with. */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const actor = await chatActor(ctx, new URL(request.url).searchParams.get("studentId"));
    return apiOk(await chatContacts(ctx, actor));
  } catch (e) {
    return apiErr(e);
  }
}

