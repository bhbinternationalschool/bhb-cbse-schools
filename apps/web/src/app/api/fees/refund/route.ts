import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import {
  getRefund,
  listRefundsForVoucher,
  pollRefund,
  refundableRemaining,
  requestCashfreeRefund,
} from "@/lib/cashfreeRefunds.server";
import { getCashfreeCheckout } from "@/lib/cashfreeCheckouts.server";

export const runtime = "nodejs";

/**
 * Refunding a parent, from the fee desk.
 *
 * Until this existed the office had to open the Cashfree dashboard, refund by
 * hand, and remember to void the receipt afterwards — and the ERP only learned
 * of it when the next settlement recon report arrived.
 *
 * GET  ?voucherId=   the refunds against a receipt, and what became of them
 *      ?orderId=     how much of a payment is still refundable
 *      ?refundId=    one refund, re-asking Cashfree if it is still pending
 * POST {orderId, feePaise, reason}
 *
 * PERMISSION. A refund sends money out of the school's account, cannot be
 * pulled back, and reverses a receipt — so it is gated on `fees: void`, the
 * same authority the ERP already requires to void a receipt by hand, and NOT
 * the `fees: edit` that collecting uses. Taking money in and giving it back
 * are not the same permission.
 */
export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "fees", "view");
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const voucherId = (url.searchParams.get("voucherId") || "").trim();
  const orderId = (url.searchParams.get("orderId") || "").trim();
  const refundId = (url.searchParams.get("refundId") || "").trim();

  if (refundId) {
    const row = await getRefund(refundId);
    if (!row) return NextResponse.json({ ok: false, error: "No such refund" }, { status: 404 });
    // Re-ask Cashfree while it is still open. A webhook that never arrives is
    // a real failure mode, and this is how a stuck refund resolves without
    // anybody opening the dashboard.
    if (!row.appliedAt && row.status !== "FAILED" && row.status !== "CANCELLED") {
      await pollRefund(refundId);
    }
    return NextResponse.json({ ok: true, refund: (await getRefund(refundId)) ?? row });
  }

  if (voucherId) {
    return NextResponse.json({ ok: true, refunds: await listRefundsForVoucher(voucherId) });
  }

  if (orderId) {
    const checkout = await getCashfreeCheckout(orderId);
    if (!checkout) {
      return NextResponse.json({ ok: false, error: "No such payment" }, { status: 404 });
    }
    const remaining = await refundableRemaining({
      orderId,
      originalFeePaise: checkout.amountPaise,
      originalSurchargePaise: checkout.surchargePaise,
    });
    return NextResponse.json({
      ok: true,
      orderId,
      status: checkout.status,
      paidFeePaise: checkout.amountPaise,
      paidSurchargePaise: checkout.surchargePaise,
      refundable: remaining,
      refunds: await listRefundsForVoucher(checkout.ref),
    });
  }

  return NextResponse.json(
    { ok: false, error: "Pass voucherId, orderId or refundId" },
    { status: 400 },
  );
}

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "fees", "void");
  if (!auth.ok) return auth.response;

  let body: { orderId?: unknown; feePaise?: unknown; reason?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const orderId = String(body.orderId ?? "").trim();
  const feePaise = Math.round(Number(body.feePaise));
  const reason = String(body.reason ?? "").trim();

  if (!orderId) return NextResponse.json({ ok: false, error: "orderId is required" }, { status: 400 });
  if (!Number.isFinite(feePaise) || feePaise < 100) {
    return NextResponse.json({ ok: false, error: "A refund must be at least ₹1" }, { status: 400 });
  }
  // A reason is required, not decorative. It goes on the row, on the gateway
  // event and into the refund note Cashfree keeps, and it is what the auditor
  // asks about six months later.
  if (reason.length < 3) {
    return NextResponse.json(
      { ok: false, error: "Say why this is being refunded — it goes on the record" },
      { status: 400 },
    );
  }

  const result = await requestCashfreeRefund({
    orderId,
    feePaise,
    reason,
    requestedBy: auth.ctx.session.fullName || "fee desk",
  });
  if (!result.ok) return NextResponse.json(result, { status: 400 });

  return NextResponse.json({
    ok: true,
    refund: result.refund,
    // The desk needs to know which of the two happened. A PENDING refund has
    // NOT reopened the dues, and saying "refunded" over it would be the same
    // lie as a receipt for money that was never booked.
    settled: result.settledNow,
    message: result.settledNow
      ? `Refunded ₹${(result.refund.amountPaise / 100).toFixed(2)}. The receipt has been reversed and the dues are open again.`
      : `Refund of ₹${(result.refund.amountPaise / 100).toFixed(2)} sent to Cashfree. The receipt stays as it is until the money reaches the parent — usually 3 to 7 working days.`,
  });
}
