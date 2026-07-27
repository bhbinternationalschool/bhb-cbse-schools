/**
 * Parent / WhatsApp pay-link apply — updates server mirror ledger + WA receipt.
 */

import { NextResponse } from "next/server";
import {
  applyPaymentLink,
  getPaymentLink,
  loadPayments,
} from "@/lib/payments";
import { ensureSchoolMirrorLoaded } from "@/lib/schoolDataMirror.server";
import { sendSisFeeReceiptOnWhatsApp } from "@/lib/waSisBotServer";
import { loadSis, householdWhatsApp } from "@/lib/sis";

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

  const result = applyPaymentLink({
    linkId: body.linkId,
    cashierName: "Parent UPI (WhatsApp / pay link)",
    upiRef: body.upiRef,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  let wa: { ok: boolean; error?: string } | null = null;
  if (body.sendWhatsApp !== false) {
    const sis = loadSis();
    const hh = sis.households.find((h) => h.id === result.link.householdId);
    const mobile = hh ? householdWhatsApp(hh) || hh.mobile || "" : "";
    if (mobile) {
      wa = await sendSisFeeReceiptOnWhatsApp({
        mobile,
        voucherId: result.voucherId,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    receiptNo: result.receiptNo,
    voucherId: result.voucherId,
    link: result.link,
    whatsappReceipt: wa,
  });
}
