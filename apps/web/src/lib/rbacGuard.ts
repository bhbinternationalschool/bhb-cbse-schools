/**
 * RBAC + closed-session guards for lib mutation helpers.
 * Uses runtime require for loadMasters to avoid masters ↔ rbacGuard cycles.
 */

import { assertSessionWritable } from "@/lib/sessionWriteGuard";
import { getSessionActor } from "@/lib/sessionActor";
import {
  canConfigureRbac,
  featureAccess,
  hasPermission,
  type RbacAction,
  type RbacModule,
} from "@/lib/rbac";
import type { MastersState } from "@/lib/masters";
import { featuresForModule } from "@/lib/rbacFeatures";

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
 * True when the actor holds a write on some FUNCTION of the module (e.g. a
 * teacher's Masters → Class subjects) without the module itself. The
 * server decides which rows of the save stand (lib/deskFeatureAuth.ts).
 */
export function holdsModuleFeatureWrite(module: RbacModule): boolean {
  if (typeof window === "undefined") return false;
  const session = getSessionActor();
  if (!session) return false;
  const masters = loadMastersSafe();
  const writes: RbacAction[] = ["create", "edit", "delete"];
  return featuresForModule(module).some((f) =>
    writes.some((a) => featureAccess(session, masters, f.id, a).allowed),
  );
}

export function holdsMastersFeatureWrite(): boolean {
  return holdsModuleFeatureWrite("masters") && assertSessionWritable("saveMasters");
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
    // A function holder's save goes to the server, which keeps only the
    // rows their functions own and refuses the rest with a reason.
    if (
      (action === "create" || action === "edit" || action === "delete") &&
      holdsModuleFeatureWrite(module)
    ) {
      return true;
    }
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

/**
 * Like assertModulePermission, but also allows a staff actor to act on
 * their OWN record (selfStaffId) regardless of the module grant — for
 * self-service actions (apply for own leave, raise own request ticket)
 * that share a save path with admin-only edits on the same module. A
 * teacher who only has "staff:view" must still be able to file their own
 * leave/request; someone editing another staff member's record still
 * needs the real module grant.
 */
export function assertSelfOrModulePermission(
  module: RbacModule,
  action: RbacAction,
  selfStaffId: string,
  label = "save",
): boolean {
  if (!assertSessionWritable(label)) return false;
  const session = getSessionActor();
  if (!session) return true;
  if (
    session.persona === "staff" &&
    session.staffId &&
    selfStaffId &&
    session.staffId === selfStaffId
  ) {
    return true;
  }
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

/**
 * A download (Excel / PDF) needs the module's "export" grant — viewing a
 * report on screen does not imply it. Read-only, so unlike
 * assertModulePermission there is no closed-year lock: a closed year's
 * register can still be downloaded by someone allowed to. Added
 * 2026-09-29: the SIS catalog downloaded for anyone who could open it.
 */
export function actorMayExport(module: RbacModule, label = "export"): boolean {
  const session = getSessionActor();
  if (!session) return true;
  if (typeof window === "undefined") return true;
  const masters = loadMastersSafe();
  if (hasPermission(session, masters, module, "export")) return true;
  window.dispatchEvent(
    new CustomEvent("bhb-rbac-denied", {
      detail: { module, action: "export", label },
    }),
  );
  return false;
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
