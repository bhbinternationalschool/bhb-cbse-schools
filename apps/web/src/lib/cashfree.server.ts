/**
 * Cashfree Payment Links — server-only (keys never exposed to client).
 *
 * Env: CASHFREE_APP_ID, CASHFREE_SECRET_KEY, CASHFREE_ENV=sandbox|production.
 * Webhook (PAYMENT_LINK_EVENT) settles at /api/payments/cashfree/webhook.
 */

import {
  patchPaymentLink,
  type PaymentLink,
} from "@/lib/payments";
import { razorpayWebhookConfigured } from "@/lib/paymentGateway";

export const CASHFREE_API_VERSION = "2025-01-01";

export function cashfreeKeysPresent(): boolean {
  return !!(
    process.env.CASHFREE_APP_ID?.trim() &&
    process.env.CASHFREE_SECRET_KEY?.trim()
  );
}

export function cashfreeBaseUrl(): string {
  return process.env.CASHFREE_ENV?.trim().toLowerCase() === "production"
    ? "https://api.cashfree.com/pg"
    : "https://sandbox.cashfree.com/pg";
}

export function cashfreeAuthHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-api-version": CASHFREE_API_VERSION,
    "x-client-id": process.env.CASHFREE_APP_ID?.trim() ?? "",
    "x-client-secret": process.env.CASHFREE_SECRET_KEY?.trim() ?? "",
  };
}

export function shouldUseCashfreeCheckout(): boolean {
  const mode =
    process.env.NEXT_PUBLIC_PAYMENT_GATEWAY === "cashfree" ||
    (process.env.NEXT_PUBLIC_PAYMENT_GATEWAY !== "razorpay" &&
      !razorpayWebhookConfigured() &&
      cashfreeKeysPresent());
  return mode && cashfreeKeysPresent();
}

type CashfreeCreateResult =
  | { ok: true; linkUrl: string; id: string }
  | { ok: false; error: string };

type CashfreeLinkResponse = {
  cf_link_id?: number | string;
  link_id?: string;
  link_url?: string;
  link_status?: string;
  message?: string;
  code?: string;
};

/** Generic Payment Link create — shared by fee pay-links and registration. */
export async function createCashfreeLink(opts: {
  linkId: string;
  amountPaise: number;
  purpose: string;
  customerName: string;
  customerMobile: string;
  /** ISO date (YYYY-MM-DD); link expires end of that day IST. */
  expiresOn?: string;
  returnUrl: string;
  webhookUrl: string;
  notes?: Record<string, string>;
}): Promise<CashfreeCreateResult> {
  if (!cashfreeKeysPresent()) {
    return { ok: false, error: "Cashfree keys not configured" };
  }

  const contact = opts.customerMobile.replace(/\D/g, "").slice(-10);
  if (contact.length !== 10) {
    // Cashfree requires customer_phone — never invent one.
    return { ok: false, error: "Parent mobile required for Cashfree link" };
  }

  const body = {
    link_id: opts.linkId,
    link_amount: Number((opts.amountPaise / 100).toFixed(2)),
    link_currency: "INR",
    link_purpose: opts.purpose.slice(0, 500),
    customer_details: {
      customer_name: (opts.customerName || "Parent").slice(0, 120),
      customer_phone: contact,
    },
    ...(opts.expiresOn
      ? { link_expiry_time: `${opts.expiresOn}T23:59:59+05:30` }
      : {}),
    link_partial_payments: false,
    link_auto_reminders: false,
    link_notify: { send_sms: false, send_email: false },
    link_meta: {
      return_url: opts.returnUrl,
      notify_url: opts.webhookUrl,
      upi_intent: "true",
    },
    link_notes: opts.notes ?? {},
  };

  const res = await fetch(`${cashfreeBaseUrl()}/links`, {
    method: "POST",
    headers: cashfreeAuthHeaders(),
    body: JSON.stringify(body),
  });

  let data = (await res.json().catch(() => ({}))) as CashfreeLinkResponse;

  // link_id reuse (retry after a lost response) — fetch the existing link.
  if (res.status === 409) {
    const existing = await fetch(
      `${cashfreeBaseUrl()}/links/${encodeURIComponent(opts.linkId)}`,
      { headers: cashfreeAuthHeaders() },
    );
    data = (await existing.json().catch(() => ({}))) as CashfreeLinkResponse;
    if (!existing.ok || !data.link_url) {
      return { ok: false, error: "Cashfree link exists but could not be fetched" };
    }
    if (data.link_status && data.link_status !== "ACTIVE") {
      return {
        ok: false,
        error: `Existing Cashfree link is ${data.link_status}`,
      };
    }
    return {
      ok: true,
      linkUrl: data.link_url,
      id: String(data.link_id || opts.linkId),
    };
  }

  if (!res.ok || !data.link_url) {
    return {
      ok: false,
      error: data.message || `Cashfree HTTP ${res.status}`,
    };
  }

  return {
    ok: true,
    linkUrl: data.link_url,
    id: String(data.link_id || opts.linkId),
  };
}

export async function createCashfreePaymentLink(opts: {
  link: PaymentLink;
  customerName: string;
  customerMobile: string;
  callbackUrl: string;
  webhookUrl: string;
}): Promise<CashfreeCreateResult> {
  return createCashfreeLink({
    linkId: opts.link.id,
    amountPaise: opts.link.amountPaise,
    purpose: `School fees ${opts.link.code} — ${opts.link.studentName}`,
    customerName: opts.customerName,
    customerMobile: opts.customerMobile,
    expiresOn: opts.link.expiresOn,
    returnUrl: opts.callbackUrl,
    webhookUrl: opts.webhookUrl,
    notes: {
      linkId: opts.link.id,
      code: opts.link.code,
      householdId: opts.link.householdId,
    },
  });
}

/** Authoritative status check before/after settling (never trust payload alone). */
export async function fetchCashfreeLinkStatus(
  linkId: string,
): Promise<
  | { ok: true; status: string; amountPaidRupees: number }
  | { ok: false; error: string }
> {
  if (!cashfreeKeysPresent()) {
    return { ok: false, error: "Cashfree keys not configured" };
  }
  const res = await fetch(
    `${cashfreeBaseUrl()}/links/${encodeURIComponent(linkId)}`,
    { headers: cashfreeAuthHeaders() },
  );
  const data = (await res.json().catch(() => ({}))) as {
    link_status?: string;
    link_amount_paid?: number;
    message?: string;
  };
  if (!res.ok || !data.link_status) {
    return { ok: false, error: data.message || `Cashfree HTTP ${res.status}` };
  }
  return {
    ok: true,
    status: data.link_status,
    amountPaidRupees: Number(data.link_amount_paid) || 0,
  };
}

/** Attach Cashfree checkout to an existing school pay-link (mutates payments store). */
export async function attachCashfreeToPaymentLink(opts: {
  link: PaymentLink;
  customerName: string;
  customerMobile: string;
  appOrigin: string;
}): Promise<
  | { ok: true; link: PaymentLink; checkoutUrl: string }
  | { ok: false; error: string; link: PaymentLink }
> {
  if (!shouldUseCashfreeCheckout()) {
    return { ok: false, error: "Cashfree not enabled", link: opts.link };
  }

  const origin = opts.appOrigin.replace(/\/$/, "");
  const cf = await createCashfreePaymentLink({
    link: opts.link,
    customerName: opts.customerName,
    customerMobile: opts.customerMobile,
    callbackUrl: `${origin}/pay/share?linkId=${encodeURIComponent(opts.link.id)}&cf=1`,
    webhookUrl: `${origin}/api/payments/cashfree/webhook`,
  });

  if (!cf.ok) {
    return { ok: false, error: cf.error, link: opts.link };
  }

  const patched = patchPaymentLink(opts.link.id, {
    gatewayMode: "cashfree",
    gatewayCheckoutUrl: cf.linkUrl,
    gatewayExternalId: cf.id,
  });

  if (!patched) {
    return { ok: false, error: "Could not save Cashfree link", link: opts.link };
  }

  return { ok: true, link: patched, checkoutUrl: cf.linkUrl };
}
