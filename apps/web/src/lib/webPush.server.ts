/**
 * Web Push (Round 14 — minimal slice). Subscriptions live in
 * public.push_subscriptions, one row per browser/device. Sending is
 * best-effort: a missing/expired subscription must never fail the caller's
 * primary flow (WhatsApp stays the primary channel — see fees.ts).
 */

import webpush from "web-push";
import { getServerTenantContext } from "@/lib/serverTenant";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";

let vapidConfigured = false;
function ensureVapidConfigured() {
  if (vapidConfigured || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;
  webpush.setVapidDetails(
    "mailto:director@bhbinternational.school",
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
  );
  vapidConfigured = true;
}

export function webPushConfigured(): boolean {
  return !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}

export type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
};

function rowToRecord(row: {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}): PushSubscriptionRow {
  return { id: row.id, endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth };
}

export async function upsertPushSubscription(input: {
  subjectType: string;
  subjectId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Tenant unavailable" };
  const { error } = await ctx.sb.from("push_subscriptions").upsert(
    {
      id: `push_${Buffer.from(input.endpoint).toString("base64url").slice(0, 40)}`,
      tenant_id: ctx.tenantId,
      subject_type: input.subjectType,
      subject_id: input.subjectId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      user_agent: input.userAgent || "",
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deletePushSubscriptionByEndpoint(
  endpoint: string,
): Promise<{ ok: boolean }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false };
  await ctx.sb.from("push_subscriptions").delete().eq("endpoint", endpoint);
  return { ok: true };
}

async function listSubscriptionsForSubject(
  subjectType: string,
  subjectId: string,
): Promise<PushSubscriptionRow[]> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  const { data, error } = await ctx.sb
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("tenant_id", ctx.tenantId)
    .eq("subject_type", subjectType)
    .eq("subject_id", subjectId);
  if (error || !data) return [];
  return data.map(rowToRecord);
}

/**
 * Send one payload to every device subscribed for a subject. Best-effort —
 * expired (404/410) subscriptions are deleted; any other failure is logged
 * and skipped. Never throws.
 */
export async function sendPushToSubject(
  subjectType: string,
  subjectId: string,
  payload: PushPayload,
): Promise<{ sent: number; expired: number; failed: number }> {
  if (!webPushConfigured()) return { sent: 0, expired: 0, failed: 0 };
  ensureVapidConfigured();
  const subs = await listSubscriptionsForSubject(subjectType, subjectId);
  let sent = 0;
  let expired = 0;
  let failed = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify(payload),
      );
      sent += 1;
    } catch (e) {
      const statusCode = (e as { statusCode?: number })?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await deletePushSubscriptionByEndpoint(sub.endpoint);
        expired += 1;
      } else {
        console.warn("[webPush] send failed", statusCode, e);
        failed += 1;
      }
    }
  }
  return { sent, expired, failed };
}
