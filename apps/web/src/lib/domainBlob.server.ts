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

/**
 * Write one module's blob, only over the version the browser loaded
 * (10 Oct 2026). A blob is a whole module; before this, any browser's copy —
 * old, half-loaded or made up — replaced the server's. `baseUpdatedAt` is the
 * server version the browser last took: the write lands only while that is
 * still the stored version; otherwise `conflict: "stale"` and the browser
 * reloads. A browser that never loaded the module (no base) may create it
 * but never overwrite it (`conflict: "unversioned"`).
 */
export async function pushDomainBlobToDb(
  table: DomainBlobTable,
  state: unknown,
  baseUpdatedAt?: string | null,
  opts: { server?: boolean } = {},
): Promise<{ ok: boolean; error?: string; updatedAt: string; conflict?: "stale" | "unversioned" }> {
  const ctx = await getServerTenantContext();
  if (!ctx) {
    return { ok: false, error: "Supabase tenant not configured", updatedAt: "" };
  }
  const { sb, tenantId } = ctx;
  const now = new Date().toISOString();
  const base = (baseUpdatedAt ?? "").trim();

  // A server job (mirror secret) writes what the server itself just read —
  // no browser copy is involved.
  if (opts.server) {
    const { error } = await sb.from(table).upsert({ tenant_id: tenantId, state, updated_at: now }, { onConflict: "tenant_id" });
    if (error) {
      console.warn(`[domain-blob] push ${table} failed`, error.message);
      return { ok: false, error: error.message, updatedAt: "" };
    }
    return { ok: true, updatedAt: now };
  }

  if (base) {
    const { data, error } = await sb
      .from(table)
      .update({ state, updated_at: now })
      .eq("tenant_id", tenantId)
      .eq("updated_at", base)
      .select("tenant_id");
    if (error) {
      console.warn(`[domain-blob] push ${table} failed`, error.message);
      return { ok: false, error: error.message, updatedAt: "" };
    }
    if ((data ?? []).length === 1) return { ok: true, updatedAt: now };
    return { ok: false, conflict: "stale", error: "Changed on another device after this one loaded it.", updatedAt: "" };
  }

  // No base: only a module that does not exist yet may be created.
  const { data: existing, error: readErr } = await sb.from(table).select("tenant_id").eq("tenant_id", tenantId).maybeSingle();
  if (readErr) return { ok: false, error: readErr.message, updatedAt: "" };
  if (existing) {
    return { ok: false, conflict: "unversioned", error: "This device had not loaded the saved copy, so it cannot replace it.", updatedAt: "" };
  }
  const { error } = await sb.from(table).insert({ tenant_id: tenantId, state, updated_at: now });
  if (error) {
    if (error.code === "23505") return { ok: false, conflict: "stale", error: "Saved by another device at the same moment.", updatedAt: "" };
    console.warn(`[domain-blob] push ${table} failed`, error.message);
    return { ok: false, error: error.message, updatedAt: "" };
  }
  return { ok: true, updatedAt: now };
}
