import type { ApiAuthContext } from "@/lib/api/v1/auth";
import { ApiError } from "@/lib/api/v1/errors";
import { hasPermission, resolveSessionRoles } from "@/lib/rbac";
import {
  MOBILE_FEATURES,
  defaultMobileAccess,
  mobileFeature,
  resolveMobileFeatures,
  type MobileFeatureId,
  type MobileFeatureResolution,
} from "@/lib/mobileFeatures";

/**
 * Which app screens this signed-in staff member gets.
 *
 * Both gates are applied here — the RBAC grants that already exist, and the
 * mobile map the office edits in Masters → Roles. See lib/mobileFeatures.ts.
 */
export function resolveMobileAccess(ctx: ApiAuthContext): MobileFeatureResolution {
  const roles = resolveSessionRoles(ctx.rbac, ctx.session, ctx.masters);
  return resolveMobileFeatures({
    roleCodes: roles.map((r) => r.code),
    staffId: ctx.session.staffId,
    access: ctx.rbac.mobile ?? defaultMobileAccess(),
    can: (module, action) =>
      hasPermission(ctx.session, ctx.masters, module, action, ctx.rbac),
  });
}

export function hasMobileFeature(
  ctx: ApiAuthContext,
  feature: MobileFeatureId,
): boolean {
  return resolveMobileAccess(ctx).features.includes(feature);
}

/**
 * 403 unless the office has switched this feature on for this person AND the
 * permissions they hold still carry the underlying grant. The message says
 * which of the two failed, because the fix is different: one is Masters →
 * Roles → Mobile app, the other is the permission matrix — or, for one person
 * only, a personal grant on that same screen.
 */
export function assertMobileFeature(
  ctx: ApiAuthContext,
  feature: MobileFeatureId,
): void {
  if (ctx.session.persona !== "staff") {
    throw new ApiError("forbidden", "Staff session required", 403);
  }
  const res = resolveMobileAccess(ctx);
  if (res.features.includes(feature)) return;
  const meta = mobileFeature(feature);
  const label = meta?.label || feature;
  if (res.blockedByRbac.includes(feature)) {
    throw new ApiError(
      "forbidden",
      `${label} is switched on for you in the app, but you do not have ${meta?.module} ${meta?.action} rights. The office can add them to your role, or to you alone, in Masters → Roles.`,
      403,
    );
  }
  throw new ApiError(
    "forbidden",
    `${label} is not enabled for you in the app. The office can switch it on in Masters → Roles → Mobile app.`,
    403,
  );
}

/** The catalogue as the app and the admin panel show it. */
export function mobileFeatureCatalogue() {
  return MOBILE_FEATURES.map((f) => ({
    id: f.id,
    label: f.label,
    group: f.group,
    module: f.module,
    action: f.action,
    note: f.note,
  }));
}
