/**
 * One Cashfree checkout flow for everything the school collects online —
 * fee pay-links, registration fees, event entries, tutor passes.
 *
 * Creating: an order on Cashfree (or a payment link when
 * CASHFREE_CHECKOUT_MODE=links), a row in cashfree_checkouts that ties the
 * order to what it pays for, and the school's own pay page URL for the
 * parent to open.
 *
 * Settling: both the webhook and the return page call settleCashfreeCheckout,
 * which re-verifies with Cashfree (never the payload alone) and then hands
 * off to the module that owns the thing paid for. Each of those is
 * idempotent, so webhook + return page racing each other is harmless.
 */
import "server-only";
import { createHash } from "node:crypto";
import {
  captureRegistrationPayment,
  loadAdmissions,
  saveAdmissions,
} from "@/lib/admissions";
import {
  cashfreeCheckoutMode,
  createCashfreeLink,
  createCashfreeOrder,
  fetchCashfreeOrderPayment,
  fetchCashfreePaymentStatus,
} from "@/lib/cashfree.server";
import { cashfreePayPageUrl, isCashfreeOrderId } from "@/lib/cashfreeCheckout";
import { getPaymentLink, loadPayments } from "@/lib/payments";
import { settlePaymentLinkWithWhatsApp } from "@/lib/paymentSettlement.server";
import { recordPaymentGatewayEvent } from "@/lib/paymentsNormalized.server";
import { ensureSchoolMirrorLoaded } from "@/lib/schoolDataMirror.server";
import { getServerTenantContext } from "@/lib/serverTenant";

export type CheckoutKind = "fee_link" | "registration" | "event_fee" | "tutor_pass";

export type CashfreeCheckoutRow = {
  orderId: string;
  kind: CheckoutKind;
  ref: string;
  amountPaise: number;
  paymentSessionId: string;
  cfOrderId: string;
  afterUrl: string;
  status: "active" | "paid" | "expired" | "failed";
  paymentRef: string;
  paidAt: string | null;
};

function rowToCheckout(r: Record<string, unknown>): CashfreeCheckoutRow {
  return {
    orderId: String(r.order_id),
    kind: String(r.kind) as CheckoutKind,
    ref: String(r.ref),
    amountPaise: Number(r.amount_paise),
    paymentSessionId: String(r.payment_session_id ?? ""),
    cfOrderId: String(r.cf_order_id ?? ""),
    afterUrl: String(r.after_url ?? ""),
    status: String(r.status) as CashfreeCheckoutRow["status"],
    paymentRef: String(r.payment_ref ?? ""),
    paidAt: r.paid_at ? String(r.paid_at) : null,
  };
}

export async function getCashfreeCheckout(orderId: string): Promise<CashfreeCheckoutRow | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data } = await ctx.sb
    .from("cashfree_checkouts")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("order_id", orderId)
    .maybeSingle();
  return data ? rowToCheckout(data as Record<string, unknown>) : null;
}

/** An order id Cashfree accepts, derived from ours when ours would not be. */
function orderIdFor(preferred: string): string {
  if (isCashfreeOrderId(preferred)) return preferred;
  return `co_${createHash("sha1").update(preferred).digest("hex").slice(0, 24)}`;
}

export type CreateCheckoutInput = {
  kind: CheckoutKind;
  /** What the money is for — the pay-link id, registration payment id, participant id, tutor order id. */
  ref: string;
  /** Used as the Cashfree order id when it is valid for one. */
  preferredId: string;
  amountPaise: number;
  purpose: string;
  customerId: string;
  customerName: string;
  customerMobile: string;
  /** YYYY-MM-DD; the order expires end of that day IST. */
  expiresOn?: string;
  /** Where the parent lands after the pay page has confirmed payment. */
  afterUrl: string;
  origin: string;
  notes: Record<string, string>;
};

export type CreateCheckoutResult =
  | { ok: true; orderId: string; checkoutUrl: string; externalId: string; mode: "orders" | "links" }
  | { ok: false; error: string };

export async function createCashfreeCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
  const origin = input.origin.replace(/\/$/, "");
  const webhookUrl = `${origin}/api/payments/cashfree/webhook`;

  if (cashfreeCheckoutMode() === "links") {
    const link = await createCashfreeLink({
      linkId: input.preferredId,
      amountPaise: input.amountPaise,
      purpose: input.purpose,
      customerName: input.customerName,
      customerMobile: input.customerMobile,
      expiresOn: input.expiresOn,
      returnUrl: input.afterUrl,
      webhookUrl,
      notes: { kind: input.kind, ...input.notes },
    });
    return link.ok
      ? { ok: true, orderId: link.id, checkoutUrl: link.linkUrl, externalId: link.id, mode: "links" }
      : link;
  }

  const orderId = orderIdFor(input.preferredId);
  const order = await createCashfreeOrder({
    orderId,
    amountPaise: input.amountPaise,
    customerId: input.customerId,
    customerName: input.customerName,
    customerMobile: input.customerMobile,
    note: input.purpose,
    returnUrl: cashfreePayPageUrl(origin, orderId),
    notifyUrl: webhookUrl,
    tags: { kind: input.kind, ref: input.ref, ...input.notes },
    expiresAt: input.expiresOn ? `${input.expiresOn}T23:59:59+05:30` : undefined,
  });
  if (!order.ok) return order;

  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "No tenant context" };
  const { error } = await ctx.sb.from("cashfree_checkouts").upsert(
    {
      order_id: orderId,
      tenant_id: ctx.tenantId,
      kind: input.kind,
      ref: input.ref,
      amount_paise: input.amountPaise,
      customer_phone: input.customerMobile.replace(/\D/g, "").slice(-10),
      payment_session_id: order.paymentSessionId,
      cf_order_id: order.cfOrderId,
      after_url: input.afterUrl,
    },
    { onConflict: "order_id" },
  );
  if (error) return { ok: false, error: `Could not record checkout: ${error.message}` };

  return {
    ok: true,
    orderId,
    checkoutUrl: cashfreePayPageUrl(origin, orderId),
    externalId: order.cfOrderId || orderId,
    mode: "orders",
  };
}

async function markCheckoutPaid(orderId: string, paymentRef: string): Promise<void> {
  const ctx = await getServerTenantContext();
  if (!ctx) return;
  await ctx.sb
    .from("cashfree_checkouts")
    .update({ status: "paid", payment_ref: paymentRef, paid_at: new Date().toISOString() })
    .eq("tenant_id", ctx.tenantId)
    .eq("order_id", orderId)
    .neq("status", "paid");
}

export type SettleResult =
  | { ok: true; alreadyPaid: boolean; kind: CheckoutKind; ref: string; receiptNo?: string; endsAt?: string }
  | { ok: false; error: string; kind?: CheckoutKind; ref?: string };

/**
 * A payment for this order is reported — by the webhook or by the parent
 * arriving back on the pay page. Verify with Cashfree, then fulfil.
 */
export async function settleCashfreeCheckout(opts: {
  orderId: string;
  /** Cashfree payment id if the caller has it; otherwise looked up. */
  paymentRef?: string;
  source: "webhook" | "return";
  event?: Record<string, unknown>;
}): Promise<SettleResult> {
  const row = await getCashfreeCheckout(opts.orderId);
  if (!row) return { ok: false, error: "No matching checkout for this order" };

  const live = await fetchCashfreePaymentStatus(opts.orderId);
  if (!live.ok || live.status !== "PAID") {
    await recordPaymentGatewayEvent({
      provider: "cashfree",
      eventType: `${row.kind}.verification_mismatch`,
      externalOrderId: opts.orderId,
      externalPaymentId: opts.paymentRef || "",
      amountPaise: row.amountPaise,
      settlementStatus: "failed",
      eventJson: { error: live.ok ? `Order status is ${live.status}` : live.error, source: opts.source, raw: opts.event },
    });
    return { ok: false, error: live.ok ? `Cashfree order is ${live.status}, not PAID` : live.error, kind: row.kind, ref: row.ref };
  }

  let paymentRef = opts.paymentRef || row.paymentRef;
  if (!paymentRef) {
    const p = await fetchCashfreeOrderPayment(opts.orderId);
    paymentRef = p?.bankReference || p?.cfPaymentId || `CF_${opts.orderId}`;
  }

  await ensureSchoolMirrorLoaded();
  let result: SettleResult;
  switch (row.kind) {
    case "fee_link": {
      const link = getPaymentLink(row.ref, loadPayments());
      if (!link) {
        result = { ok: false, error: "Pay-link not found", kind: row.kind, ref: row.ref };
        break;
      }
      if (link.status === "paid") {
        result = { ok: true, alreadyPaid: true, kind: row.kind, ref: row.ref, receiptNo: link.receiptNo ?? undefined };
        break;
      }
      const r = await settlePaymentLinkWithWhatsApp({
        linkId: link.id,
        cashierName: opts.source === "webhook" ? "Cashfree webhook" : "Cashfree return",
        upiRef: paymentRef,
        sendWhatsApp: true,
      });
      result = r.ok
        ? { ok: true, alreadyPaid: false, kind: row.kind, ref: row.ref, receiptNo: r.receiptNo }
        : { ok: false, error: r.error, kind: row.kind, ref: row.ref };
      break;
    }
    case "registration": {
      const state = loadAdmissions();
      const payment = (state.registrationPayments || []).find((p) => p.id === row.ref);
      if (!payment) {
        result = { ok: false, error: "No matching registration payment", kind: row.kind, ref: row.ref };
        break;
      }
      if (payment.status === "paid") {
        result = { ok: true, alreadyPaid: true, kind: row.kind, ref: row.ref, receiptNo: payment.code };
        break;
      }
      // Gateway money: it waits in clearing until the settlement moves it.
      const captured = captureRegistrationPayment(state, payment.id, paymentRef, "cashfree");
      if (!captured.ok) {
        result = { ok: false, error: captured.reason, kind: row.kind, ref: row.ref };
        break;
      }
      saveAdmissions(captured.state);
      result = { ok: true, alreadyPaid: false, kind: row.kind, ref: row.ref, receiptNo: payment.code };
      break;
    }
    case "event_fee": {
      const { settleEventFee } = await import("@/lib/events/interschool.server");
      const r = await settleEventFee({ participantId: row.ref, paymentRef, orderId: opts.orderId });
      result = r.ok
        ? { ok: true, alreadyPaid: !!r.alreadyPaid, kind: row.kind, ref: row.ref }
        : { ok: false, error: r.error || "Event fee settle failed", kind: row.kind, ref: row.ref };
      break;
    }
    case "tutor_pass": {
      const { activateTutorPassOrder } = await import("@/lib/tutorPasses.server");
      const r = await activateTutorPassOrder({ id: row.ref, paymentRef });
      result = r.ok
        ? { ok: true, alreadyPaid: r.alreadyPaid, kind: row.kind, ref: row.ref, endsAt: r.endsAt }
        : { ok: false, error: r.error, kind: row.kind, ref: row.ref };
      break;
    }
  }

  if (result.ok) await markCheckoutPaid(opts.orderId, paymentRef);
  await recordPaymentGatewayEvent({
    paymentLinkId: row.kind === "fee_link" ? row.ref : null,
    provider: "cashfree",
    eventType: result.ok
      ? result.alreadyPaid
        ? `${row.kind}.already_paid`
        : `${row.kind}.settled`
      : `${row.kind}.settlement_failed`,
    externalOrderId: opts.orderId,
    externalPaymentId: paymentRef,
    amountPaise: row.amountPaise,
    settlementStatus: result.ok ? (result.alreadyPaid ? "ignored" : "settled") : "failed",
    receiptNo: result.ok ? result.receiptNo ?? null : null,
    eventJson: result.ok ? { source: opts.source, raw: opts.event } : { error: result.error, source: opts.source, raw: opts.event },
  });
  return result;
}
