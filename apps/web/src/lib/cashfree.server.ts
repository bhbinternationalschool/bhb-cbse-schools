import { buildCashfreeOrderBody, type CashfreeOrderInput } from "@/lib/cashfreeCheckout";
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
      upi_intent: true,
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

/**
 * Which Cashfree product carries a checkout. "orders" (default) is the
 * core Orders API + the school's hosted pay page; "links" is the Payment
 * Links API, which needs a separate account approval the school does not
 * have today. CASHFREE_CHECKOUT_MODE flips it back if that ever changes.
 */
export function cashfreeCheckoutMode(): "orders" | "links" {
  return (process.env.CASHFREE_CHECKOUT_MODE || "").trim().toLowerCase() === "links"
    ? "links"
    : "orders";
}

/** The mode string cashfree.js expects on the pay page. */
export function cashfreeSdkMode(): "sandbox" | "production" {
  return cashfreeBaseUrl().includes("sandbox") ? "sandbox" : "production";
}

export type CashfreeOrderResult =
  | { ok: true; orderId: string; cfOrderId: string; paymentSessionId: string; status: string }
  | { ok: false; error: string };

/**
 * POST /pg/orders. A reused order_id (retry after a lost response) is
 * resolved by fetching the existing order, the same way links were.
 */
export async function createCashfreeOrder(input: CashfreeOrderInput): Promise<CashfreeOrderResult> {
  if (!cashfreeKeysPresent()) return { ok: false, error: "Cashfree keys not configured" };
  const built = buildCashfreeOrderBody(input);
  if (!built.ok) return built;
  const res = await fetch(`${cashfreeBaseUrl()}/orders`, {
    method: "POST",
    headers: cashfreeAuthHeaders(),
    body: JSON.stringify(built.body),
  });
  let data = (await res.json().catch(() => ({}))) as {
    cf_order_id?: string | number;
    order_id?: string;
    order_status?: string;
    payment_session_id?: string;
    message?: string;
  };
  if (res.status === 409 || (!res.ok && /already exists/i.test(data.message || ""))) {
    const existing = await fetch(
      `${cashfreeBaseUrl()}/orders/${encodeURIComponent(input.orderId)}`,
      { headers: cashfreeAuthHeaders() },
    );
    data = (await existing.json().catch(() => ({}))) as typeof data;
    if (!existing.ok || !data.payment_session_id) {
      return { ok: false, error: "Cashfree order exists but could not be fetched" };
    }
    if (data.order_status && data.order_status !== "ACTIVE") {
      return { ok: false, error: `Existing Cashfree order is ${data.order_status}` };
    }
  } else if (!res.ok || !data.payment_session_id) {
    return { ok: false, error: data.message || `Cashfree HTTP ${res.status}` };
  }
  return {
    ok: true,
    orderId: String(data.order_id || input.orderId),
    cfOrderId: String(data.cf_order_id ?? ""),
    paymentSessionId: String(data.payment_session_id),
    status: String(data.order_status || "ACTIVE"),
  };
}

export type CashfreeStatusResult =
  | { ok: true; status: string; amountPaidRupees: number; source: "order" | "link" }
  | { ok: false; error: string };

/** GET /pg/orders/{order_id} — the authoritative order state. */
export async function fetchCashfreeOrderStatus(orderId: string): Promise<CashfreeStatusResult> {
  if (!cashfreeKeysPresent()) return { ok: false, error: "Cashfree keys not configured" };
  const res = await fetch(`${cashfreeBaseUrl()}/orders/${encodeURIComponent(orderId)}`, {
    headers: cashfreeAuthHeaders(),
  });
  const data = (await res.json().catch(() => ({}))) as {
    order_status?: string;
    order_amount?: number;
    message?: string;
  };
  if (!res.ok || !data.order_status) {
    return { ok: false, error: data.message || `Cashfree HTTP ${res.status}` };
  }
  return {
    ok: true,
    status: data.order_status,
    amountPaidRupees: data.order_status === "PAID" ? Number(data.order_amount) || 0 : 0,
    source: "order",
  };
}

/**
 * The successful payment on an order — its Cashfree payment id and bank
 * reference (UTR), for the receipt. Null when nothing has succeeded.
 */
export async function fetchCashfreeOrderPayment(
  orderId: string,
): Promise<{ cfPaymentId: string; bankReference: string } | null> {
  if (!cashfreeKeysPresent()) return null;
  const res = await fetch(
    `${cashfreeBaseUrl()}/orders/${encodeURIComponent(orderId)}/payments`,
    { headers: cashfreeAuthHeaders() },
  );
  const data = (await res.json().catch(() => [])) as {
    cf_payment_id?: string | number;
    payment_status?: string;
    bank_reference?: string;
  }[];
  if (!res.ok || !Array.isArray(data)) return null;
  const hit = data.find((p) => p.payment_status === "SUCCESS");
  return hit
    ? { cfPaymentId: String(hit.cf_payment_id ?? ""), bankReference: String(hit.bank_reference || "") }
    : null;
}

/**
 * Status of whatever carries this id — an order first, then a payment
 * link for records made before the switch to orders. PAID means the same
 * thing in both.
 */
export async function fetchCashfreePaymentStatus(id: string): Promise<CashfreeStatusResult> {
  const order = await fetchCashfreeOrderStatus(id);
  if (order.ok) return order;
  const link = await fetchCashfreeLinkStatus(id);
  return link.ok ? { ...link, source: "link" } : link;
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
  // Lazy import: cashfreeCheckouts.server imports this module.
  const { createCashfreeCheckout } = await import("@/lib/cashfreeCheckouts.server");
  const cf = await createCashfreeCheckout({
    kind: "fee_link",
    ref: opts.link.id,
    preferredId: opts.link.id,
    amountPaise: opts.link.amountPaise,
    purpose: `School fees ${opts.link.code} — ${opts.link.studentName}`,
    customerId: opts.link.householdId,
    customerName: opts.customerName,
    customerMobile: opts.customerMobile,
    expiresOn: opts.link.expiresOn,
    afterUrl: `${origin}/pay/share?linkId=${encodeURIComponent(opts.link.id)}&cf=1`,
    origin,
    notes: { linkId: opts.link.id, code: opts.link.code, householdId: opts.link.householdId },
  });

  if (!cf.ok) {
    return { ok: false, error: cf.error, link: opts.link };
  }

  const patched = patchPaymentLink(opts.link.id, {
    gatewayMode: "cashfree",
    gatewayCheckoutUrl: cf.checkoutUrl,
    gatewayExternalId: cf.externalId,
  });

  if (!patched) {
    return { ok: false, error: "Could not save Cashfree link", link: opts.link };
  }

  return { ok: true, link: patched, checkoutUrl: cf.checkoutUrl };
}
