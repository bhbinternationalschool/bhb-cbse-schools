/**
 * RBAC + closed-session guards for lib mutation helpers.
 *
 * Data-layer 2.3b: the checks decide with the SAME roles and roster the
 * sidebar and the module gate use — this tab's rbac and staff-list view
 * answers in the shared React Query cache (lib/data/client/tabCache) — not
 * the page copies (loadMasters().staff + loadRbac()), which before they
 * landed were an empty roster and the built-in roles: someone who held the
 * grant was told "You do not have permission" (R6: unknown became "no").
 *
 * When those answers are not there yet (or the read failed) a check REFUSES
 * with reason "not_loaded" — the shell says the permissions could not be
 * checked and to try again — and asks the two reads again. It never says
 * "no permission" for that.
 *
 * Without a database (offline dev build) and outside the staff shell (no
 * query provider: the parent page) the page copies are read as before.
 */

import { assertSessionWritable } from "@/lib/sessionWriteGuard";
import { getSessionActor } from "@/lib/sessionActor";
import {
  canConfigureRbac,
  featureAccess,
  hasPermission,
  type RbacAction,
  type RbacModule,
  type RbacState,
} from "@/lib/rbac";
import type { MastersState } from "@/lib/masters";
import { featuresForModule } from "@/lib/rbacFeatures";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { retryTabAccess, tabAccessCopy } from "@/lib/data/client/tabCache";

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

/** What a check decides with, or that it cannot decide yet. */
export type CheckAccess =
  | { known: true; masters: MastersState | null; rbac: RbacState | undefined }
  | { known: false; status: "loading" | "failed" };

/**
 * The roster + roles for a check made now. Exported for its self-test.
 * `rbac: undefined` = the legacy page-copy read (hasPermission → loadRbac).
 */
export function checkAccess(): CheckAccess {
  if (typeof window === "undefined") return { known: true, masters: null, rbac: undefined };
  if (isSupabaseConfigured()) {
    const t = tabAccessCopy();
    if (t.status === "ready") return { known: true, masters: t.masters, rbac: t.rbac };
    if (t.status === "loading" || t.status === "failed") return { known: false, status: t.status };
  }
  return { known: true, masters: loadMastersSafe(), rbac: undefined };
}

/** "Your permissions have not loaded" — never "you do not have permission". */
function refuseNotLoaded(module: RbacModule, action: RbacAction, label: string, status: "loading" | "failed"): false {
  retryTabAccess();
  window.dispatchEvent(
    new CustomEvent("bhb-rbac-denied", {
      detail: { module, action, label, reason: "not_loaded", status },
    }),
  );
  return false;
}

/**
 * True when the actor holds a write on some FUNCTION of the module (e.g. a
 * teacher's Masters → Class subjects) without the module itself. The
 * server decides which rows of the save stand (lib/deskFeatureAuth.ts).
 * Not known yet → false (claims nothing).
 */
export function holdsModuleFeatureWrite(module: RbacModule): boolean {
  if (typeof window === "undefined") return false;
  const session = getSessionActor();
  if (!session) return false;
  const a = checkAccess();
  if (!a.known) return false;
  const writes: RbacAction[] = ["create", "edit", "delete"];
  return featuresForModule(module).some((f) =>
    writes.some((w) => featureAccess(session, a.masters, f.id, w, a.rbac).allowed),
  );
}

/**
 * Holds functions of the module but not its edit grant. Such a browser must
 * not push the module's whole-module copies (the domain blob): the server
 * would refuse it, and the desk save that matters was merged slice by slice.
 */
export function isFunctionOnlyWriter(module: RbacModule): boolean {
  if (typeof window === "undefined") return false;
  const session = getSessionActor();
  if (!session) return false;
  const a = checkAccess();
  if (!a.known) return false;
  if (hasPermission(session, a.masters, module, "edit", a.rbac)) return false;
  return holdsModuleFeatureWrite(module);
}

function denied(module: RbacModule, action: RbacAction, label: string): false {
  window.dispatchEvent(
    new CustomEvent("bhb-rbac-denied", {
      detail: { module, action, label },
    }),
  );
  return false;
}

/**
 * Returns false when closed-year locked or actor lacks permission — or when
 * the permissions have not loaded (reason "not_loaded", never "denied").
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
  const a = checkAccess();
  if (!a.known) return refuseNotLoaded(module, action, label, a.status);
  if (!hasPermission(session, a.masters, module, action, a.rbac)) {
    // A function holder's save goes to the server, which keeps only the
    // rows their functions own and refuses the rest with a reason.
    if (
      (action === "create" || action === "edit" || action === "delete") &&
      holdsModuleFeatureWrite(module)
    ) {
      return true;
    }
    return denied(module, action, label);
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
  const a = checkAccess();
  if (!a.known) return refuseNotLoaded(module, action, label, a.status);
  if (!hasPermission(session, a.masters, module, action, a.rbac)) return denied(module, action, label);
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
  const a = checkAccess();
  if (!a.known) return refuseNotLoaded(module, "export", label, a.status);
  if (hasPermission(session, a.masters, module, "export", a.rbac)) return true;
  return denied(module, "export", label);
}

export function assertCanConfigureRbac(label = "saveRbac"): boolean {
  if (!assertSessionWritable(label)) return false;
  const session = getSessionActor();
  if (!session) return true;
  const a = checkAccess();
  if (!a.known) return refuseNotLoaded("settings", "edit", label, a.status);
  if (!canConfigureRbac(session, a.masters, a.rbac)) return denied("settings", "edit", label);
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
  const a = checkAccess();
  if (!a.known) return refuseNotLoaded("staff_advances", action, label, a.status);
  if (
    hasPermission(session, a.masters, "staff_advances", action, a.rbac) ||
    hasPermission(session, a.masters, "payroll", "edit", a.rbac)
  ) {
    return true;
  }
  return denied("staff_advances", action, label);
}
