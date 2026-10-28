import { assertPermission, type ApiAuthContext } from "@/lib/api/v1/auth";
import { ApiError } from "@/lib/api/v1/errors";
import { assertMobileFeature } from "@/lib/api/v1/mobileAccess.server";
import { hasPermission } from "@/lib/rbac";

/**
 * Server gates for the staff app's management pay views (20 Oct 2026).
 * Ordinary staff keep their own payslips / advances (/payslips,
 * /my-advances); everyone's figures need both the app switch and the web
 * grant the matching web screen asks for — never wider.
 */

/** Everyone's payslips: the web's Payroll screen needs payroll.view. */
export function assertStaffPayrollOverviewAccess(ctx: ApiAuthContext): void {
  assertMobileFeature(ctx, "staff_payslips_all");
  assertPermission(ctx, "payroll", "view");
}

/**
 * Everyone's advances: the web's Payroll → Advances tab opens to
 * staff_advances or payroll (lib/rbac canAccessHref). The app switch itself
 * sits on staff_advances.view, so in practice it is that grant.
 */
export function assertStaffAdvancesOverviewAccess(ctx: ApiAuthContext): void {
  assertMobileFeature(ctx, "staff_advances_all");
  if (
    !hasPermission(ctx.session, ctx.masters, "staff_advances", "view", ctx.rbac) &&
    !hasPermission(ctx.session, ctx.masters, "payroll", "view", ctx.rbac)
  ) {
    throw new ApiError("forbidden", "Missing permission staff_advances.view", 403);
  }
}
