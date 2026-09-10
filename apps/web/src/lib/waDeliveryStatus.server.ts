/**
 * What WhatsApp's ticks actually say, per message.
 *
 * Meta's status webhook has been filling `wa_message_delivery` for months —
 * sent, delivered, read and failed, with timestamps — and nothing in the ERP
 * ever showed it. The office could see a COUNT of failures in the last 24
 * hours on the command desk and nothing else, so "did that parent get their
 * receipt" had no answer short of asking them.
 *
 * The table stores one row per status per message, which is the right shape
 * for an audit and the wrong one for a screen. This collapses it to the thing
 * a person actually wants: one ladder per message.
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import {
  stageLabel as stageLabelText,
  type WaDeliveryStage as Stage,
} from "@/lib/waDeliveryStatusShape";

export type WaDeliveryLadder = {
  waMessageId: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  failedAt: string | null;
  error: string | null;
};

// The vocabulary lives in waDeliveryStatusShape so a client component can
// name a rung without pulling a Supabase client into the browser bundle.
// Re-exported here because every existing caller imports it from this file.
export type { WaDeliveryStage } from "@/lib/waDeliveryStatusShape";
export { stageLabel } from "@/lib/waDeliveryStatusShape";

export function ladderStage(l: WaDeliveryLadder | undefined): Stage {
  if (!l) return "unknown";
  if (l.failedAt) return "failed";
  if (l.readAt) return "read";
  if (l.deliveredAt) return "delivered";
  if (l.sentAt) return "sent";
  return "unknown";
}

export async function deliveryLaddersFor(
  waMessageIds: string[],
): Promise<Map<string, WaDeliveryLadder>> {
  const out = new Map<string, WaDeliveryLadder>();
  const ids = [...new Set(waMessageIds.filter(Boolean))];
  if (ids.length === 0) return out;

  const ctx = await getServerTenantContext();
  if (!ctx) return out;

  // Chunked because a busy fee day is easily a few hundred receipts, and a
  // single `in` list that long is how a query starts getting refused.
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { data, error } = await ctx.sb
      .from("wa_message_delivery")
      .select("wa_message_id, status, event_at, error_message")
      .eq("tenant_id", ctx.tenantId)
      .in("wa_message_id", slice);
    if (error) {
      console.warn("[waDelivery] read failed", error.message);
      continue;
    }
    for (const r of data || []) {
      const id = String(r.wa_message_id || "");
      if (!id) continue;
      const cur =
        out.get(id) ??
        {
          waMessageId: id,
          sentAt: null,
          deliveredAt: null,
          readAt: null,
          failedAt: null,
          error: null,
        };
      const at = r.event_at ? String(r.event_at) : null;
      // Keep the EARLIEST timestamp per rung. Meta can repeat a status, and
      // "delivered at 09:02" then "delivered at 09:40" should read as the
      // moment it arrived, not the moment it was last mentioned.
      const keep = (prev: string | null) =>
        !prev || (at && at < prev) ? at : prev;
      switch (String(r.status)) {
        case "sent":
          cur.sentAt = keep(cur.sentAt);
          break;
        case "delivered":
          cur.deliveredAt = keep(cur.deliveredAt);
          break;
        case "read":
          cur.readAt = keep(cur.readAt);
          break;
        case "failed":
          cur.failedAt = keep(cur.failedAt);
          cur.error = r.error_message ? String(r.error_message) : cur.error;
          break;
      }
      out.set(id, cur);
    }
  }
  return out;
}

export type ReceiptSendRow = {
  voucherId: string;
  receiptNo: string;
  mobile: string;
  status: string;
  error: string;
  sentAt: string;
  waMessageId: string;
  stage: Stage;
  stageLabel: string;
  ladder: WaDeliveryLadder | null;
};

/**
 * Receipts the school has messaged, with what happened to each.
 *
 * `voucherIds` narrows it to specific receipts; `sinceIso` to a day. Both
 * absent returns the most recent, which is what a desk view wants.
 */
export async function receiptSendStatuses(opts: {
  voucherIds?: string[];
  sinceIso?: string;
  limit?: number;
}): Promise<ReceiptSendRow[]> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];

  let q = ctx.sb
    .from("wa_receipt_sends")
    .select("voucher_id, receipt_no, mobile, status, error, sent_at, wa_message_id")
    .eq("tenant_id", ctx.tenantId)
    .order("sent_at", { ascending: false })
    .limit(Math.min(Math.max(opts.limit ?? 200, 1), 500));
  if (opts.voucherIds?.length) q = q.in("voucher_id", opts.voucherIds);
  if (opts.sinceIso) q = q.gte("sent_at", opts.sinceIso);

  const { data, error } = await q;
  if (error) {
    console.warn("[waDelivery] receipt sends read failed", error.message);
    return [];
  }
  const rows = data || [];
  const ladders = await deliveryLaddersFor(
    rows.map((r) => String(r.wa_message_id || "")),
  );

  return rows.map((r) => {
    const waMessageId = String(r.wa_message_id || "");
    const ladder = ladders.get(waMessageId) ?? null;
    // A send we could not even hand to Meta is `failed` here whatever the
    // ticks say, because there is no message for a tick to describe.
    const stage: Stage =
      String(r.status) === "sent" ? ladderStage(ladder ?? undefined) : "failed";
    return {
      voucherId: String(r.voucher_id),
      receiptNo: String(r.receipt_no || ""),
      mobile: String(r.mobile || ""),
      status: String(r.status || ""),
      error: String(r.error || ""),
      sentAt: String(r.sent_at || ""),
      waMessageId,
      stage,
      stageLabel: stageLabelText(stage),
      ladder,
    };
  });
}
