/**
 * Attach a live gateway checkout (Cashfree/Razorpay) to a counter-created
 * pay-link. The counter creates links in the browser store; the gateway
 * attach needs the secret key, so it happens here. The client posts its
 * link snapshot — if the background mirror sync hasn't delivered it yet,
 * the snapshot is inserted server-side first (same id, so the later sync
 * upserts rather than duplicates).
 */

import { NextResponse } from "next/server";
import {
  getPaymentLink,
  loadPayments,
  savePayments,
  type PaymentLink,
} from "@/lib/payments";
import {
  attachCashfreeToPaymentLink,
  shouldUseCashfreeCheckout,
} from "@/lib/cashfree.server";
import { attachRazorpayToPaymentLink } from "@/lib/razorpay.server";
import { publicAppOrigin } from "@/lib/waSisBotServer";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { ensureSchoolMirrorLoaded } from "@/lib/schoolDataMirror.server";
import { householdWhatsApp, loadSis } from "@/lib/sis";

export const runtime = "nodejs";

function validSnapshot(link: PaymentLink | undefined): link is PaymentLink {
  if (!link || typeof link !== "object") return false;
  if (!link.id || !link.code || !link.householdId) return false;
  if (link.status !== "open") return false;
  if (!Array.isArray(link.lines) || link.lines.length === 0) return false;
  const sum = link.lines.reduce(
    (s, l) => s + (Math.max(0, Number(l.amountPaise)) || 0),
    0,
  );
  return sum > 0 && sum === (Number(link.amountPaise) || 0);
}

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "fees", "edit");
  if (!auth.ok) return auth.response;

  let body: { link?: PaymentLink };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const snapshot = body.link;
  if (!snapshot?.id) {
    return NextResponse.json({ error: "link required" }, { status: 400 });
  }

  await ensureSchoolMirrorLoaded();
  const state = loadPayments();
  let link = getPaymentLink(snapshot.id, state);

  if (!link) {
    if (!validSnapshot(snapshot)) {
      return NextResponse.json(
        { error: "Link not on server yet and snapshot is not a valid open link" },
        { status: 400 },
      );
    }
    savePayments({ version: 1, links: [snapshot, ...state.links] });
    link = snapshot;
  }

  if (link.status !== "open") {
    return NextResponse.json(
      { error: `Link is ${link.status}` },
      { status: 409 },
    );
  }
  if (link.gatewayCheckoutUrl) {
    return NextResponse.json({
      ok: true,
      alreadyAttached: true,
      gatewayMode: link.gatewayMode,
      checkoutUrl: link.gatewayCheckoutUrl,
    });
  }

  const sis = loadSis();
  const hh = sis.households.find((h) => h.id === link.householdId);
  const customerMobile = hh
    ? householdWhatsApp(hh) || hh.mobile || hh.altMobile || ""
    : "";
  const customerName = hh?.guardianName || link.studentName;

  const attachOpts = {
    link,
    customerName,
    customerMobile,
    appOrigin: publicAppOrigin(),
  };
  const result = shouldUseCashfreeCheckout()
    ? await attachCashfreeToPaymentLink(attachOpts)
    : await attachRazorpayToPaymentLink(attachOpts);

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    gatewayMode: result.link.gatewayMode,
    checkoutUrl: result.checkoutUrl,
    externalId: result.link.gatewayExternalId,
  });
}
