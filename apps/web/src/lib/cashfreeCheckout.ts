/**
 * The pure half of Cashfree's Orders API checkout: the request body, the
 * ids, the webhook payload reader. No network, no env — testable.
 *
 * Why orders rather than payment links: links need a separate account
 * approval ("link_creation_api") that the school's account does not have;
 * orders are the core product and are enabled on every PG account. An
 * order gives back a payment_session_id, which the school's own pay page
 * hands to Cashfree's checkout script.
 */

export const CASHFREE_ORDER_ID_RE = /^[A-Za-z0-9_-]{3,50}$/;

export function isCashfreeOrderId(id: string): boolean {
  return CASHFREE_ORDER_ID_RE.test(id);
}

/** Cashfree wants a bare 10-digit Indian mobile; anything else is refused, never invented. */
export function cashfreeContact(mobile: string): string | null {
  const digits = (mobile || "").replace(/\D/g, "").slice(-10);
  return digits.length === 10 ? digits : null;
}

/** The customer_id Cashfree requires — an id of ours, made safe for their field. */
export function cashfreeCustomerId(raw: string): string {
  const cleaned = (raw || "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 50);
  return cleaned.length >= 3 ? cleaned : `cust_${cleaned}`.slice(0, 50);
}

export type CashfreeOrderInput = {
  orderId: string;
  amountPaise: number;
  customerId: string;
  customerName: string;
  customerMobile: string;
  note: string;
  returnUrl: string;
  notifyUrl: string;
  /** Stored on the order and echoed in webhooks. Strings only, ten at most. */
  tags: Record<string, string>;
  /** ISO timestamp; must be 16 minutes to 30 days out. Omitted = Cashfree's default. */
  expiresAt?: string;
};

export type CashfreeOrderBody = {
  order_id: string;
  order_amount: number;
  order_currency: "INR";
  customer_details: { customer_id: string; customer_name: string; customer_phone: string };
  order_meta: { return_url: string; notify_url: string };
  order_note: string;
  order_tags: Record<string, string>;
  order_expiry_time?: string;
};

export function buildCashfreeOrderBody(
  input: CashfreeOrderInput,
  now = new Date(),
): { ok: true; body: CashfreeOrderBody } | { ok: false; error: string } {
  if (!isCashfreeOrderId(input.orderId)) {
    return { ok: false, error: `Order id "${input.orderId}" is not valid for Cashfree` };
  }
  if (!Number.isInteger(input.amountPaise) || input.amountPaise < 100) {
    return { ok: false, error: "Amount must be at least ₹1" };
  }
  const phone = cashfreeContact(input.customerMobile);
  if (!phone) return { ok: false, error: "Parent mobile required for Cashfree checkout" };
  if (!/^https:\/\//.test(input.returnUrl) || !/^https:\/\//.test(input.notifyUrl)) {
    return { ok: false, error: "Cashfree needs https return and notify URLs" };
  }
  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.tags).slice(0, 10)) {
    if (v !== undefined && v !== null && String(v) !== "") tags[k] = String(v).slice(0, 250);
  }
  const body: CashfreeOrderBody = {
    order_id: input.orderId,
    order_amount: Number((input.amountPaise / 100).toFixed(2)),
    order_currency: "INR",
    customer_details: {
      customer_id: cashfreeCustomerId(input.customerId),
      customer_name: (input.customerName || "Parent").slice(0, 120),
      customer_phone: phone,
    },
    order_meta: { return_url: input.returnUrl, notify_url: input.notifyUrl },
    order_note: (input.note || "").slice(0, 200),
    order_tags: tags,
  };
  if (input.expiresAt) {
    const t = new Date(input.expiresAt).getTime();
    const min = now.getTime() + 16 * 60_000;
    const max = now.getTime() + 30 * 86_400_000;
    // Cashfree rejects anything under 15 minutes or over 30 days; clamp
    // rather than fail, since the school's own expiry is enforced by us.
    const clamped = Math.min(Math.max(Number.isFinite(t) ? t : min, min), max);
    body.order_expiry_time = new Date(clamped).toISOString();
  }
  return { ok: true, body };
}

/** The school's own pay page for an order — what the app and WhatsApp open. */
export function cashfreePayPageUrl(origin: string, orderId: string): string {
  return `${origin.replace(/\/$/, "")}/pay/cf/${encodeURIComponent(orderId)}`;
}

export type CashfreeOrderEvent = {
  type: string;
  orderId: string;
  cfPaymentId: string;
  paymentStatus: string;
  bankReference: string;
  amountRupees: number | null;
  tags: Record<string, string>;
};

/**
 * Read the fields we act on from an order-level webhook
 * (PAYMENT_SUCCESS_WEBHOOK / PAYMENT_FAILED_WEBHOOK / PAYMENT_USER_DROPPED_WEBHOOK).
 * Null when the payload is not an order event.
 */
export function readCashfreeOrderEvent(event: Record<string, unknown>): CashfreeOrderEvent | null {
  const data = (event.data || {}) as Record<string, unknown>;
  const order = (data.order || {}) as Record<string, unknown>;
  const payment = (data.payment || {}) as Record<string, unknown>;
  const orderId = String(order.order_id || "");
  if (!orderId) return null;
  const rawTags = (order.order_tags || {}) as Record<string, unknown>;
  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawTags)) if (v != null) tags[k] = String(v);
  const amt = Number(payment.payment_amount ?? order.order_amount);
  return {
    type: String(event.type || ""),
    orderId,
    cfPaymentId: payment.cf_payment_id != null ? String(payment.cf_payment_id) : "",
    paymentStatus: String(payment.payment_status || ""),
    bankReference: String(payment.bank_reference || ""),
    amountRupees: Number.isFinite(amt) ? amt : null,
    tags,
  };
}
