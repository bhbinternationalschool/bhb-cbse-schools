/**
 * The real dependencies of the reference views (lib/data/server/views.ts):
 * the guards every school-data route uses and the per-process reference
 * caches (data-layer 1.3) — Masters + roster and RBAC from lib/api/v1/auth,
 * the module registry from its own cache here. Nothing reads the school
 * mirror, and nothing answers from defaults.
 */
// Server code, but no `import "server-only"`: the views self-test imports it under plain tsx.
import { hasMirrorSyncSecret, requireStaffApi, requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { readServerMastersCopy, readServerRbacCopy } from "@/lib/api/v1/auth";
import { resolveMastersReadScope } from "@/lib/mastersReadScope.server";
import type { ModuleRegistryState } from "@/lib/moduleRegistry";
import { referenceCache, type BuildResult } from "./referenceCache";
import { moduleRegistryOf, type ViewDeps } from "./views";

/**
 * Which modules the school switched on (Masters → Modules), rebuilt when
 * erp_versions says the module_registry desk moved (every desk-slice push
 * bumps module_registry_desk_sync_meta). MODULE_REGISTRY_READ_FROM_DB is on in
 * production (deploy/desk-cutover-runtime.env), so the desk is the truth and
 * the old module_registry_state blob is not read. A failed read is a failed
 * build: the cache keeps its previous copy, or the view answers 503.
 */
async function buildModuleRegistry(): Promise<BuildResult<ModuleRegistryState>> {
  const { fetchDeskSliceFromDb } = await import("@/lib/deskSliceNormalized.server");
  const r = await fetchDeskSliceFromDb("module_registry");
  if (!r.ok) return { ok: false, error: r.error || "module_registry desk read failed" };
  return { ok: true, value: moduleRegistryOf(r.bundle) };
}

const moduleRegistryCache = referenceCache<ModuleRegistryState>("module_registry", ["module_registry"], buildModuleRegistry);

export const viewDeps: ViewDeps = {
  mastersScope: (req) => resolveMastersReadScope(req),
  requireStaff: (req) => requireStaffApi(req),
  requireSettingsView: (req) => requireStaffPermission(req, "settings", "view"),
  mirrorSecret: (req) => hasMirrorSyncSecret(req),
  readMasters: () => readServerMastersCopy(),
  readRbac: () => readServerRbacCopy(),
  readModuleRegistry: () => moduleRegistryCache.read(),
};
