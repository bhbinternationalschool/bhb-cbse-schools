/**
 * Shapes and rules for the sent-message log — the pure half.
 *
 * Kept out of `waSentMessages.server.ts` so the tab component and a selftest
 * can both use them without dragging in a Supabase client.
 */

import type { WaDeliveryStage } from "@/lib/waDeliveryStatusShape";

export type WaSentMessageRow = {
  id: string;
  at: string;
  mobile: string;
  householdId: string | null;
  /** Dispatch bucket — "fees", "admissions", "comms"… */
  purpose: string;
  via: string;
  templateName: string;
  preview: string;
  /** Did the school manage to hand it to Meta at all? */
  handoff: "sent" | "failed";
  stage: WaDeliveryStage;
  stageLabel: string;
  deliveredAt: string | null;
  readAt: string | null;
  error: string | null;
  waMessageId: string;
};

export type WaSentMessageTally = {
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  /** Handed over, no webhook back yet. */
  unknown: number;
};

export function emptyTally(): WaSentMessageTally {
  return { total: 0, sent: 0, delivered: 0, read: 0, failed: 0, unknown: 0 };
}

export function countStage(
  tally: WaSentMessageTally,
  stage: WaDeliveryStage,
): void {
  tally.total++;
  switch (stage) {
    case "read":
      tally.read++;
      break;
    case "delivered":
      tally.delivered++;
      break;
    case "sent":
      tally.sent++;
      break;
    case "failed":
      tally.failed++;
      break;
    default:
      tally.unknown++;
  }
}

/**
 * The rung a row sits on.
 *
 * A send the school could not even hand to Meta is `failed` whatever the
 * webhooks say — there is no message for a tick to describe. Otherwise the
 * ladder decides, and "unknown" is left as itself rather than rounded down
 * to "sent": the office should not chase a family over a webhook that has
 * simply not arrived.
 */
export function resolveRowStage(
  handoff: "sent" | "failed",
  ladderStage: WaDeliveryStage,
): WaDeliveryStage {
  if (handoff === "failed") return "failed";
  return ladderStage;
}
