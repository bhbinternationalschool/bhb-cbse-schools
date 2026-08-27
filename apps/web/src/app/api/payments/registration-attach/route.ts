/**
 * Attach a Cashfree checkout to an admissions registration-fee payment.
 * The webhook settles it via link_notes {kind: "registration"} — see
 * /api/payments/cashfree/webhook. Razorpay was never wired for
 * registration, so this is Cashfree-only by design.
 */

import { NextResponse } from "next/server";
import {
  loadAdmissions,
  registrationPayAbsoluteUrl,
} from "@/lib/admissions";
import {
  createCashfreeLink,
  shouldUseCashfreeCheckout,
} from "@/lib/cashfree.server";
import { publicAppOrigin } from "@/lib/waSisBotServer";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { ensureSchoolMirrorLoaded } from "@/lib/schoolDataMirror.server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "admissions", "edit");
  if (!auth.ok) return auth.response;

  let body: { paymentId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.paymentId) {
    return NextResponse.json({ error: "paymentId required" }, { status: 400 });
  }
  if (!shouldUseCashfreeCheckout()) {
    return NextResponse.json(
      { ok: false, error: "Cashfree not enabled" },
      { status: 400 },
    );
  }

  await ensureSchoolMirrorLoaded();
  const state = loadAdmissions();
  const payment = (state.registrationPayments || []).find(
    (p) => p.id === body.paymentId,
  );
  if (!payment) {
    return NextResponse.json(
      { error: "Payment not on server yet — retry in a moment" },
      { status: 404 },
    );
  }
  if (payment.status !== "open") {
    return NextResponse.json(
      { error: `Payment is ${payment.status}` },
      { status: 409 },
    );
  }

  const origin = publicAppOrigin();
  const shareUrl = registrationPayAbsoluteUrl(origin, payment);
  const returnUrl = shareUrl.replace(
    "/registration/pay#",
    "/registration/pay?cf=1#",
  );

  const cf = await createCashfreeLink({
    linkId: payment.id,
    amountPaise: payment.amountPaise,
    purpose: `Registration fee ${payment.code} — ${payment.childName}`,
    customerName: payment.childName || "Parent",
    customerMobile: payment.mobile || "",
    returnUrl,
    webhookUrl: `${origin.replace(/\/$/, "")}/api/payments/cashfree/webhook`,
    notes: {
      kind: "registration",
      registrationPaymentId: payment.id,
      code: payment.code,
    },
  });

  if (!cf.ok) {
    return NextResponse.json({ ok: false, error: cf.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, checkoutUrl: cf.linkUrl });
}
