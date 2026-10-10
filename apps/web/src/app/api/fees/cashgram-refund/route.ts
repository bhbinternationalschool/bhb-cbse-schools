import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import {
  approveCashgramRefund,
  cancelCashgramRefund,
  getCashgramRefund,
  householdRefundable,
  listCashgramRefunds,
  prepareCashgramRefund,
  refreshCashgramRefund,
  rejectCashgramRefund,
} from "@/lib/cashgramRefunds.server";
import { getPayoutSettings, payoutsEnabled } from "@/lib/payouts.server";
import { isSuperAdminSession } from "@/lib/superAdmin";

export const runtime = "nodejs";

/**
 * Fee refunds by Cashgram link — for money paid in cash or by UPI to the
 * school, where the school has no bank details for the family. (Online
 * payments go back the way they came: /api/fees/refund.)
 *
 * GET  ?householdId=   what the family may have back, its receipts, its links
 *      ?pending=1      links waiting for the owner, school-wide
 *      ?cashgramId=    one link, re-asking Cashfree while it is open
 * POST {action: "prepare", feeEffect, householdId, voucherId?, amountPaise,
 *       payeeName, payeePhone, payeeEmail?, reason, expiryDays?}
 *      {action: "approve" | "reject" | "cancel" | "refresh", cashgramId, note?}
 *
 * PERMISSION. Preparing is `fees: void` — the authority that already gates
 * online refunds and voiding by hand. Approving is the owner's, under the
 * school's own rule (Settings → Payouts); a link the rule let through, or the
 * owner already approved, may be re-sent by the desk once the wallet is topped
 * up.
 */
export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "fees", "view");
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const householdId = (url.searchParams.get("householdId") || "").trim();
  const cashgramId = (url.searchParams.get("cashgramId") || "").trim();
  const isOwner = !auth.viaMirrorSecret && isSuperAdminSession(auth.ctx.session);

  if (cashgramId) {
    const row = await refreshCashgramRefund(cashgramId);
    if (!row) return NextResponse.json({ ok: false, error: "No such refund" }, { status: 404 });
    return NextResponse.json({ ok: true, refund: row });
  }

  if (url.searchParams.get("pending") === "1") {
    return NextResponse.json({
      ok: true,
      canApprove: isOwner,
      refunds: await listCashgramRefunds({ status: "PENDING_APPROVAL", limit: 100 }),
    });
  }

  if (householdId) {
    const position = await householdRefundable(householdId);
    if (!position) return NextResponse.json({ ok: false, error: "No such family" }, { status: 404 });
    const settings = await getPayoutSettings();
    const gate = await payoutsEnabled();
    return NextResponse.json({
      ok: true,
      position,
      refunds: await listCashgramRefunds({ householdId, limit: 50 }),
      approval: { rule: settings.refundApproval, abovePaise: settings.refundApprovalAbovePaise },
      payouts: { ok: gate.ok, why: gate.why },
      canApprove: isOwner,
    });
  }

  return NextResponse.json({ ok: false, error: "Pass householdId, pending=1 or cashgramId" }, { status: 400 });
}

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "fees", "void");
  if (!auth.ok) return auth.response;
  if (auth.viaMirrorSecret) {
    return NextResponse.json({ ok: false, error: "Refunds are made by a person, not a service" }, { status: 403 });
  }
  const session = auth.ctx.session;
  const who = session.fullName || session.email || "fee desk";
  const isOwner = isSuperAdminSession(session);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const action = String(body.action ?? "");
  const cashgramId = String(body.cashgramId ?? "").trim();

  if (action === "prepare") {
    const feeEffect = body.feeEffect === "void" ? "void" : body.feeEffect === "excess" ? "excess" : null;
    if (!feeEffect) return NextResponse.json({ ok: false, error: "Choose what the refund does to the fee record" }, { status: 400 });
    const r = await prepareCashgramRefund({
      feeEffect,
      householdId: String(body.householdId ?? ""),
      voucherId: String(body.voucherId ?? ""),
      amountPaise: Math.round(Number(body.amountPaise)),
      payeeName: String(body.payeeName ?? ""),
      payeePhone: String(body.payeePhone ?? ""),
      payeeEmail: String(body.payeeEmail ?? ""),
      reason: String(body.reason ?? ""),
      expiryDays: Number(body.expiryDays ?? 7),
      requestedBy: who,
      requestedByOwner: isOwner,
    });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }

  if (!cashgramId) return NextResponse.json({ ok: false, error: "cashgramId is required" }, { status: 400 });

  if (action === "refresh") {
    const row = await refreshCashgramRefund(cashgramId);
    return row ? NextResponse.json({ ok: true, refund: row }) : NextResponse.json({ ok: false, error: "No such refund" }, { status: 404 });
  }

  if (action === "approve") {
    const row = await getCashgramRefund(cashgramId);
    if (!row) return NextResponse.json({ ok: false, error: "No such refund" }, { status: 404 });
    // Re-sending something already approved (wallet was short) is the desk's;
    // a first approval is the owner's.
    if (!row.approvedAt && !isOwner) {
      return NextResponse.json({ ok: false, error: "Only the owner can approve a refund link" }, { status: 403 });
    }
    const r = await approveCashgramRefund(cashgramId, row.approvedAt ? row.approvedBy : who);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }

  if (action === "reject") {
    if (!isOwner) return NextResponse.json({ ok: false, error: "Only the owner can turn a refund down" }, { status: 403 });
    const r = await rejectCashgramRefund(cashgramId, who, String(body.note ?? ""));
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }

  if (action === "cancel") {
    const r = await cancelCashgramRefund(cashgramId, who);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }

  return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
}
