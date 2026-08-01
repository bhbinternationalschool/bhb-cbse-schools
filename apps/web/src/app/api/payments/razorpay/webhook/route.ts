/**
 * Razorpay payment webhook — verifies signature and settles open pay-links.
 * Notes / notes[linkId] or notes[pay_link_code] must carry our PaymentLink id or code.
 *
 * Env: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET
 */

import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import {
  getPaymentLink,
  getPaymentLinkByCode,
  loadPayments,
} from "@/lib/payments";
import { settlePaymentLinkWithWhatsApp } from "@/lib/paymentSettlement.server";
import { ensureSchoolMirrorLoaded } from "@/lib/schoolDataMirror.server";

export const runtime = "nodejs";

function verifyRazorpaySignature(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
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
} {
  const inner = (payload.payload || {}) as Record<string, unknown>;

  const paymentLink = (
    inner.payment_link as { entity?: Record<string, unknown> } | undefined
  )?.entity;
  if (paymentLink) {
    const notes = (paymentLink.notes || {}) as Record<string, string>;
    const payment = (
      inner.payment as { entity?: Record<string, unknown> } | undefined
    )?.entity;
    return {
      linkId: notes.linkId || notes.link_id,
      code: notes.code || notes.pay_link_code || notes.payment_link_code,
      paymentId: String(
        payment?.id || paymentLink.id || paymentLink.order_id || "",
      ),
    };
  }

  const payment =
    (inner.payment as { entity?: Record<string, unknown> } | undefined)
      ?.entity ||
    (inner.order as { entity?: Record<string, unknown> } | undefined)?.entity ||
    {};
  const notes = (payment.notes || {}) as Record<string, string>;
  const linkId = notes.linkId || notes.link_id || notes.payment_link_id;
  const code = notes.code || notes.pay_link_code || notes.payment_link_code;
  const paymentId = String(payment.id || payment.order_id || "");
  return { linkId, code, paymentId };
}

export async function GET() {
  const configured = !!(
    process.env.RAZORPAY_KEY_ID &&
    process.env.RAZORPAY_KEY_SECRET &&
    process.env.RAZORPAY_WEBHOOK_SECRET
  );
  return NextResponse.json({
    service: "razorpay-webhook",
    configured,
    note: configured
      ? "POST payment.captured / payment_link.paid events here"
      : "Set RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET",
  });
}

export async function POST(req: Request) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || "";
  if (!secret) {
    return NextResponse.json(
      { error: "RAZORPAY_WEBHOOK_SECRET not configured" },
      { status: 503 },
    );
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-razorpay-signature") || "";
  if (!verifyRazorpaySignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventName = String(event.event || "");
  if (
    eventName &&
    !/payment\.(captured|authorized)|order\.paid|payment_link\.paid/i.test(
      eventName,
    )
  ) {
    return NextResponse.json({ ok: true, ignored: eventName });
  }

  await ensureSchoolMirrorLoaded();
  const { linkId, code, paymentId } = extractLinkRef(event);
  const state = loadPayments();
  const link =
    (linkId && getPaymentLink(linkId, state)) ||
    (code && getPaymentLinkByCode(code, state)) ||
    null;

  if (!link) {
    return NextResponse.json(
      {
        ok: false,
        error: "No matching pay-link (pass notes.linkId or notes.code)",
        linkId,
        code,
      },
      { status: 404 },
    );
  }

  if (link.status === "paid") {
    return NextResponse.json({
      ok: true,
      alreadyPaid: true,
      receiptNo: link.receiptNo,
    });
  }

  const result = await settlePaymentLinkWithWhatsApp({
    linkId: link.id,
    cashierName: "Razorpay webhook",
    upiRef: paymentId || `RZ_${Date.now().toString(36).toUpperCase()}`,
    sendWhatsApp: true,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    receiptNo: result.receiptNo,
    voucherId: result.voucherId,
    linkId: result.link.id,
    whatsappReceipt: result.whatsappReceipt,
  });
}
