/**
 * Payment gateway adapter — wraps demo pay-links until a real PG is wired.
 * Set NEXT_PUBLIC_PAYMENT_GATEWAY=razorpay|cashfree|demo (default demo).
 */

import {
  createPaymentLink,
  type PaymentLink,
} from "@/lib/payments";
import type { FeeDueLine } from "@/lib/fees";

export type PaymentGatewayMode = "demo" | "razorpay" | "cashfree";

export type PaymentGatewayConfig = {
  mode: PaymentGatewayMode;
  /** Public key / merchant id when live */
  publicKey: string;
  configured: boolean;
};

export function getPaymentGatewayConfig(): PaymentGatewayConfig {
  const raw =
    (typeof process !== "undefined" &&
      process.env.NEXT_PUBLIC_PAYMENT_GATEWAY) ||
    "demo";
  const mode = (
    raw === "razorpay" || raw === "cashfree" ? raw : "demo"
  ) as PaymentGatewayMode;
  const publicKey =
    (typeof process !== "undefined" &&
      process.env.NEXT_PUBLIC_PAYMENT_GATEWAY_KEY) ||
    "";
  return {
    mode,
    publicKey,
    configured: mode === "demo" || !!publicKey,
  };
}

export function paymentGatewayModeLabel(mode: PaymentGatewayMode): string {
  switch (mode) {
    case "razorpay":
      return process.env.RAZORPAY_KEY_ID || process.env.NEXT_PUBLIC_PAYMENT_GATEWAY_KEY
        ? "Razorpay"
        : "Razorpay (keys pending)";
    case "cashfree":
      return "Cashfree (stub)";
    default:
      return "Demo UPI link";
  }
}

/**
 * Create a collectable payment for selected dues.
 * Live PG modes currently fall back to the demo pay-link flow and stamp a note.
 */
export function createGatewayPayment(input: {
  householdId: string;
  studentId: string;
  studentName: string;
  classLabel: string;
  dues: FeeDueLine[];
  createdBy: string;
  academicYearCode: string;
  note?: string;
}):
  | { ok: true; link: PaymentLink; gatewayMode: PaymentGatewayMode }
  | { ok: false; error: string } {
  const cfg = getPaymentGatewayConfig();
  if (!cfg.configured) {
    return {
      ok: false,
      error: `Set NEXT_PUBLIC_PAYMENT_GATEWAY_KEY for ${cfg.mode}`,
    };
  }

  const noteParts = [
    input.note?.trim(),
    cfg.mode !== "demo" ? `PG:${cfg.mode}` : "",
  ].filter(Boolean);

  const created = createPaymentLink({
    ...input,
    note: noteParts.join(" · ") || undefined,
  });
  if (!created.ok) return created;
  return { ok: true, link: created.link, gatewayMode: cfg.mode };
}

/** Placeholder checkout URL — demo uses in-app pay share; live PG would redirect here. */
export function gatewayCheckoutHint(mode: PaymentGatewayMode): string {
  if (mode === "demo") {
    return "Parents pay via demo UPI / pay-share page on this domain.";
  }
  if (mode === "razorpay") {
    return "Razorpay — create orders with notes.linkId; webhook /api/payments/razorpay/webhook settles the link.";
  }
  return `${paymentGatewayModeLabel(mode)} — connect merchant keys to replace demo confirm with webhook settlement.`;
}

/** True when Razorpay server secrets are present (webhook can settle). */
export function razorpayWebhookConfigured(): boolean {
  return !!(
    process.env.RAZORPAY_KEY_ID &&
    process.env.RAZORPAY_KEY_SECRET &&
    process.env.RAZORPAY_WEBHOOK_SECRET
  );
}
