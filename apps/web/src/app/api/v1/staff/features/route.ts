import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { resolveMobileAccess } from "@/lib/api/v1/mobileAccess.server";
import { staffSectionScope } from "@/lib/api/v1/staffScope";
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
    // A class teacher always sees their own class's fee dues (read-only,
    // scoped server-side in /api/v1/staff/fees/defaulters).
    const scope = await staffSectionScope(ctx);
    const features =
      scope.classTeacherOf.size > 0 && !access.features.includes("fee_defaulters")
        ? [...access.features, "fee_defaulters"]
        : access.features;
    return apiOk({
      staffId: ctx.session.staffId || "",
      fullName: ctx.session.fullName,
      homeKind: scope.kind,
      features,
      blockedByRbac: access.blockedByRbac,
    });
  } catch (e) {
    return apiErr(e);
  }
}
