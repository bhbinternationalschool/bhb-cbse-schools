/**
 * Parent / WhatsApp pay-link apply — updates server mirror ledger + WA receipt.
 */

import { NextResponse } from "next/server";
import { getPaymentLink, loadPayments } from "@/lib/payments";
import { settlePaymentLinkWithWhatsApp } from "@/lib/paymentSettlement.server";
import { authorizePaymentLinkAccess } from "@/lib/apiRouteAuth.server";
import { ensureSchoolMirrorLoaded } from "@/lib/schoolDataMirror.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  await ensureSchoolMirrorLoaded();
  const url = new URL(req.url);
  const linkId = url.searchParams.get("linkId") || "";
  const code = url.searchParams.get("code") || "";
  if (!linkId) {
    return NextResponse.json({ error: "linkId required" }, { status: 400 });
  }
  const link = getPaymentLink(linkId, loadPayments());
  if (!link) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const access = await authorizePaymentLinkAccess(req, link, { code });
  if (!access.ok) return access.response;

  return NextResponse.json({
    link: {
      id: link.id,
      code: link.code,
      status: link.status,
      amountPaise: link.amountPaise,
      studentName: link.studentName,
      classLabel: link.classLabel,
      expiresOn: link.expiresOn,
      receiptNo: link.receiptNo,
      upiRef: link.upiRef,
      lines: link.lines,
      gatewayCheckoutUrl: link.gatewayCheckoutUrl,
      gatewayMode: link.gatewayMode,
    },
  });
}

export async function POST(req: Request) {
  await ensureSchoolMirrorLoaded();
  let body: { linkId?: string; code?: string; upiRef?: string; sendWhatsApp?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.linkId) {
    return NextResponse.json({ error: "linkId required" }, { status: 400 });
  }

  const link = getPaymentLink(body.linkId, loadPayments());
  if (!link) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const access = await authorizePaymentLinkAccess(req, link, {
    code: body.code,
  });
  if (!access.ok) return access.response;

  const result = await settlePaymentLinkWithWhatsApp({
    linkId: body.linkId,
    cashierName:
      access.mode === "parent"
        ? "Parent portal"
        : access.mode === "public"
          ? "Parent UPI (pay link)"
          : "Staff desk",
    upiRef: body.upiRef,
    sendWhatsApp: body.sendWhatsApp,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    receiptNo: result.receiptNo,
    voucherId: result.voucherId,
    link: result.link,
    whatsappReceipt: result.whatsappReceipt,
  });
}
