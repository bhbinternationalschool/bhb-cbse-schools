/**
 * The Monday reminder to read Nucleus.
 *
 * LEAD has no API, so the numbers only reach the ERP when a human copies them
 * across. A weekly nudge is the whole mechanism — without it the screen quietly
 * shows a month-old reading, which is worse than an empty one.
 *
 * It goes to the same leadership list as the 6 PM brief (briefRecipients), so
 * nobody maintains a second list of who counts.
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import { briefRecipients } from "@/lib/dailyBriefSend.server";
import { sendWhatsAppText, waOutboundConfigured } from "@/lib/waSend";
import {
  reminderDecision,
  reminderMessage,
  type ReminderDecision,
} from "@/lib/nucleusReminder";

export { NUCLEUS_URL, REMIND_AFTER_DAYS, reminderDecision, reminderMessage } from "@/lib/nucleusReminder";
export type { ReminderDecision } from "@/lib/nucleusReminder";

export type ReminderRun = {
  ok: true;
  due: boolean;
  decision: ReminderDecision;
  sent: { name: string; mobile: string }[];
  failed: { name: string; mobile: string; error: string }[];
  skipped?: string;
};

/**
 * Run the weekly check. Idempotent per person per day through the send log's
 * clientMessageId, so a scheduler retry cannot send a second copy.
 */
export async function runNucleusReminder(opts: {
  today: string;
  dryRun?: boolean;
}): Promise<ReminderRun> {
  const ctx = await getServerTenantContext();
  let capturedOn: string | null = null;
  if (ctx) {
    const { data } = await ctx.sb
      .from("nucleus_progress_snapshots")
      .select("captured_on")
      .eq("tenant_id", ctx.tenantId)
      .order("captured_on", { ascending: false })
      .limit(1)
      .maybeSingle();
    capturedOn = data?.captured_on ? String(data.captured_on) : null;
  }

  const decision = reminderDecision(capturedOn, opts.today);
  if (!decision.due) {
    return { ok: true, due: false, decision, sent: [], failed: [] };
  }
  if (opts.dryRun) {
    return { ok: true, due: true, decision, sent: [], failed: [], skipped: "dry run" };
  }
  if (!waOutboundConfigured()) {
    return { ok: true, due: true, decision, sent: [], failed: [], skipped: "WhatsApp not configured" };
  }

  const body = reminderMessage(decision);
  const sent: { name: string; mobile: string }[] = [];
  const failed: { name: string; mobile: string; error: string }[] = [];
  for (const r of await briefRecipients()) {
    const res = await sendWhatsAppText({
      toMobile: r.mobile,
      body,
      clientMessageId: `nucleus-reminder:${opts.today}:${r.mobile}`,
    });
    if (res.ok) sent.push({ name: r.name, mobile: r.mobile });
    else failed.push({ name: r.name, mobile: r.mobile, error: res.error ?? "send failed" });
  }
  return { ok: true, due: true, decision, sent, failed };
}
