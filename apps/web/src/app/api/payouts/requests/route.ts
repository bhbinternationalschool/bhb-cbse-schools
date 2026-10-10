/**
 * Paying a store vendor bill or a payment voucher from the Cashfree Payouts
 * wallet (director, 10 Oct 2026). See payoutRequests.server.
 *
 * GET  ?pending=1          waiting for the owner, school-wide
 *      ?billIds=a,b        the requests for these vendor bills
 *      ?id=                one, re-asking Cashfree while it is in flight
 * POST {action:"vendor", billId, amountPaise, channel?, reason?}
 *      {action:"voucher", draft:{narration, lines:[{accountCode, amountPaise, costCentreCode?}]}, payeeName, payeePhone}
 *      {action:"approve" | "reject" | "cancel" | "refresh", id, note?}
 *
 * PERMISSION. Accounts approve to prepare — the same authority as recording a
 * payment from the books. A first approval under the school's rule is the
 * owner's; a payment already approved (the wallet was short) may be re-sent
 * by the desk.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import {
  approvePayoutRequest,
  cancelPayoutRequest,
  getPayoutRequest,
  listPayoutRequests,
  prepareVendorPayment,
  prepareVoucherPayment,
  refreshPayoutRequest,
  rejectPayoutRequest,
} from "@/lib/payoutRequests.server";
import type { VoucherDraft } from "@/lib/payoutRequests";
import { isSuperAdminSession } from "@/lib/superAdmin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "accounts", "view");
  if (!auth.ok) return auth.response;
  const q = new URL(req.url).searchParams;
  const canApprove = !auth.viaMirrorSecret && isSuperAdminSession(auth.ctx.session);
  const id = (q.get("id") || "").trim();
  if (id) {
    const r = await refreshPayoutRequest(id);
    return r ? NextResponse.json({ ok: true, request: r }) : NextResponse.json({ ok: false, error: "No such payment" }, { status: 404 });
  }
  if (q.get("pending") === "1") {
    return NextResponse.json({ ok: true, canApprove, requests: await listPayoutRequests({ status: "PENDING_APPROVAL", limit: 100 }) });
  }
  const billIds = (q.get("billIds") || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (billIds.length) {
    return NextResponse.json({ ok: true, canApprove, requests: await listPayoutRequests({ billIds, kind: "vendor_bill" }) });
  }
  return NextResponse.json({ ok: true, canApprove, requests: await listPayoutRequests({ limit: 50 }) });
}

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "accounts", "approve");
  if (!auth.ok) return auth.response;
  if (auth.viaMirrorSecret) return NextResponse.json({ ok: false, error: "Payments are made by a person, not a service" }, { status: 403 });
  const session = auth.ctx.session;
  const who = session.fullName || session.email || "accounts";
  const isOwner = isSuperAdminSession(session);
  let b: Record<string, unknown>;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const action = String(b.action || "");

  if (action === "vendor") {
    const channel = b.channel === "link" ? "link" : b.channel === "transfer" ? "transfer" : "";
    const r = await prepareVendorPayment({
      billId: String(b.billId || ""),
      amountPaise: Math.round(Number(b.amountPaise) || 0),
      channel,
      reason: String(b.reason || ""),
      requestedBy: who,
      requestedByOwner: isOwner,
    });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  if (action === "voucher") {
    const d = (b.draft ?? {}) as Partial<VoucherDraft>;
    const r = await prepareVoucherPayment({
      draft: { narration: String(d.narration || ""), partyName: "", lines: Array.isArray(d.lines) ? d.lines : [] },
      payeeName: String(b.payeeName || ""),
      payeePhone: String(b.payeePhone || ""),
      requestedBy: who,
      requestedByOwner: isOwner,
    });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }

  const id = String(b.id || "").trim();
  const row = id ? await getPayoutRequest(id) : null;
  if (!row) return NextResponse.json({ ok: false, error: "No such payment" }, { status: 404 });

  if (action === "approve") {
    if (!row.approvedAt && !isOwner) return NextResponse.json({ ok: false, error: "Only the owner can approve this payment" }, { status: 403 });
    const r = await approvePayoutRequest(id, row.approvedAt ? row.approvedBy : who);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  if (action === "reject") {
    if (!isOwner) return NextResponse.json({ ok: false, error: "Only the owner can turn a payment down" }, { status: 403 });
    const r = await rejectPayoutRequest(id, who, String(b.note || ""));
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  if (action === "cancel") {
    const r = await cancelPayoutRequest(id, who);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  if (action === "refresh") {
    const r = await refreshPayoutRequest(id);
    return NextResponse.json({ ok: true, request: r ?? row });
  }
  return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
}
