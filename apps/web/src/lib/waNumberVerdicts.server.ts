/**
 * Every established verdict on the school's numbers, for the desks.
 *
 * The Students roster and the fee counter both need the same answer — "is
 * this family reachable on WhatsApp?" — and both already hold the SIS in
 * the browser. So the server sends the verdicts, not the students: a few
 * hundred small rows, and the desk decides what to show from the roster it
 * is already displaying.
 *
 * A number with no row here is UNCHECKED, and unchecked is not bad. The map
 * carries only what is established, and a failed read is reported as a
 * failure rather than as an empty map — "nobody has a problem" is the one
 * answer this must never invent.
 */

import "server-only";

import { getServerTenantContext } from "@/lib/serverTenant";
import type { WaVerdictMap } from "@/lib/waNumberGap";

export async function readWaNumberVerdicts(): Promise<{
  ok: boolean;
  verdicts: WaVerdictMap;
  error?: string;
}> {
  const ctx = await getServerTenantContext();
  if (!ctx) {
    return { ok: false, verdicts: {}, error: "Tenant not configured" };
  }
  const { data, error } = await ctx.sb
    .from("wa_contact_state")
    .select("mobile_e164, on_whatsapp, wa_checked_at, wa_check_source")
    .eq("tenant_id", ctx.tenantId)
    .not("on_whatsapp", "is", null);
  if (error) return { ok: false, verdicts: {}, error: error.message };

  const verdicts: WaVerdictMap = {};
  for (const row of data ?? []) {
    const digits = String(row.mobile_e164 || "").replace(/\D/g, "");
    const mobile10 = digits.length > 10 ? digits.slice(-10) : digits;
    if (mobile10.length !== 10) continue;
    if (row.on_whatsapp === null || row.on_whatsapp === undefined) continue;
    verdicts[mobile10] = {
      onWhatsApp: !!row.on_whatsapp,
      checkedAt: String(row.wa_checked_at || "") || undefined,
      source: String(row.wa_check_source || "") || undefined,
    };
  }
  return { ok: true, verdicts };
}
