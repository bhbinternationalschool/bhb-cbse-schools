/**
 * The school's own WhatsApp rate card.
 *
 * Read and written by the usage dashboard. Kept in its own tiny table
 * rather than a desk slice because it is one row of six numbers that the
 * office edits once a year, and because a cost figure has to be able to say
 * who set the rate behind it and when.
 */

import "server-only";

import { getServerTenantContext } from "@/lib/serverTenant";
import {
  DEFAULT_WA_RATES,
  normalizeWaRates,
  type WaCostRates,
} from "@/lib/waUsageCost";

export async function loadWaCostRates(): Promise<WaCostRates> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ...DEFAULT_WA_RATES };
  const { data, error } = await ctx.sb
    .from("wa_cost_rates")
    .select("rates, updated_at, updated_by")
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (error) {
    // Falling back to the defaults is right here: the dashboard labels
    // default rates as unconfirmed, so a failed read shows as "nobody has
    // set these yet" rather than as somebody's numbers.
    console.warn("[waCostRates] read failed", error.message);
    return { ...DEFAULT_WA_RATES };
  }
  if (!data) return { ...DEFAULT_WA_RATES };
  return normalizeWaRates({
    ...(data.rates && typeof data.rates === "object" ? data.rates : {}),
    updatedAt: data.updated_at ? String(data.updated_at) : "",
    updatedBy: data.updated_by ? String(data.updated_by) : "",
  });
}

export async function saveWaCostRates(
  raw: unknown,
  updatedBy: string,
): Promise<{ ok: boolean; error?: string; rates: WaCostRates }> {
  const ctx = await getServerTenantContext();
  if (!ctx) {
    return { ok: false, error: "Tenant not configured", rates: { ...DEFAULT_WA_RATES } };
  }
  const now = new Date().toISOString();
  const next = normalizeWaRates({
    ...(raw && typeof raw === "object" ? raw : {}),
    updatedAt: now,
    updatedBy,
  });
  const { error } = await ctx.sb.from("wa_cost_rates").upsert(
    {
      tenant_id: ctx.tenantId,
      rates: {
        marketing: next.marketing,
        utility: next.utility,
        authentication: next.authentication,
        service: next.service,
        aiInputPerKTok: next.aiInputPerKTok,
        aiOutputPerKTok: next.aiOutputPerKTok,
        note: next.note,
      },
      updated_at: now,
      updated_by: updatedBy,
    },
    { onConflict: "tenant_id" },
  );
  if (error) return { ok: false, error: error.message, rates: next };
  return { ok: true, rates: next };
}
