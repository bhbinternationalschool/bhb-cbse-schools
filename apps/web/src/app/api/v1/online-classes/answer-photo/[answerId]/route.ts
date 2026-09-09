import { NextResponse } from "next/server";
import { apiErr, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { assertSectionScope } from "@/lib/api/v1/staffScope";
import { getSession } from "@/lib/onlineClasses.server";
import { downloadAnswerPhoto, getAnswer } from "@/lib/onlineClassQa.server";

export const runtime = "nodejs";

type Params = { params: Promise<{ answerId: string }> };

/**
 * One child's answer photo. The family that sent it may see it; staff in
 * the section's scope may see it. Nobody else — a child's copy is theirs.
 */
export async function GET(request: Request, { params }: Params) {
  try {
    const ctx = await resolveApiAuth(request);
    const { answerId } = await params;
    const a = await getAnswer(answerId);
    if (!a) throw new ApiError("not_found", "Not found", 404);
    if (ctx.session.persona === "parent") {
      if (!ctx.session.householdId || a.householdId !== ctx.session.householdId) {
        throw new ApiError("forbidden", "Not your child's answer", 403);
      }
    } else if (ctx.session.persona === "staff") {
      assertPermission(ctx, "online_classes", "view");
      await ensureSchoolMirrorHydrated();
      const s = await getSession(a.sessionId);
      if (!s) throw new ApiError("not_found", "Not found", 404);
      await assertSectionScope(ctx, s.classId, s.sectionId);
    } else {
      throw new ApiError("forbidden", "Not allowed", 403);
    }
    const file = await downloadAnswerPhoto(a);
    if (!file) throw new ApiError("not_found", "Photo not found", 404);
    return new NextResponse(file.bytes, {
      status: 200,
      headers: {
        "Content-Type": file.mime,
        "Cache-Control": "private, max-age=600",
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return apiErr(e);
  }
}
