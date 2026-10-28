/**
 * Per-staff message timeline — mirrors householdMessageLog.server.ts's
 * scope for a staff member instead of a household: WhatsApp sends to
 * their own mobile (duty/substitution notify, leadership pings from the
 * staff broadcast panel, owner staff broadcasts) plus school chat: their
 * direct chats (staff and families), the staff-made groups they are in,
 * and every message they sent (class / subject groups included).
 *
 * The WA half needs no new table: /api/wa/dispatch already calls
 * logHouseholdWaSend for every send it makes, keyed by mobile_e164,
 * regardless of whether the recipient resolves to an SIS household — a
 * staff member's own WA sends are already rows in household_message_log
 * with household_id null. The in-app half is school chat
 * (lib/schoolChatLog.server.ts), scoped to the staff member.
 */
import { getServerTenantContext } from "@/lib/serverTenant";
import { waNormalizeLocal10 } from "@/lib/waSend";
import type { HouseholdLogEntry } from "@/lib/householdMessageLog.server";
import { ChatLogReadError, schoolChatEntriesForStaff, type ChatLogDb } from "@/lib/schoolChatLog.server";

export type StaffLogEntry = HouseholdLogEntry;

/**
 * Throws ChatLogReadError when the school database cannot be read — the
 * route answers 503; a failed read is never an empty timeline.
 */
export async function getStaffMessageTimeline(opts: {
  staffId?: string;
  mobile?: string;
  limit?: number;
}): Promise<{ entries: StaffLogEntry[] }> {
  const limit = opts.limit ?? 100;
  const mobile10 = opts.mobile ? waNormalizeLocal10(opts.mobile) : "";
  const entries: StaffLogEntry[] = [];
  const ctx = await getServerTenantContext();
  if (!ctx) throw new ChatLogReadError("Could not reach the school database — please try again.");
  const { sb, tenantId } = ctx;

  if (mobile10) {
    const { data, error } = await sb
      .from("household_message_log")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("mobile_e164", `91${mobile10}`)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      console.error("[staffMessageLog] wa fetch failed", error.message);
      throw new ChatLogReadError("Could not read the WhatsApp messages — please try again.");
    }
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

  if (opts.staffId) {
    entries.push(...(await schoolChatEntriesForStaff(sb as unknown as ChatLogDb, tenantId, opts.staffId, limit)));
  }

  entries.sort((a, b) => b.at.localeCompare(a.at));
  return { entries: entries.slice(0, limit) };
}
