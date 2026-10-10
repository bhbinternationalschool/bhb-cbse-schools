/**
 * Read what is waiting on a person at the school. See officeBacklog.ts for
 * why, and for the rule that an unreadable source is `null`, never zero.
 */
import { getServerTenantContext } from "@/lib/serverTenant";
import { wholeDaysBetween, type OfficeBacklog } from "@/lib/officeBacklog";

/**
 * How far back the relay and the files are counted. Long enough that a
 * week's backlog cannot hide; short enough that a hand-off from before the
 * office had any routes (13–14 Sep 2026) stops being reported for ever.
 */
export const BACKLOG_WINDOW_DAYS = 14;

async function waitingParents(now: Date): Promise<OfficeBacklog["waitingParents"]> {
  try {
    const { listWaSisBotThreads } = await import("@/lib/waSisBotServer");
    const threads = await listWaSisBotThreads();
    const out: { name: string; days: number }[] = [];
    for (const t of threads) {
      if (t.status !== "needs_staff") continue;
      // Waiting since the parent last wrote: that is when they started
      // expecting an answer, not when the bot last spoke.
      const lastParent = [...(t.messages ?? [])].reverse().find((m) => m.role === "parent");
      const since = lastParent?.at || t.updatedAt;
      const days = wholeDaysBetween(since, now.toISOString());
      out.push({ name: (t.parentName || "").trim() || t.mobile.slice(-4).padStart(10, "•"), days: days ?? 0 });
    }
    return out.sort((a, b) => b.days - a.days);
  } catch (e) {
    console.warn("[officeBacklog] could not read the parent chats", (e as Error)?.message);
    return null;
  }
}

export async function readOfficeBacklog(now: Date = new Date()): Promise<OfficeBacklog> {
  const ctx = await getServerTenantContext();
  const since = new Date(now.getTime() - BACKLOG_WINDOW_DAYS * 86_400_000).toISOString();

  const parents = await waitingParents(now);
  if (!ctx) {
    return {
      waitingParents: parents,
      relayUnanswered: null,
      relayNoRoute: null,
      mediaUnreviewed: null,
      daysSinceFeeReminder: null,
    };
  }
  const { sb, tenantId } = ctx;

  const [relay, media, fee] = await Promise.all([
    sb
      .from("wa_relay_messages")
      .select("status, replied_at")
      .eq("tenant_id", tenantId)
      .gte("created_at", since),
    sb
      .from("wa_inbound_media")
      .select("media_type, reviewed_at")
      .eq("tenant_id", tenantId)
      .is("reviewed_at", null)
      .gte("received_at", since),
    sb
      .from("household_message_log")
      .select("created_at")
      .eq("tenant_id", tenantId)
      .eq("purpose", "fees")
      .eq("status", "sent")
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  let relayUnanswered: number | null = null;
  let relayNoRoute: number | null = null;
  if (relay.error) {
    console.warn("[officeBacklog] relay unreadable", relay.error.message);
  } else {
    const rows = (relay.data ?? []) as { status?: string | null; replied_at?: string | null }[];
    relayNoRoute = rows.filter((r) => r.status === "no_route").length;
    relayUnanswered = rows.filter((r) => r.status !== "no_route" && !r.replied_at).length;
  }

  let mediaUnreviewed: OfficeBacklog["mediaUnreviewed"] = null;
  if (media.error) {
    console.warn("[officeBacklog] files unreadable", media.error.message);
  } else {
    const rows = (media.data ?? []) as { media_type?: string | null }[];
    mediaUnreviewed = {
      images: rows.filter((r) => r.media_type === "image").length,
      audio: rows.filter((r) => r.media_type === "audio").length,
      other: rows.filter((r) => r.media_type !== "image" && r.media_type !== "audio").length,
    };
  }

  let daysSinceFeeReminder: number | null = null;
  if (fee.error) {
    console.warn("[officeBacklog] fee log unreadable", fee.error.message);
  } else {
    const last = ((fee.data ?? [])[0] as { created_at?: string } | undefined)?.created_at;
    daysSinceFeeReminder = last ? wholeDaysBetween(last, now.toISOString()) : null;
  }

  return { waitingParents: parents, relayUnanswered, relayNoRoute, mediaUnreviewed, daysSinceFeeReminder };
}
