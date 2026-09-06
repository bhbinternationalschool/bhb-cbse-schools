import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { resolveMobileAccess } from "@/lib/api/v1/mobileAccess.server";
import { resolveStaffHomeKind } from "@/lib/staffHomeKind.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";

export const runtime = "nodejs";

/**
 * GET /api/v1/staff/features — what this staff member may open in the app.
 * The app renders its tiles from this, so switching a feature off in the
 * ERP makes it disappear from the phone on the next load.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    await ensureSchoolMirrorHydrated();
    const access = resolveMobileAccess(ctx);
    return apiOk({
      staffId: ctx.session.staffId || "",
      fullName: ctx.session.fullName,
      homeKind: resolveStaffHomeKind(ctx.session, ctx.masters),
      features: access.features,
      blockedByRbac: access.blockedByRbac,
    });
  } catch (e) {
    return apiErr(e);
  }
}
