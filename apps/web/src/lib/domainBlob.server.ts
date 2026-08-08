/**
 * Server-side read/write for the single-row-per-tenant jsonb blob tables
 * (fees_state, payments_state, ... — see DomainBlobTable). Used by the
 * generic /api/school-data/domain-blob route so the browser no longer
 * needs direct Supabase table access for these ~30 modules.
 */

import type { DomainBlobTable } from "@/lib/domainBlobPersistence";
import { getServerTenantContext } from "@/lib/serverTenant";

export async function fetchDomainBlobFromDb(
  table: DomainBlobTable,
): Promise<{ ok: boolean; state: unknown; updatedAt: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, state: null, updatedAt: "" };
  const { sb, tenantId } = ctx;
  const { data, error } = await sb
    .from(table)
    .select("state, updated_at")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) {
    console.warn(`[domain-blob] fetch ${table} failed`, error.message);
    return { ok: false, state: null, updatedAt: "" };
  }
  return {
    ok: true,
    state: data?.state ?? null,
    updatedAt: data?.updated_at ? String(data.updated_at) : "",
  };
}

export async function pushDomainBlobToDb(
  table: DomainBlobTable,
  state: unknown,
): Promise<{ ok: boolean; error?: string; updatedAt: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) {
    return { ok: false, error: "Supabase tenant not configured", updatedAt: "" };
  }
  const { sb, tenantId } = ctx;
  const now = new Date().toISOString();
  const { error } = await sb.from(table).upsert(
    { tenant_id: tenantId, state, updated_at: now },
    { onConflict: "tenant_id" },
  );
  if (error) {
    console.warn(`[domain-blob] push ${table} failed`, error.message);
    return { ok: false, error: error.message, updatedAt: "" };
  }
  return { ok: true, updatedAt: now };
}
