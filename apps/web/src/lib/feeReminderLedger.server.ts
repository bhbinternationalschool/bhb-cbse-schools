/**
 * Who has had a fee reminder lately — from what actually went out.
 *
 * WHY (21 Sep 2026): the school has two ways to send a fee reminder, and
 * each kept its own idea of "reminded this week". The ERP command kept a
 * date per household in its own store; the automation rule kept nothing at
 * all. So on 14 Sep the automation reminded 95 families it had reminded on
 * the 11th, and the command would not have known about either.
 *
 * `household_message_log` is the one record both write to — every WhatsApp
 * send to a family lands there with its purpose — so it is the ledger. A
 * reminder counts when it was SENT; a send that failed reached nobody and
 * must not use up a family's week.
 *
 * Read in pages: a single evening's run has logged 1,022 rows, past the
 * 1,000-row PostgREST cap ([[erp-db-reads-must-page]]).
 */
import "server-only";

import { getServerTenantContext } from "@/lib/serverTenant";
import { mobileKey } from "@/lib/automationSendRules";

/** Every fee purpose that counts towards a family's week. */
export const FEE_REMINDER_PURPOSES = ["fees", "fees_soft_reminder"] as const;

export type FeeReminderLedger = {
  /** Bare ten digits → the latest time a fee reminder was sent to it. */
  byMobile: Map<string, string>;
  /** Household id → the latest time a fee reminder was sent to it. */
  byHousehold: Map<string, string>;
};

/**
 * Fee reminders sent since `sinceIso`.
 *
 * `null` when the log cannot be read. That is NOT "nobody was reminded":
 * the callers hold rather than send, because the harm here is a family
 * chased twice in a week, and a fee reminder that waits a day costs nothing.
 */
export async function feeRemindersSince(sinceIso: string): Promise<FeeReminderLedger | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const out: FeeReminderLedger = { byMobile: new Map(), byHousehold: new Map() };
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await ctx.sb
      .from("household_message_log")
      .select("mobile_e164, household_id, created_at")
      .eq("tenant_id", ctx.tenantId)
      .in("purpose", [...FEE_REMINDER_PURPOSES])
      .eq("status", "sent")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.warn("[feeReminderLedger] could not read the send log", error.message);
      return null;
    }
    const rows = (data ?? []) as { mobile_e164?: string | null; household_id?: string | null; created_at?: string | null }[];
    for (const r of rows) {
      const at = String(r.created_at || "");
      if (!at) continue;
      const m = mobileKey(r.mobile_e164 ?? "");
      if (m && (!out.byMobile.has(m) || at > out.byMobile.get(m)!)) out.byMobile.set(m, at);
      const h = String(r.household_id || "");
      if (h && (!out.byHousehold.has(h) || at > out.byHousehold.get(h)!)) out.byHousehold.set(h, at);
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

/** The window a weekly cap needs: this many days back from `now`, and a little over. */
export function feeLedgerSinceIso(now: Date, days = 8): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}
