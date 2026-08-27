/**
 * Client-side helper: attach a live gateway checkout (Cashfree/Razorpay) to a
 * pay-link before sharing. The secret keys live server-side, so this calls
 * the staff-authenticated attach route and patches the local store with the
 * checkout URL. On any failure the caller keeps the plain UPI share flow.
 */

import {
  getPaymentGatewayConfig,
} from "@/lib/paymentGateway";
import { patchPaymentLink, type PaymentLink } from "@/lib/payments";

export type GatewayAttachResult = {
  link: PaymentLink;
  attached: boolean;
  error?: string;
};

export async function attachGatewayCheckout(
  link: PaymentLink,
): Promise<GatewayAttachResult> {
  if (
    getPaymentGatewayConfig().mode === "demo" ||
    link.status !== "open" ||
    link.gatewayCheckoutUrl
  ) {
    return { link, attached: !!link.gatewayCheckoutUrl };
  }
  try {
    const res = await fetch("/api/payments/attach-gateway", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ link }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      gatewayMode?: PaymentLink["gatewayMode"];
      checkoutUrl?: string;
      externalId?: string;
      error?: string;
    };
    if (res.ok && json.ok && json.checkoutUrl) {
      const patched = patchPaymentLink(link.id, {
        gatewayMode: json.gatewayMode,
        gatewayCheckoutUrl: json.checkoutUrl,
        gatewayExternalId: json.externalId,
      });
      return {
        link: patched ?? { ...link, gatewayCheckoutUrl: json.checkoutUrl },
        attached: true,
      };
    }
    return { link, attached: false, error: json.error || `HTTP ${res.status}` };
  } catch {
    return { link, attached: false, error: "gateway unreachable" };
  }
}

/** Registration-fee variant — returns the hosted checkout URL or null. */
export async function fetchRegistrationCheckoutUrl(
  paymentId: string,
): Promise<string | null> {
  if (getPaymentGatewayConfig().mode !== "cashfree") return null;
  try {
    const res = await fetch("/api/payments/registration-attach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentId }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      checkoutUrl?: string;
    };
    return res.ok && json.ok && json.checkoutUrl ? json.checkoutUrl : null;
  } catch {
    return null;
  }
}
