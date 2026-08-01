/**
 * Parent / WhatsApp pay-link apply — updates server mirror ledger + WA receipt.
 */

import { NextResponse } from "next/server";
import { getPaymentLink, loadPayments } from "@/lib/payments";
import { settlePaymentLinkWithWhatsApp } from "@/lib/paymentSettlement.server";
import { ensureSchoolMirrorLoaded } from "@/lib/schoolDataMirror.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  await ensureSchoolMirrorLoaded();
  const url = new URL(req.url);
  const linkId = url.searchParams.get("linkId") || "";
  if (!linkId) {
    return NextResponse.json({ error: "linkId required" }, { status: 400 });
  }
  const link = getPaymentLink(linkId, loadPayments());
  if (!link) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ link });
}

export async function POST(req: Request) {
  await ensureSchoolMirrorLoaded();
  let body: { linkId?: string; upiRef?: string; sendWhatsApp?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.linkId) {
    return NextResponse.json({ error: "linkId required" }, { status: 400 });
  }

  const result = await settlePaymentLinkWithWhatsApp({
    linkId: body.linkId,
    cashierName: "Parent UPI (WhatsApp / pay link)",
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
