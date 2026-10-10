/**
 * Parent / WhatsApp pay-link apply — updates server mirror ledger + WA receipt.
 */

import { NextResponse } from "next/server";
import { getPaymentLink, loadPayments } from "@/lib/payments";
import { settlePaymentLinkWithWhatsApp } from "@/lib/paymentSettlement.server";
import { authorizePaymentLinkAccess } from "@/lib/apiRouteAuth.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { fetchEligibleMethodGroups } from "@/lib/gatewayFeePolicy.server";
import { GATEWAY_METHOD_LABELS, type GatewayMethodGroup } from "@/lib/gatewayFees";

export const runtime = "nodejs";

export async function GET(req: Request) {
  await ensureSchoolMirrorHydrated();
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

  // WHICH WAYS THIS PARENT CAN ACTUALLY PAY, for this amount.
  //
  // The share page said "UPI / card / netbanking" in hard-coded text. The
  // account has had Cardless EMI, card EMI on nine banks, Pay Later, UPI
  // Credit Line and four wallets enabled all along, and Cashfree's checkout
  // has been offering them — but no parent could know that until they were
  // already on the payment screen, so for an annual fee the most useful option
  // on the list was the one nobody was told about.
  //
  // Asked per amount because EMI and Pay Later carry issuer minimums: naming
  // EMI on a ₹200 book charge no bank will finance is worse than not naming it.
  // Null means Cashfree could not be asked, and the page falls back to its
  // generic line rather than claiming a list it does not have.
  const groups = link.gatewayCheckoutUrl
    ? await fetchEligibleMethodGroups(link.amountPaise)
    : null;

  return NextResponse.json({
    payMethods: groups
      ? groups.map((g: GatewayMethodGroup) => ({ group: g, label: GATEWAY_METHOD_LABELS[g] }))
      : null,
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
  await ensureSchoolMirrorHydrated();
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
