/**
 * The delivery-stage vocabulary, on its own.
 *
 * `waDeliveryStatus.server.ts` owns the queries; this owns the words, so a
 * client component and a selftest can name a rung without importing a
 * Supabase client. The server module re-exports these, so there is still one
 * definition of what a tick means in this ERP.
 */

/**
 * The furthest rung reached — what a tick would show.
 *
 * `read` is the double blue tick. It only ever arrives if the PARENT has
 * read receipts switched on in WhatsApp; a family who has turned them off
 * stops at `delivered` forever, and that is not a fault to chase.
 */
export type WaDeliveryStage =
  | "failed"
  | "read"
  | "delivered"
  | "sent"
  | "unknown";

/** Plain words for the office. Never "✓✓" alone — a tick needs a label. */
export function stageLabel(stage: WaDeliveryStage): string {
  switch (stage) {
    case "failed":
      return "Failed";
    case "read":
      return "Read";
    case "delivered":
      return "Delivered";
    case "sent":
      return "Sent";
    default:
      // Not "not delivered": we genuinely do not know yet, and saying the
      // stronger thing would have the office chasing a parent who is fine.
      return "No update yet";
  }
}
