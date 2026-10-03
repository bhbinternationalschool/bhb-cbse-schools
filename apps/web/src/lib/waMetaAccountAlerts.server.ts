import "server-only";

/**
 * Meta's account-level WhatsApp alerts → a WhatsApp note to the director.
 *
 * The rules (which events matter, what the note says) are pure, in
 * lib/waMetaAccountAlerts.ts. This file only delivers: once per event —
 * Meta re-delivers any webhook it did not get a prompt 200 for — and
 * re-syncs the template registry when Meta changes a template's category,
 * so the ERP's cost figures and senders see the new category at once.
 */

import { claimSendOnce } from "@/lib/waSendClaim.server";
import { parseMetaAccountAlerts, type WaMetaAccountAlert } from "@/lib/waMetaAccountAlerts";

export { parseMetaAccountAlerts };

export async function handleMetaAccountAlerts(alerts: WaMetaAccountAlert[]): Promise<{ notified: number }> {
  if (!alerts.length) return { notified: 0 };
  for (const a of alerts) console.info("[wa/meta-alert]", a.field, a.summary);

  if (alerts.some((a) => a.templateCategoryChanged)) {
    try {
      const { runTemplateAutopilot } = await import("@/lib/waTemplateAutopilot.server");
      await runTemplateAutopilot({ sync: true });
    } catch (e) {
      console.warn("[wa/meta-alert] template re-sync failed", (e as Error)?.message);
    }
  }

  const worth = alerts.filter((a) => a.note);
  if (!worth.length) return { notified: 0 };
  const { directorMobiles, tellStaff } = await import("@/lib/waTemplateAutopilot.server");
  let directors: string[] = [];
  try {
    directors = await directorMobiles();
  } catch (e) {
    console.warn("[wa/meta-alert] director lookup failed", (e as Error)?.message);
    return { notified: 0 };
  }
  if (!directors.length) {
    console.warn("[wa/meta-alert] no director number on file — alert not sent");
    return { notified: 0 };
  }
  let notified = 0;
  for (const a of worth) {
    const claim = await claimSendOnce(a.key, "wa-meta-alert", a.summary);
    if (!claim.ok) continue;
    for (const m of directors) await tellStaff(m, a.note, a.key);
    notified++;
  }
  return { notified };
}
