/**
 * Cashfree payment webhook — verifies signature and settles open pay-links.
 * We create links with link_id = our PaymentLink id and stamp link_notes
 * {linkId, code}, so PAYMENT_LINK_EVENT carries both references back.
 *
 * Signature: x-webhook-signature = base64(HMAC-SHA256(timestamp + rawBody,
 * CASHFREE_SECRET_KEY)) — the API secret, no separate webhook secret.
 *
 * Also handles SETTLEMENT_* — the gateway telling us it has paid money into
 * the school's bank. That is a different event about the same rupees: the link
 * event says a parent paid, the settlement event says the money arrived, net
 * of fees, a cycle later. See lib/ledger/pgSettlement.server.ts.
 *
 * Env: CASHFREE_APP_ID, CASHFREE_SECRET_KEY, CASHFREE_ENV
 */

import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import {
  getPaymentLink,
  getPaymentLinkByCode,
  loadPayments,
} from "@/lib/payments";
import { cashfreeKeysPresent, fetchCashfreePaymentStatus } from "@/lib/cashfree.server";
import { readCashfreeOrderEvent } from "@/lib/cashfreeCheckout";
import { getCashfreeCheckout, settleCashfreeCheckout } from "@/lib/cashfreeCheckouts.server";
import {
  captureRegistrationPayment,
  loadAdmissions,
  saveAdmissions,
} from "@/lib/admissions";
import { settlePaymentLinkWithWhatsApp } from "@/lib/paymentSettlement.server";
import { ensureSchoolMirrorLoaded } from "@/lib/schoolDataMirror.server";
import { recordPaymentGatewayEvent } from "@/lib/paymentsNormalized.server";
import { ingestSettlementWebhook } from "@/lib/ledger/pgSettlement.server";
import { activateTutorPassOrder } from "@/lib/tutorPasses.server";

export const runtime = "nodejs";

function verifyCashfreeSignature(
  rawBody: string,
  timestamp: string,
  signature: string,
  secret: string,
): boolean {
  const expected = createHmac("sha256", secret)
    .update(timestamp + rawBody)
    .digest("base64");
  try {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(signature, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function extractLinkRef(payload: Record<string, unknown>): {
  linkId?: string;
  code?: string;
  paymentId?: string;
  linkStatus?: string;
  registrationPaymentId?: string;
  eventParticipantId?: string;
  tutorOrderId?: string;
} {
  const data = (payload.data || {}) as Record<string, unknown>;

  // PAYMENT_LINK_EVENT — link fields are FLAT under data (no data.link wrapper).
  if (data.link_id || data.link_status) {
    const notes = (data.link_notes || {}) as Record<string, string>;
    const order = (data.order || {}) as Record<string, unknown>;
    return {
      linkId: notes.linkId || notes.link_id || String(data.link_id || ""),
      code: notes.code || notes.pay_link_code,
      paymentId: String(order.transaction_id || data.cf_link_id || ""),
      linkStatus: String(data.link_status || ""),
      registrationPaymentId:
        notes.kind === "registration"
          ? notes.registrationPaymentId || String(data.link_id || "")
          : undefined,
      eventParticipantId:
        notes.kind === "event_fee"
          ? notes.participantId ||
            String(data.link_id || "").replace(/^evtp_/, "")
          : undefined,
      tutorOrderId:
        notes.kind === "tutor_pass"
          ? notes.orderId || String(data.link_id || "")
          : undefined,
    };
  }

  // Order-level events (PAYMENT_SUCCESS_WEBHOOK etc.) — link ref via order_tags.
  const order = (data.order || {}) as Record<string, unknown>;
  const payment = (data.payment || {}) as Record<string, unknown>;
  const tags = (order.order_tags || {}) as Record<string, string>;
  return {
    linkId: tags.linkId || tags.link_id,
    code: tags.code,
    paymentId: String(payment.cf_payment_id || order.order_id || ""),
  };
}

async function settleRegistrationPayment(opts: {
  registrationPaymentId: string;
  eventType: string;
  paymentId: string;
  event: Record<string, unknown>;
}) {
  const { registrationPaymentId, eventType, paymentId, event } = opts;
  const state = loadAdmissions();
  const payment = (state.registrationPayments || []).find(
    (p) => p.id === registrationPaymentId,
  );

  if (!payment) {
    await recordPaymentGatewayEvent({
      provider: "cashfree",
      eventType,
      externalPaymentId: paymentId,
      settlementStatus: "failed",
      eventJson: { error: "No matching registration payment", raw: event },
    });
    return NextResponse.json(
      { ok: false, error: "No matching registration payment" },
      { status: 404 },
    );
  }
  if (payment.status === "paid") {
    await recordPaymentGatewayEvent({
      provider: "cashfree",
      eventType: "registration.already_paid",
      externalPaymentId: paymentId,
      amountPaise: payment.amountPaise,
      settlementStatus: "ignored",
      eventJson: event,
    });
    return NextResponse.json({ ok: true, alreadyPaid: true, code: payment.code });
  }

  // Authoritative re-verify — never fulfil on the webhook payload alone.
  const live = await fetchCashfreePaymentStatus(payment.id);
  if (!live.ok || live.status !== "PAID") {
    await recordPaymentGatewayEvent({
      provider: "cashfree",
      eventType: "registration.verification_mismatch",
      externalPaymentId: paymentId,
      amountPaise: payment.amountPaise,
      settlementStatus: "failed",
      eventJson: {
        error: live.ok ? `Link status is ${live.status}` : live.error,
        raw: event,
      },
    });
    return NextResponse.json(
      { error: "Cashfree link not verifiably PAID" },
      { status: 400 },
    );
  }

  const captured = captureRegistrationPayment(
    state,
    payment.id,
    paymentId || `CF-${payment.code}`,
    // Gateway money: it waits in clearing until the settlement moves it.
    "cashfree",
  );
  if (!captured.ok) {
    await recordPaymentGatewayEvent({
      provider: "cashfree",
      eventType: "registration.settlement_failed",
      externalPaymentId: paymentId,
      amountPaise: payment.amountPaise,
      settlementStatus: "failed",
      eventJson: { error: captured.reason, raw: event },
    });
    return NextResponse.json({ error: captured.reason }, { status: 400 });
  }
  saveAdmissions(captured.state);

  await recordPaymentGatewayEvent({
    provider: "cashfree",
    eventType: "registration.settled",
    externalPaymentId: paymentId,
    amountPaise: payment.amountPaise,
    settlementStatus: "settled",
    receiptNo: payment.code,
    eventJson: event,
  });
  return NextResponse.json({ ok: true, code: payment.code });
}

export async function GET() {
  const configured = cashfreeKeysPresent();
  return NextResponse.json({
    service: "cashfree-webhook",
    configured,
    note: configured
      ? "POST PAYMENT_SUCCESS_WEBHOOK (orders) / PAYMENT_LINK_EVENT / SETTLEMENT_* (version 2025-01-01) here"
      : "Set CASHFREE_APP_ID, CASHFREE_SECRET_KEY (CASHFREE_ENV=sandbox|production)",
  });
}

export async function POST(req: Request) {
  const secret = process.env.CASHFREE_SECRET_KEY?.trim() || "";
  if (!secret) {
    return NextResponse.json(
      { error: "CASHFREE_SECRET_KEY not configured" },
      { status: 503 },
    );
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-webhook-signature") || "";
  const timestamp = req.headers.get("x-webhook-timestamp") || "";
  if (
    !timestamp ||
    !verifyCashfreeSignature(rawBody, timestamp, signature, secret)
  ) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = String(event.type || "");

  // Settlement events carry no link reference — they are about a bank
  // transfer, not a payment — so they are handled before any link lookup.
  if (eventType.startsWith("SETTLEMENT_")) {
    const data = (event.data ?? {}) as Record<string, unknown>;
    const res = await ingestSettlementWebhook(data);
    await recordPaymentGatewayEvent({
      provider: "cashfree",
      eventType,
      externalPaymentId: "",
      settlementStatus: res.ok ? "settled" : "failed",
      eventJson: res.ok ? event : { error: res.error, raw: event },
    });
    // Always 200 on a stored-but-unposted settlement: the nightly sweep will
    // post it, and a non-2xx would have the gateway redeliver an event that
    // was received correctly.
    return res.ok
      ? NextResponse.json({ ok: true, settlement: true, posted: !!res.posted })
      : NextResponse.json({ ok: false, error: res.error }, { status: 400 });
  }

  // Orders API events (the default checkout since 2026-09-05). A success is
  // re-verified and settled by kind; failures and drop-offs are recorded.
  const orderEvent = readCashfreeOrderEvent(event);
  if (orderEvent && (await getCashfreeCheckout(orderEvent.orderId))) {
    if (orderEvent.type !== "PAYMENT_SUCCESS_WEBHOOK") {
      await recordPaymentGatewayEvent({
        provider: "cashfree",
        eventType: orderEvent.type || "unknown",
        externalOrderId: orderEvent.orderId,
        externalPaymentId: orderEvent.cfPaymentId,
        settlementStatus: "ignored",
        eventJson: event,
      });
      return NextResponse.json({ ok: true, ignored: orderEvent.type });
    }
    const res = await settleCashfreeCheckout({
      orderId: orderEvent.orderId,
      paymentRef: orderEvent.bankReference || orderEvent.cfPaymentId,
      source: "webhook",
      event,
    });
    return res.ok
      ? NextResponse.json({ ok: true, kind: res.kind, alreadyPaid: res.alreadyPaid, receiptNo: res.receiptNo, endsAt: res.endsAt })
      : NextResponse.json({ error: res.error, kind: res.kind }, { status: 400 });
  }

  const {
    linkId,
    code,
    paymentId,
    linkStatus,
    registrationPaymentId,
    eventParticipantId,
    tutorOrderId,
  } = extractLinkRef(event);

  // Settlement fires only on the link reaching PAID. Order-level success
  // webhooks for the same payment are recorded and left to the link event;
  // failed / dropped / expired / cancelled are recorded for the ledger.
  const isLinkPaid =
    eventType === "PAYMENT_LINK_EVENT" && linkStatus === "PAID";
  if (!isLinkPaid) {
    await recordPaymentGatewayEvent({
      provider: "cashfree",
      eventType: eventType || "unknown",
      externalPaymentId: paymentId || "",
      settlementStatus: "ignored",
      eventJson: event,
    });
    return NextResponse.json({ ok: true, ignored: eventType || linkStatus });
  }

  await ensureSchoolMirrorLoaded();

  // AI tutor passes: re-verify the link with the gateway, then activate.
  // The pass is time, not money in the fee ledger — the settlement sweep
  // books the amount like any other gateway receipt.
  if (tutorOrderId) {
    const live = await fetchCashfreePaymentStatus(tutorOrderId);
    const verified = live.ok && live.status === "PAID";
    const res = verified
      ? await activateTutorPassOrder({ id: tutorOrderId, paymentRef: paymentId || "" })
      : { ok: false as const, error: live.ok ? `Link status is ${live.status}` : live.error };
    await recordPaymentGatewayEvent({
      provider: "cashfree",
      eventType: res.ok
        ? res.alreadyPaid
          ? "tutor_pass.already_active"
          : "tutor_pass.activated"
        : "tutor_pass.failed",
      externalPaymentId: paymentId || "",
      settlementStatus: res.ok ? (res.alreadyPaid ? "ignored" : "settled") : "failed",
      eventJson: res.ok ? event : { error: res.error, raw: event },
    });
    return res.ok
      ? NextResponse.json({ ok: true, tutorOrderId, endsAt: res.endsAt })
      : NextResponse.json({ error: res.error }, { status: 400 });
  }

  // Inter-school event entry fees settle onto the participant row.
  if (eventParticipantId) {
    const { settleEventFee } = await import("@/lib/events/interschool.server");
    const res = await settleEventFee({
      participantId: eventParticipantId,
      paymentRef: paymentId || "",
    });
    await recordPaymentGatewayEvent({
      provider: "cashfree",
      eventType: res.ok ? "event_fee.settled" : "event_fee.failed",
      externalPaymentId: paymentId || "",
      settlementStatus: res.ok ? "settled" : "failed",
      eventJson: res.ok ? event : { error: res.error, raw: event },
    });
    return res.ok
      ? NextResponse.json({ ok: true, eventParticipantId })
      : NextResponse.json({ error: res.error }, { status: 400 });
  }

  // Registration-fee links (admissions CRM) settle into AdmissionsState,
  // not the fee pay-link store.
  if (registrationPaymentId) {
    return settleRegistrationPayment({
      registrationPaymentId,
      eventType,
      paymentId: paymentId || "",
      event,
    });
  }

  const state = loadPayments();
  const link =
    (linkId && getPaymentLink(linkId, state)) ||
    (code && getPaymentLinkByCode(code, state)) ||
    null;

  if (!link) {
    await recordPaymentGatewayEvent({
      provider: "cashfree",
      eventType,
      externalPaymentId: paymentId || "",
      settlementStatus: "failed",
      eventJson: event,
    });
    return NextResponse.json(
      {
        ok: false,
        error: "No matching pay-link (link_notes.linkId or link_id)",
        linkId,
        code,
      },
      { status: 404 },
    );
  }

  await recordPaymentGatewayEvent({
    paymentLinkId: link.id,
    provider: "cashfree",
    eventType,
    externalPaymentId: paymentId || "",
    amountPaise: link.amountPaise,
    settlementStatus: "received",
    eventJson: event,
  });

  if (link.status === "paid") {
    await recordPaymentGatewayEvent({
      paymentLinkId: link.id,
      provider: "cashfree",
      eventType: "payment.already_paid",
      externalPaymentId: paymentId || "",
      amountPaise: link.amountPaise,
      settlementStatus: "ignored",
      voucherId: link.voucherId,
      receiptNo: link.receiptNo,
      eventJson: event,
    });
    return NextResponse.json({
      ok: true,
      alreadyPaid: true,
      receiptNo: link.receiptNo,
    });
  }

  // Authoritative re-verify — never fulfil on the webhook payload alone.
  const live = await fetchCashfreePaymentStatus(link.id);
  if (!live.ok || live.status !== "PAID") {
    await recordPaymentGatewayEvent({
      paymentLinkId: link.id,
      provider: "cashfree",
      eventType: "verification.mismatch",
      externalPaymentId: paymentId || "",
      amountPaise: link.amountPaise,
      settlementStatus: "failed",
      eventJson: {
        error: live.ok ? `Link status is ${live.status}` : live.error,
        raw: event,
      },
    });
    return NextResponse.json(
      { error: "Cashfree link not verifiably PAID" },
      { status: 400 },
    );
  }

  const result = await settlePaymentLinkWithWhatsApp({
    linkId: link.id,
    cashierName: "Cashfree webhook",
    upiRef: paymentId || `CF_${Date.now().toString(36).toUpperCase()}`,
    sendWhatsApp: true,
  });

  if (!result.ok) {
    await recordPaymentGatewayEvent({
      paymentLinkId: link.id,
      provider: "cashfree",
      eventType: "settlement.failed",
      externalPaymentId: paymentId || "",
      amountPaise: link.amountPaise,
      settlementStatus: "failed",
      eventJson: { error: result.error, raw: event },
    });
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  await recordPaymentGatewayEvent({
    paymentLinkId: result.link.id,
    provider: "cashfree",
    eventType: "payment.settled",
    externalPaymentId: paymentId || "",
    amountPaise: result.link.amountPaise,
    settlementStatus: "settled",
    voucherId: result.voucherId,
    receiptNo: result.receiptNo,
    eventJson: event,
  });

  return NextResponse.json({
    ok: true,
    receiptNo: result.receiptNo,
    voucherId: result.voucherId,
    linkId: result.link.id,
    whatsappReceipt: result.whatsappReceipt,
  });
}
