/**
 * Which WRITES a money function may make on a route it shares with others.
 *
 * requireStaffPermission lets a function stand in for the module on any
 * route the function lists (lib/rbacFeatureCatalog). That is right for
 * reading, and too wide for routes that do many jobs behind one path:
 * /api/ledger posts vouchers AND voids them, /api/inventory/bootstrap loads
 * the store AND changes its approval threshold. These routes call this after
 * their permission check: the whole-module grant passes as before; someone
 * who got in through a function passes only for an operation one of their
 * functions names (lib/rbacFeatureCatalog/money.ts).
 *
 * Pure: no I/O.
 */
import type { ApiAuthContext } from "@/lib/api/v1/auth";
import { featureAccess, hasPermission, type RbacAction, type RbacModule } from "@/lib/rbac";

type Who = Pick<ApiAuthContext, "session" | "masters" | "rbac">;

/** "/api/inventory/sales" covers itself and "/api/inventory/sales/…", nothing else. */
export function pathCovers(listed: string, pathname: string): boolean {
  return pathname === listed || pathname.startsWith(`${listed}/`);
}

export function functionWriteAllowed(
  who: Who,
  module: RbacModule,
  action: RbacAction,
  writes: Readonly<Record<string, readonly string[]>>,
  operation: string,
  covers: (listed: string, operation: string) => boolean = (a, b) => a === b,
): boolean {
  if (hasPermission(who.session, who.masters, module, action, who.rbac)) return true;
  return Object.entries(writes).some(
    ([featureId, ops]) =>
      ops.some((op) => covers(op, operation)) &&
      featureAccess(who.session, who.masters, featureId, action, who.rbac).allowed,
  );
}
