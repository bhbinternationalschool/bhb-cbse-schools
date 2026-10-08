/**
 * POST { vpa, name } — the owner's ₹1 test transfer to their OWN UPI ID. Its
 * SUCCESS (from the status check or the webhook) unlocks the Payouts switch:
 * real evidence that Cashfree accepts this account's requests, before any
 * staff or vendor payment can go out. Owner only. GET ?transferId= re-asks
 * Cashfree for the test's status.
 */

import { NextResponse } from "next/server";
import { requireStaffApi } from "@/lib/apiRouteAuth.server";
import { payoutBeneficiaryId, payoutSentence } from "@/lib/payouts";
import { ensureBeneficiary, fetchTransferStatus, getPayout, requestPayoutTransfer } from "@/lib/payouts.server";
import { isSuperAdminSession } from "@/lib/superAdmin";
import { isVpa } from "@/lib/upiPay";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireStaffApi(req);
  if (!auth.ok) return auth.response;
  if (auth.viaMirrorSecret || !isSuperAdminSession(auth.ctx.session)) {
    return NextResponse.json({ ok: false, error: "Only the owner can send the test transfer." }, { status: 403 });
  }
  let body: { vpa?: string; name?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const vpa = String(body.vpa || "").trim().toLowerCase();
  const name = String(body.name || auth.ctx.session.fullName || "").trim();
  if (!isVpa(vpa)) return NextResponse.json({ ok: false, error: "Enter your own UPI ID (name@bank)." }, { status: 400 });
  if (!name) return NextResponse.json({ ok: false, error: "Enter the name on that UPI ID." }, { status: 400 });

  const beneficiaryId = payoutBeneficiaryId({ subject: "owner", vpa });
  const ben = await ensureBeneficiary({ beneficiaryId, name, vpa });
  if (!ben.ok) return NextResponse.json(ben, { status: 400 });
  // A new id each try: a test that failed may be repeated.
  const transferId = `test_${Date.now().toString(36)}`;
  const out = await requestPayoutTransfer({
    transferId,
    beneficiaryId: ben.beneficiaryId,
    amountPaise: 100,
    kind: "test",
    subjectId: "owner",
    period: new Date().toISOString().slice(0, 10),
    remarks: "BHB ERP payouts test",
    requestedBy: auth.ctx.session.fullName || "owner",
    mode: "upi",
    payeeName: name,
    isTest: true,
  });
  if (!out.ok) return NextResponse.json(out, { status: 400 });
  return NextResponse.json({
    ok: true,
    transferId,
    status: out.transfer.status,
    message: out.view ? payoutSentence(out.view) : "Sent — checking its status.",
  });
}

export async function GET(req: Request) {
  const auth = await requireStaffApi(req);
  if (!auth.ok) return auth.response;
  if (auth.viaMirrorSecret || !isSuperAdminSession(auth.ctx.session)) {
    return NextResponse.json({ ok: false, error: "Owner only" }, { status: 403 });
  }
  const id = new URL(req.url).searchParams.get("transferId") || "";
  if (!/^test_[a-z0-9]+$/.test(id)) return NextResponse.json({ ok: false, error: "Unknown test" }, { status: 400 });
  const row = await getPayout(id);
  if (!row) return NextResponse.json({ ok: false, error: "No such test" }, { status: 404 });
  const view = row.status === "SUCCESS" || row.status === "FAILED" || row.status === "REJECTED" ? null : await fetchTransferStatus(id);
  const fresh = (await getPayout(id)) ?? row;
  return NextResponse.json({ ok: true, status: fresh.status, utr: fresh.utr, message: view ? payoutSentence(view) : "" });
}
