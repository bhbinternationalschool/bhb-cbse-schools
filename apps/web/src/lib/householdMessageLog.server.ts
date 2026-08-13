/**
 * Unified per-household message log (§5.2 item 8) — "what did we send this
 * family?" across the channels that actually carry real content today.
 *
 * Scope, deliberately: WhatsApp sends that flow through the shared
 * `/api/wa/dispatch` choke point (fee reminders, staff duty notify,
 * substitution notify, admission campaigns, owner broadcast — every
 * caller already routes through that one file) plus in-app staff↔parent
 * chat (lib/erpChat.ts, already household-keyed). IVRS has no call
 * persistence anywhere in this codebase yet (in-memory Map only, lost on
 * restart) and email has no provider configured — both are surfaced as
 * "not yet tracked" in the UI rather than faked with empty/fabricated
 * rows. OTP sends are deliberately not logged here (one-time codes have
 * no business being stored in a searchable table).
 */
import { getServerTenantContext } from "@/lib/serverTenant";
import { findHouseholdByWaMobile } from "@/lib/waSisBotServer";
import { waNormalizeLocal10 } from "@/lib/waSend";
import { fetchDomainBlobFromDb } from "@/lib/domainBlob.server";
import type { ErpChatState } from "@/lib/erpChat";

export type HouseholdLogEntry = {
  id: string;
  channel: "wa" | "app_chat";
  direction: "out" | "in";
  purpose: string;
  via: string;
  templateName: string;
  preview: string;
  status: "sent" | "failed";
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

function appChatEntriesForHousehold(
  state: ErpChatState,
  householdId: string,
): HouseholdLogEntry[] {
  const threadIds = new Set(
    state.threads.filter((t) => t.householdId === householdId).map((t) => t.id),
  );
  if (threadIds.size === 0) return [];
  return state.messages
    .filter((m) => threadIds.has(m.threadId))
    .map((m) => ({
      id: m.id,
      channel: "app_chat" as const,
      direction: m.fromActorKind === "staff" ? ("out" as const) : ("in" as const),
      purpose: "app_chat",
      via: "app",
      templateName: "",
      preview: m.text.slice(0, 400),
      status: "sent" as const,
      error: null,
      by: m.fromActorKind === "staff" ? "Staff" : "Parent",
      at: m.at,
    }));
}

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
  const entries: HouseholdLogEntry[] = [];

  if (ctx) {
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
      console.warn("[householdMessageLog] wa fetch failed", error.message);
    } else {
      for (const r of data || []) {
        entries.push({
          id: String(r.id),
          channel: "wa",
          direction: r.direction === "in" ? "in" : "out",
          purpose: String(r.purpose || ""),
          via: String(r.via || ""),
          templateName: String(r.template_name || ""),
          preview: String(r.preview || ""),
          status: r.status === "failed" ? "failed" : "sent",
          error: r.error ? String(r.error) : null,
          by: "School",
          at: String(r.created_at),
        });
      }
    }
  }

  if (householdId) {
    const { ok, state } = await fetchDomainBlobFromDb("erp_chat_state");
    if (ok && state) {
      entries.push(
        ...appChatEntriesForHousehold(state as ErpChatState, householdId),
      );
    }
  }

  entries.sort((a, b) => b.at.localeCompare(a.at));
  return { householdId, entries: entries.slice(0, limit) };
}
