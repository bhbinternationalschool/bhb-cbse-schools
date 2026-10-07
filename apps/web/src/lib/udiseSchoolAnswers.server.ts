import "server-only";

import { getServerTenantContext } from "@/lib/serverTenant";
import {
  normalizeUdiseSchoolAnswers,
  UDISE_SCHOOL_ANSWERS_KEY,
  type UdiseSchoolAnswers,
} from "@/lib/udiseSchoolAnswers";

/**
 * The office's confirmed UDISE+ school answers — one module_local_state row,
 * written only through /api/v1/udise/robot/school-answers (server truth; no
 * browser copy to drift). null = the read failed: unknown, never "none".
 */
export async function readUdiseSchoolAnswers(): Promise<{ answers: UdiseSchoolAnswers; updatedAt: string } | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data, error } = await ctx.sb
    .from("module_local_state")
    .select("state, updated_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("module_key", UDISE_SCHOOL_ANSWERS_KEY)
    .maybeSingle();
  if (error) {
    console.warn("[udise-school-answers] read failed", error.message);
    return null;
  }
  return { answers: normalizeUdiseSchoolAnswers(data?.state), updatedAt: data?.updated_at ? String(data.updated_at) : "" };
}

export async function writeUdiseSchoolAnswers(
  answers: UdiseSchoolAnswers,
): Promise<{ ok: true; updatedAt: string } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Tenant unavailable" };
  const now = new Date().toISOString();
  const { error } = await ctx.sb
    .from("module_local_state")
    .upsert(
      { tenant_id: ctx.tenantId, module_key: UDISE_SCHOOL_ANSWERS_KEY, state: answers, updated_at: now },
      { onConflict: "tenant_id,module_key" },
    );
  if (error) return { ok: false, error: error.message };
  return { ok: true, updatedAt: now };
}

/**
 * Road distance to the campus for one household, from its EXACTLY matched
 * census village (village_travel, Google Distance Matrix). The village
 * centre, not the house — the portal asks only for an approximate band.
 * null when the village is unmatched, ambiguous, or has no road figure.
 */
export async function householdRoadDistance(householdId: string): Promise<{ km: number; from: string } | null> {
  const ctx = await getServerTenantContext();
  if (!ctx || !householdId) return null;
  const hv = await ctx.sb
    .from("sis_household_village")
    .select("village_id, village_name, match_confidence")
    .eq("tenant_id", ctx.tenantId)
    .eq("household_id", householdId)
    .maybeSingle();
  if (hv.error || !hv.data?.village_id || hv.data.match_confidence !== "exact") return null;
  const vt = await ctx.sb
    .from("village_travel")
    .select("distance_km, source")
    .eq("tenant_id", ctx.tenantId)
    .eq("village_id", hv.data.village_id)
    .maybeSingle();
  // A straight-line fallback is optimistic around Varanasi; only a road figure counts.
  if (vt.error || !vt.data || vt.data.source !== "google") return null;
  const km = Number(vt.data.distance_km);
  if (!Number.isFinite(km) || km <= 0) return null;
  return { km, from: String(hv.data.village_name || "the family's village") };
}
