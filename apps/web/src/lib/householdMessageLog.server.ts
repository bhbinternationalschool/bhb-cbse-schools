/**
 * Unified per-household message log (§5.2 item 8) — "what did we send this
 * family?" across the channels that actually carry real content today.
 *
 * Scope, deliberately: WhatsApp sends that flow through the shared
 * `/api/wa/dispatch` choke point (fee reminders, staff duty notify,
 * substitution notify, admission campaigns, owner broadcast — every
 * caller already routes through that one file) plus school chat: the
 * family's direct chats with staff and everything it sent
 * (lib/schoolChatLog.server.ts). IVRS has no call
 * persistence anywhere in this codebase yet (in-memory Map only, lost on
 * restart) and email has no provider configured — both are surfaced as
 * "not yet tracked" in the UI rather than faked with empty/fabricated
 * rows. OTP sends are deliberately not logged here (one-time codes have
 * no business being stored in a searchable table).
 */
import {
  deliveryLaddersFor,
  ladderStage,
  stageLabel,
  type WaDeliveryStage,
} from "@/lib/waDeliveryStatus.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { findHouseholdByWaMobile } from "@/lib/waSisBotServer";
import { waNormalizeLocal10 } from "@/lib/waSend";
import { ChatLogReadError, schoolChatEntriesForHousehold, type ChatLogDb } from "@/lib/schoolChatLog.server";

export type HouseholdLogEntry = {
  id: string;
  channel: "wa" | "app_chat";
  direction: "out" | "in";
  purpose: string;
  via: string;
  templateName: string;
  preview: string;
  status: "sent" | "failed";
  /**
   * How far WhatsApp actually got — the tick.
   *
   * `status` above only records whether the school handed the message to
   * Meta. Whether it reached the phone, and whether anybody opened it, lives
   * in `wa_message_delivery` and was never shown anywhere. "sent" and "read"
   * are very different answers to "did they get the receipt".
   */
  deliveryStage?: WaDeliveryStage;
  deliveryLabel?: string;
  deliveredAt?: string | null;
  readAt?: string | null;
  error: string | null;
  by: string;
  at: string;
};

/** Fail-open — a logging error must never fail the WA send it's recording. */
export async function logHouseholdWaSend(opts: {
  mobile: string;
  purpose: string;
  via: "template" | "text";
  templateName?: string;
  preview: string;
  status: "sent" | "failed";
  error?: string;
  waMessageId?: string;
}): Promise<void> {
  try {
    const ctx = await getServerTenantContext();
    if (!ctx) return;
    const { sb, tenantId } = ctx;
    const mobile10 = waNormalizeLocal10(opts.mobile);
    const household = mobile10 ? findHouseholdByWaMobile(mobile10) : null;
    const { error } = await sb.from("household_message_log").insert({
      tenant_id: tenantId,
      channel: "wa",
      direction: "out",
      household_id: household?.id || null,
      mobile_e164: mobile10 ? `91${mobile10}` : opts.mobile,
      purpose: opts.purpose,
      via: opts.via,
      template_name: opts.templateName || "",
      preview: opts.preview.slice(0, 400),
      status: opts.status,
      error: opts.error || null,
      wa_message_id: opts.waMessageId || null,
    });
    if (error) console.warn("[householdMessageLog] insert failed", error.message);
  } catch (e) {
    console.warn("[householdMessageLog] logHouseholdWaSend threw", e);
  }
}

/**
 * Throws ChatLogReadError when the school database cannot be read — the
 * route answers 503; a failed read is never an empty history.
 */
export async function getHouseholdMessageTimeline(opts: {
  householdId?: string;
  mobile?: string;
  limit?: number;
}): Promise<{
  householdId: string | null;
  entries: HouseholdLogEntry[];
}> {
  const limit = opts.limit ?? 100;
  let householdId = opts.householdId || null;
  const mobile10 = opts.mobile ? waNormalizeLocal10(opts.mobile) : "";
  if (!householdId && mobile10) {
    householdId = findHouseholdByWaMobile(mobile10)?.id || null;
  }

  const ctx = await getServerTenantContext();
  if (!ctx) throw new ChatLogReadError("Could not reach the school database — please try again.");
  const entries: HouseholdLogEntry[] = [];

  const { sb, tenantId } = ctx;
  let query = sb
    .from("household_message_log")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);
  query = householdId
    ? query.eq("household_id", householdId)
    : query.eq("mobile_e164", mobile10 ? `91${mobile10}` : opts.mobile || "");
  const { data, error } = await query;
  if (error) {
    console.error("[householdMessageLog] wa fetch failed", error.message);
    throw new ChatLogReadError("Could not read the WhatsApp messages — please try again.");
  }
  const waRows = data || [];
  const ladders = await deliveryLaddersFor(
    waRows.map((r) => String(r.wa_message_id || "")),
  );
  for (const r of waRows) {
    const ladder = ladders.get(String(r.wa_message_id || ""));
    const stage: WaDeliveryStage =
      r.status === "failed" ? "failed" : ladderStage(ladder);
    entries.push({
      id: String(r.id),
      channel: "wa",
      direction: r.direction === "in" ? "in" : "out",
      purpose: String(r.purpose || ""),
      via: String(r.via || ""),
      templateName: String(r.template_name || ""),
      preview: String(r.preview || ""),
      status: r.status === "failed" ? "failed" : "sent",
      deliveryStage: stage,
      deliveryLabel: stageLabel(stage),
      deliveredAt: ladder?.deliveredAt ?? null,
      readAt: ladder?.readAt ?? null,
      error: r.error ? String(r.error) : (ladder?.error ?? null),
      by: "School",
      at: String(r.created_at),
    });
  }

  if (householdId) {
    entries.push(...(await schoolChatEntriesForHousehold(sb as unknown as ChatLogDb, tenantId, householdId, limit)));
  }

  entries.sort((a, b) => b.at.localeCompare(a.at));
  return { householdId, entries: entries.slice(0, limit) };
}
