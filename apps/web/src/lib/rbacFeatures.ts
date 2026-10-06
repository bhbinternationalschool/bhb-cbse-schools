/**
 * Functions inside a module, each grantable on its own.
 *
 * Director, 6 Oct 2026: "make user role assign like every module and their
 * functionality … like teachers can in master create/add/delete subjects for
 * classes". A module grant (rbac.ts) still means "everything in the module";
 * a FUNCTION grant gives one part of it — e.g. Masters → Class subjects —
 * without the rest (fee heads, concessions, …).
 *
 * The server enforces it (lib/deskFeatureAuth.ts): a save from someone
 * without the module's edit grant is accepted only for the slices their
 * functions own, every row added / changed / removed must be an action
 * they hold, and class-scoped rows must be in their own classes.
 */
import type { RbacModule } from "@/lib/rbac";
import type { RbacFeatureDef } from "@/lib/rbacFeatureCatalog/types";
import { MASTERS_FEATURES } from "@/lib/rbacFeatureCatalog/masters";
import { TRANSPORT_FEATURES } from "@/lib/rbacFeatureCatalog/transport";

export type { RbacFeatureDef, RbacFeatureId } from "@/lib/rbacFeatureCatalog/types";

/**
 * Every module's functions. Each module keeps its list in
 * lib/rbacFeatureCatalog/<module>.ts; a list there enforces nothing until
 * the module's save route calls deskFeatureWriteGate (or a route is listed
 * under `routes`).
 */
export const RBAC_FEATURES: RbacFeatureDef[] = [
  ...MASTERS_FEATURES,
  ...TRANSPORT_FEATURES,
];

/** Masters keys that are not checked here — they sync through their own
 * routes and permission checks (staff roster, demo students). */
export const MASTERS_UNCHECKED_KEYS = new Set(["version", "staff", "students"]);

/** Keys a function-only save never lifts in, per module (plus "version"). */
export const DESK_UNCHECKED_KEYS: Partial<Record<RbacModule, Set<string>>> = {
  masters: MASTERS_UNCHECKED_KEYS,
};

export function featuresForModule(module: RbacModule): RbacFeatureDef[] {
  return RBAC_FEATURES.filter((f) => f.module === module);
}

export function findFeature(id: string): RbacFeatureDef | null {
  return RBAC_FEATURES.find((f) => f.id === id) ?? null;
}

/** The masters function that owns a MastersState key, if any. */
export function featureForMastersSlice(key: string): RbacFeatureDef | null {
  return RBAC_FEATURES.find((f) => f.module === "masters" && f.slices?.includes(key)) ?? null;
}

/** Functions behind a masters tab (a tab may serve two, e.g. Subjects). */
export function featuresForMastersTab(tab: string): RbacFeatureDef[] {
  return RBAC_FEATURES.filter((f) => f.module === "masters" && f.tabs?.includes(tab));
}

/** Functions of a module that open one of its screen tabs. */
export function featuresForTab(module: RbacModule, tab: string): RbacFeatureDef[] {
  return RBAC_FEATURES.filter((f) => f.module === module && f.tabs?.includes(tab));
}

/** Functions whose `routes` cover this API path. */
export function featuresForRoute(module: RbacModule, pathname: string): RbacFeatureDef[] {
  return RBAC_FEATURES.filter(
    (f) =>
      f.module === module &&
      (f.routes ?? []).some((r) => pathname === r || pathname.startsWith(`${r}/`)),
  );
}
