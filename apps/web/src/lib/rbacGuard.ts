/**
 * RBAC + closed-session guards for lib mutation helpers.
 * Uses runtime require for loadMasters to avoid masters ↔ rbacGuard cycles.
 */

import { assertSessionWritable } from "@/lib/sessionWriteGuard";
import { getSessionActor } from "@/lib/sessionActor";
import {
  canConfigureRbac,
  hasPermission,
  type RbacAction,
  type RbacModule,
} from "@/lib/rbac";
import type { MastersState } from "@/lib/masters";

function loadMastersSafe(): MastersState | null {
  if (typeof window === "undefined") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { loadMasters } = require("@/lib/masters") as typeof import("@/lib/masters");
    return loadMasters();
  } catch {
    return null;
  }
}

/**
 * Returns false when closed-year locked or actor lacks permission.
 * When no actor is registered (SSR / public forms), permission is skipped
 * but closed-year lock still applies.
 */
export function assertModulePermission(
  module: RbacModule,
  action: RbacAction,
  label = "save",
): boolean {
  if (!assertSessionWritable(label)) return false;
  const session = getSessionActor();
  if (!session) return true;
  if (typeof window === "undefined") return true;
  const masters = loadMastersSafe();
  if (!hasPermission(session, masters, module, action)) {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("bhb-rbac-denied", {
          detail: { module, action, label },
        }),
      );
    }
    return false;
  }
  return true;
}

export function assertCanConfigureRbac(label = "saveRbac"): boolean {
  if (!assertSessionWritable(label)) return false;
  const session = getSessionActor();
  if (!session) return true;
  const masters = loadMastersSafe();
  if (!canConfigureRbac(session, masters)) {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("bhb-rbac-denied", {
          detail: { module: "settings", action: "edit", label },
        }),
      );
    }
    return false;
  }
  return true;
}

/** Staff advance ledger — `staff_advances` or full payroll edit. */
export function assertStaffAdvancesPermission(
  action: RbacAction,
  label = "saveAdvances",
): boolean {
  if (!assertSessionWritable(label)) return false;
  const session = getSessionActor();
  if (!session) return true;
  if (typeof window === "undefined") return true;
  const masters = loadMastersSafe();
  if (
    hasPermission(session, masters, "staff_advances", action) ||
    hasPermission(session, masters, "payroll", "edit")
  ) {
    return true;
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("bhb-rbac-denied", {
        detail: { module: "staff_advances", action, label },
      }),
    );
  }
  return false;
}
