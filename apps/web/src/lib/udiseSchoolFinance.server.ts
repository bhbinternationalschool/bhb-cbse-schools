import "server-only";

import { getServerTenantContext } from "@/lib/serverTenant";
import { normalizeFinanceStore, UDISE_SCHOOL_FINANCE_KEY, type FinanceStore } from "@/lib/udiseSchoolFinance";

/**
 * The office's confirmed UDISE+ 1(c) figures (lib/udiseSchoolFinance), one
 * module_local_state row written only through
 * /api/v1/udise/robot/school-finance. null = the read failed (unknown).
 */
export async function readFinanceStore(): Promise<FinanceStore | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data, error } = await ctx.sb
    .from("module_local_state")
    .select("state")
    .eq("tenant_id", ctx.tenantId)
    .eq("module_key", UDISE_SCHOOL_FINANCE_KEY)
    .maybeSingle();
  if (error) {
    console.warn("[udise-school-finance] read failed", error.message);
    return null;
  }
  return normalizeFinanceStore(data?.state);
}

export async function writeFinanceStore(store: FinanceStore): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Tenant unavailable" };
  const { error } = await ctx.sb
    .from("module_local_state")
    .upsert(
      { tenant_id: ctx.tenantId, module_key: UDISE_SCHOOL_FINANCE_KEY, state: store, updated_at: new Date().toISOString() },
      { onConflict: "tenant_id,module_key" },
    );
  return error ? { ok: false, error: error.message } : { ok: true };
}
