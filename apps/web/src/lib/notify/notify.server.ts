/**
 * notify(event) with the real dependencies (the logic is ./notify.ts):
 *
 *   audience  the server's Masters + roster and roles — the same reference
 *             caches every API request authorises with (lib/api/v1/auth.ts);
 *             a cache with no copy at all = unknown = nobody is notified
 *   deliver   erp_notify_deliver (migration 20261020120000) through the
 *             service client — one transaction, change signal included
 *   prefs     erp_notification_prefs for the recipients
 *   push      sendPushToSubject: the person's phones (FCM, the topic's voice
 *             channel; staff English, a family Hindi unless they chose
 *             English) and browsers with Web Push
 */
import "server-only";

import { readServerMastersCopy, readServerRbacCopy } from "@/lib/api/v1/auth";
import { voiceLanguageFor } from "@/lib/fcm.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { protectedSuperAdminEmails } from "@/lib/superAdmin";
import { sendPushToSubject } from "@/lib/webPush.server";
import { prefsFrom, recipientKey, type NotifyPrefs, type Recipient } from "./kinds";
import { notifyWith, type DeliverResult, type NotifyDeps, type NotifyEvent, type NotifyResult } from "./notify";
import { PLAIN_CHANNEL } from "./policy";

const PREFS_CHUNK = 200;

export const notifyDeps: NotifyDeps = {
  audienceContext: async () => {
    const [m, r] = await Promise.all([readServerMastersCopy(), readServerRbacCopy()]);
    if (!m.ok || !r.ok) return null;
    // Masters read but the roster not (`fallback`): the staff list is unknown, not empty.
    if (m.from === "fallback") return null;
    return { masters: m.value, rbac: r.value.state, superAdminEmails: protectedSuperAdminEmails() };
  },

  deliver: async (rows) => {
    const ctx = await getServerTenantContext();
    if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
    const { data, error } = await ctx.sb.rpc("erp_notify_deliver", { p_tenant: ctx.tenantId, p_rows: rows });
    if (error) return { ok: false, error: `${error.code ?? ""} ${error.message}`.trim() };
    const body = (data ?? {}) as { ok?: boolean; results?: DeliverResult[] };
    if (body.ok !== true || !Array.isArray(body.results)) return { ok: false, error: "erp_notify_deliver answered without results" };
    return { ok: true, results: body.results };
  },

  prefsFor: async (recipients) => {
    const ctx = await getServerTenantContext();
    if (!ctx) return null;
    const out = new Map<string, NotifyPrefs>();
    for (const type of ["staff", "parent"] as const) {
      const ids = recipients.filter((r) => r.type === type).map((r) => r.id);
      for (let i = 0; i < ids.length; i += PREFS_CHUNK) {
        const { data, error } = await ctx.sb
          .from("erp_notification_prefs")
          .select("recipient_type, recipient_id, muted_topics, voice, quiet_enabled, quiet_start, quiet_end")
          .eq("tenant_id", ctx.tenantId)
          .eq("recipient_type", type)
          .in("recipient_id", ids.slice(i, i + PREFS_CHUNK));
        if (error) return null;
        for (const row of data ?? []) {
          const r = row as { recipient_type: Recipient["type"]; recipient_id: string };
          out.set(recipientKey({ type: r.recipient_type, id: r.recipient_id }), prefsFrom(row));
        }
      }
    }
    return out;
  },

  push: async (to, msg) => {
    const lang = await voiceLanguageFor(to.type, to.id);
    const pick = (t: { en: string; hi?: string }) => (lang === "hi" && t.hi ? t.hi : t.en);
    const r = await sendPushToSubject(to.type, to.id, {
      title: pick(msg.title),
      body: pick(msg.body),
      url: msg.url,
      data: msg.data,
      ...(msg.voice ? { voiceTopic: msg.topic } : { channel: PLAIN_CHANNEL }),
    });
    return { sent: r.sent };
  },

  now: () => Date.now(),
  log: (msg) => console.warn(msg),
};

/** Tell the people an event concerns. Never throws; see ./notify.ts. */
export function notify(ev: NotifyEvent): Promise<NotifyResult> {
  return notifyWith(notifyDeps, ev);
}
