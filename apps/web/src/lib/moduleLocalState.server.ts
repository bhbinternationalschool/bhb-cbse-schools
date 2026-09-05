import { getServerTenantContext } from "@/lib/serverTenant";
import type { ModuleStateKey } from "@/lib/moduleStateRegistry";

/**
 * Server-side read / write of one module_local_state row — the store the
 * office's localStorage-first modules (complaints, discipline, health, …)
 * sync to. The browser writes through /api/school-data/module-state; API
 * routes acting for a phone write here directly, with the same upsert.
 *
 * null from read = unknown (the read failed), never "empty".
 */
export async function readModuleLocalState<T>(
  key: ModuleStateKey,
): Promise<{ state: T | null; updatedAt: string } | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data, error } = await ctx.sb
    .from("module_local_state")
    .select("state, updated_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("module_key", key)
    .maybeSingle();
  if (error) {
    console.warn(`[module-state] ${key} read failed`, error.message);
    return null;
  }
  return {
    state: (data?.state as T | null) ?? null,
    updatedAt: data?.updated_at ? String(data.updated_at) : "",
  };
}

export async function writeModuleLocalState(
  key: ModuleStateKey,
  state: object,
): Promise<{ ok: true; updatedAt: string } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Tenant unavailable" };
  const now = new Date().toISOString();
  const { error } = await ctx.sb.from("module_local_state").upsert(
    { tenant_id: ctx.tenantId, module_key: key, state, updated_at: now },
    { onConflict: "tenant_id,module_key" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true, updatedAt: now };
}
