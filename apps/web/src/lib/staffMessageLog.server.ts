/**
 * Per-staff message timeline — mirrors householdMessageLog.server.ts's
 * scope for a staff member instead of a household: WhatsApp sends to
 * their own mobile (duty/substitution notify, leadership pings from the
 * staff broadcast panel, owner staff broadcasts) plus in-app ERP chat
 * threads they participate in (staff DMs, staff groups, class-
 * announcement channels, parent DMs they hold).
 *
 * The WA half needs no new table: /api/wa/dispatch already calls
 * logHouseholdWaSend for every send it makes, keyed by mobile_e164,
 * regardless of whether the recipient resolves to an SIS household — a
 * staff member's own WA sends are already rows in household_message_log
 * with household_id null. Only the in-app chat half needs a fresh query,
 * scoped by participantIds instead of householdId.
 */
import { getServerTenantContext } from "@/lib/serverTenant";
import { waNormalizeLocal10 } from "@/lib/waSend";
import { fetchDomainBlobFromDb } from "@/lib/domainBlob.server";
import type { ErpChatState } from "@/lib/erpChat";
import type { HouseholdLogEntry } from "@/lib/householdMessageLog.server";

export type StaffLogEntry = HouseholdLogEntry;

function appChatEntriesForStaff(
  state: ErpChatState,
  staffId: string,
): StaffLogEntry[] {
  const threadIds = new Set(
    state.threads
      .filter((t) => t.participantIds.includes(staffId))
      .map((t) => t.id),
  );
  if (threadIds.size === 0) return [];
  return state.messages
    .filter((m) => threadIds.has(m.threadId))
    .map((m) => ({
      id: m.id,
      channel: "app_chat" as const,
      direction: m.fromActorKey === staffId ? ("out" as const) : ("in" as const),
      purpose: "app_chat",
      via: "app",
      templateName: "",
      preview: m.text.slice(0, 400),
      status: "sent" as const,
      error: null,
      by:
        m.fromActorKind === "staff"
          ? m.fromActorKey === staffId
            ? "You"
            : "Staff"
          : "Parent",
      at: m.at,
    }));
}

export async function getStaffMessageTimeline(opts: {
  staffId?: string;
  mobile?: string;
  limit?: number;
}): Promise<{ entries: StaffLogEntry[] }> {
  const limit = opts.limit ?? 100;
  const mobile10 = opts.mobile ? waNormalizeLocal10(opts.mobile) : "";
  const entries: StaffLogEntry[] = [];

  if (mobile10) {
    const ctx = await getServerTenantContext();
    if (ctx) {
      const { sb, tenantId } = ctx;
      const { data, error } = await sb
        .from("household_message_log")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("mobile_e164", `91${mobile10}`)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) {
        console.warn("[staffMessageLog] wa fetch failed", error.message);
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
  }

  if (opts.staffId) {
    const { ok, state } = await fetchDomainBlobFromDb("erp_chat_state");
    if (ok && state) {
      entries.push(
        ...appChatEntriesForStaff(state as ErpChatState, opts.staffId),
      );
    }
  }

  entries.sort((a, b) => b.at.localeCompare(a.at));
  return { entries: entries.slice(0, limit) };
}
