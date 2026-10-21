import { ApiError } from "@/lib/api/v1/errors";
import { assertPermission, type ApiAuthContext } from "@/lib/api/v1/auth";
import { functionGrantHeldOnServer } from "@/lib/apiRouteAuth.server";
import { isFeaturePersonallyDenied, type RbacAction } from "@/lib/rbac";
import { pushAdmissionsRemoteServer } from "@/lib/admissionsPersistence";
import { writeAdmissionsLocalRaw, type AdmissionsState } from "@/lib/admissions";

/**
 * The admissions module grant, or the admissions FUNCTION that covers this
 * piece of work (lib/rbacFeatureCatalog/people.ts) holding the same action:
 *
 *   admissions.leads         — walk-in enquiries, the lead list, follow-ups
 *   admissions.registration  — recording registration fee payments
 *
 * A personal deny of the function wins over both, the same order the web's
 * desk routes and the answer book use.
 */
export function assertAdmissionsGrant(
  ctx: ApiAuthContext,
  featureId: "admissions.leads" | "admissions.registration",
  action: RbacAction,
): void {
  if (isFeaturePersonallyDenied(ctx.session, ctx.masters, featureId, action, ctx.rbac)) {
    throw new ApiError("forbidden", `This admissions work (${featureId} ${action}) is turned off for you`, 403);
  }
  if (functionGrantHeldOnServer(ctx, featureId, action)) return;
  assertPermission(ctx, "admissions", action);
}

/**
 * Save the admissions state the way the follow-up route always has: the
 * server cache first, then the desk tables + blob. A failed push is a
 * failure the phone must see — never a quiet "saved".
 */
export async function saveAdmissionsFromStaffApp(
  state: AdmissionsState,
  what: string,
): Promise<void> {
  writeAdmissionsLocalRaw(state);
  const pushed = await pushAdmissionsRemoteServer(state);
  if (!pushed.ok) {
    console.warn(`[staff-admissions-v1] ${what}: push failed`, pushed.error);
    throw new ApiError("server_error", `Could not save the ${what} — try again`, 503);
  }
}
