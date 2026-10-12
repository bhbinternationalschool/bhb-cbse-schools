import type { ApiAuthContext } from "@/lib/api/v1/auth";
import { ApiError } from "@/lib/api/v1/errors";
import { hasPermission, isFeaturePersonallyDenied, resolveSessionRoles } from "@/lib/rbac";
import { findFeature } from "@/lib/rbacFeatures";
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
/**
 * The web functions (lib/rbacFeatureCatalog) behind an app screen. When the
 * office has personally turned off every one of them for the screen's
 * action (Masters → Roles → Assign to user), the screen is refused too —
 * a whole-module deny already is, through hasPermission.
 */
export const MOBILE_FEATURE_FUNCTIONS: Partial<Record<MobileFeatureId, string[]>> = {
  admission_leads: ["admissions.leads"],
  field_survey: ["admissions.field_survey"],
  attendance_mark: ["attendance.student_register"],
  homework_post: ["homework.assign"],
  marks_entry: ["exams.marks"],
  student_leave_decide: ["student_leave.requests"],
  complaints_handle: ["complaints.desk"],
  student_notes: ["discipline.register"],
  ptm_meet: ["ptm.events", "ptm.slots", "ptm.bookings", "ptm.feedback"],
  staff_leave_approve: ["staff.leave"],
  broadcast: ["notices.circulars"],
  visitor_gate: ["visitors.register"],
  gate_pass_release: ["visitors.register"],
};

export function mobileFeaturePersonallyDenied(ctx: ApiAuthContext, feature: MobileFeatureId): boolean {
  const meta = mobileFeature(feature);
  const fns = (MOBILE_FEATURE_FUNCTIONS[feature] ?? []).filter((id) => findFeature(id));
  if (!meta || fns.length === 0) return false;
  return fns.every((id) =>
    isFeaturePersonallyDenied(ctx.session, ctx.masters, id, meta.action, ctx.rbac),
  );
}

export function resolveMobileAccess(ctx: ApiAuthContext): MobileFeatureResolution {
  const roles = resolveSessionRoles(ctx.rbac, ctx.session, ctx.masters);
  const res = resolveMobileFeatures({
    roleCodes: roles.map((r) => r.code),
    staffId: ctx.session.staffId,
    access: ctx.rbac.mobile ?? defaultMobileAccess(),
    can: (module, action) =>
      hasPermission(ctx.session, ctx.masters, module, action, ctx.rbac),
  });
  const off = res.features.filter((f) => mobileFeaturePersonallyDenied(ctx, f));
  if (off.length === 0) return res;
  return {
    features: res.features.filter((f) => !off.includes(f)),
    blockedByRbac: [...res.blockedByRbac, ...off],
  };
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
