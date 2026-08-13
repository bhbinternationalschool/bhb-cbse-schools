/**
 * Ingest Meta's per-message delivery-status webhook events (sent/delivered/
 * read/failed) into wa_message_delivery — parallel in spirit to
 * parseMetaTemplateStatusUpdates in waTemplatesMeta.server.ts, but for the
 * `statuses` array Meta sends on the same `field: "messages"` change as
 * inbound messages (see parseMetaWebhookInbound in waCrmBotServer.ts).
 */
import { getServerTenantContext } from "@/lib/serverTenant";

export type WaDeliveryStatusEvent = {
  waMessageId: string;
  status: string;
  mobile?: string;
  errorMessage?: string;
  eventAt?: string;
};

/** Pure — extract `statuses` events from a Meta webhook POST body. */
export function parseMetaStatusUpdates(body: unknown): WaDeliveryStatusEvent[] {
  const out: WaDeliveryStatusEvent[] = [];
  if (!body || typeof body !== "object") return out;
  const root = body as {
    entry?: {
      changes?: {
        value?: {
          statuses?: {
            id?: string;
            status?: string;
            timestamp?: string;
            recipient_id?: string;
            errors?: { title?: string; message?: string }[];
          }[];
        };
      }[];
    }[];
  };
  for (const entry of root.entry || []) {
    for (const change of entry.changes || []) {
      for (const s of change.value?.statuses || []) {
        if (!s.id || !s.status) continue;
        const ts = Number(s.timestamp);
        out.push({
          waMessageId: s.id,
          status: s.status,
          mobile: s.recipient_id,
          errorMessage: s.errors?.[0]?.title || s.errors?.[0]?.message,
          eventAt: Number.isFinite(ts) && ts > 0
            ? new Date(ts * 1000).toISOString()
            : undefined,
        });
      }
    }
  }
  return out;
}

/** Count failed deliveries in the trailing `hours` window. Throws (does not
 * return 0) on any lookup failure — a caller surfacing this as an anomaly
 * count must never confuse "couldn't check" with "genuinely zero failures". */
export async function countRecentWaFailures(hours = 24): Promise<number> {
  const ctx = await getServerTenantContext();
  if (!ctx) throw new Error("[waDeliveryLog] no server tenant context");
  const { sb, tenantId } = ctx;
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const { count, error } = await sb
    .from("wa_message_delivery")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("status", "failed")
    .gte("event_at", cutoff);
  if (error) throw new Error(`[waDeliveryLog] countRecentWaFailures: ${error.message}`);
  return count ?? 0;
}

/** Append delivery-status events. Best-effort — a logging failure must never
 * break webhook processing for the caller's other work (inbound routing etc). */
export async function recordDeliveryStatuses(
  events: WaDeliveryStatusEvent[],
): Promise<void> {
  if (!events.length) return;
  try {
    const ctx = await getServerTenantContext();
    if (!ctx) {
      console.warn("[waDeliveryLog] no server tenant context — skipping");
      return;
    }
    const { sb, tenantId } = ctx;
    const now = new Date().toISOString();
    const rows = events.map((e) => ({
      tenant_id: tenantId,
      wa_message_id: e.waMessageId,
      mobile_e164: e.mobile || null,
      status: e.status,
      error_message: e.errorMessage || null,
      event_at: e.eventAt || now,
      updated_at: now,
    }));
    const { error } = await sb.from("wa_message_delivery").insert(rows);
    if (error) console.warn("[waDeliveryLog] insert failed", error.message);
  } catch (e) {
    console.warn("[waDeliveryLog] recordDeliveryStatuses failed", e);
  }
}
