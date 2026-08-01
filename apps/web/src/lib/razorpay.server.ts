/**
 * Razorpay Payment Links — server-only (keys never exposed to client).
 */

import {
  patchPaymentLink,
  type PaymentLink,
} from "@/lib/payments";
import { razorpayWebhookConfigured } from "@/lib/paymentGateway";

export function razorpayKeysPresent(): boolean {
  return !!(
    process.env.RAZORPAY_KEY_ID?.trim() &&
    process.env.RAZORPAY_KEY_SECRET?.trim()
  );
}

export function shouldUseRazorpayCheckout(): boolean {
  const mode =
    process.env.NEXT_PUBLIC_PAYMENT_GATEWAY === "razorpay" ||
    (process.env.NEXT_PUBLIC_PAYMENT_GATEWAY !== "cashfree" &&
      razorpayWebhookConfigured());
  return mode && razorpayKeysPresent();
}

type RazorpayCreateResult =
  | { ok: true; shortUrl: string; id: string }
  | { ok: false; error: string };

export async function createRazorpayPaymentLink(opts: {
  link: PaymentLink;
  customerName: string;
  customerMobile: string;
  callbackUrl: string;
}): Promise<RazorpayCreateResult> {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!keyId || !keySecret) {
    return { ok: false, error: "Razorpay keys not configured" };
  }

  const contact = opts.customerMobile.replace(/\D/g, "").slice(-10);
  const body = {
    amount: opts.link.amountPaise,
    currency: "INR",
    accept_partial: false,
    description: `School fees ${opts.link.code} — ${opts.link.studentName}`.slice(
      0,
      255,
    ),
    customer: {
      name: (opts.customerName || "Parent").slice(0, 120),
      contact: contact.length === 10 ? contact : undefined,
    },
    notify: { sms: false, email: false },
    reminder_enable: false,
    notes: {
      linkId: opts.link.id,
      code: opts.link.code,
      householdId: opts.link.householdId,
    },
    callback_url: opts.callbackUrl,
    callback_method: "get",
  };

  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const res = await fetch("https://api.razorpay.com/v1/payment_links", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json().catch(() => ({}))) as {
    short_url?: string;
    id?: string;
    error?: { description?: string };
  };

  if (!res.ok || !data.short_url || !data.id) {
    return {
      ok: false,
      error: data.error?.description || `Razorpay HTTP ${res.status}`,
    };
  }

  return { ok: true, shortUrl: data.short_url, id: data.id };
}

/** Attach Razorpay checkout to an existing school pay-link (mutates payments store). */
export async function attachRazorpayToPaymentLink(opts: {
  link: PaymentLink;
  customerName: string;
  customerMobile: string;
  appOrigin: string;
}): Promise<
  | { ok: true; link: PaymentLink; checkoutUrl: string }
  | { ok: false; error: string; link: PaymentLink }
> {
  if (!shouldUseRazorpayCheckout()) {
    return { ok: false, error: "Razorpay not enabled", link: opts.link };
  }

  const callbackUrl = `${opts.appOrigin.replace(/\/$/, "")}/pay/share?linkId=${encodeURIComponent(opts.link.id)}&rz=1`;
  const rz = await createRazorpayPaymentLink({
    link: opts.link,
    customerName: opts.customerName,
    customerMobile: opts.customerMobile,
    callbackUrl,
  });

  if (!rz.ok) {
    return { ok: false, error: rz.error, link: opts.link };
  }

  const patched = patchPaymentLink(opts.link.id, {
    gatewayMode: "razorpay",
    gatewayCheckoutUrl: rz.shortUrl,
    gatewayExternalId: rz.id,
  });

  if (!patched) {
    return { ok: false, error: "Could not save Razorpay link", link: opts.link };
  }

  return { ok: true, link: patched, checkoutUrl: rz.shortUrl };
}
