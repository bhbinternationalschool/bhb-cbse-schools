/**
 * UPI payments recorded with their UTR (table upi_payment_proofs).
 *
 * GET  ?kind=payroll_line|staff_advance&ids=a,b,c — what is recorded for these
 *      items, for the screens to show "Paid ✓ UTR …". Payroll or Accounts view.
 * POST { utr, amountPaise, paidOn, payeeName, payeeVpa, targetKind, targetId,
 *      targetLabel } — the ERP's own Pay by UPI button recording a payment.
 *      Payroll, Staff advances or Accounts edit. A UTR, or a paid item, is
 *      recorded once (unique indexes) — a second try is refused.
 */

import { NextResponse } from "next/server";
import { requireAnyStaffPermission } from "@/lib/apiRouteAuth.server";
import { listRecordedUpiProofs, recordUpiProofFromErp } from "@/lib/upiProofs.server";
import type { UpiTargetKind } from "@/lib/upiProofMatch";

export const runtime = "nodejs";

const KINDS = new Set<UpiTargetKind>(["payroll_line", "staff_advance", "ledger_voucher"]);

export async function GET(req: Request) {
  const auth = await requireAnyStaffPermission(req, [
    { module: "payroll", action: "view" },
    { module: "staff_advances", action: "view" },
    { module: "accounts", action: "view" },
  ]);
  if (!auth.ok) return auth.response;
  const q = new URL(req.url).searchParams;
  const kind = q.get("kind") as UpiTargetKind;
  if (!KINDS.has(kind)) return NextResponse.json({ ok: false, error: "Unknown kind" }, { status: 400 });
  const ids = (q.get("ids") || "").split(",").map((x) => x.trim()).filter(Boolean);
  return NextResponse.json({ ok: true, proofs: await listRecordedUpiProofs(kind, ids) });
}

export async function POST(req: Request) {
  const auth = await requireAnyStaffPermission(req, [
    { module: "payroll", action: "edit" },
    { module: "staff_advances", action: "edit" },
    { module: "accounts", action: "edit" },
  ]);
  if (!auth.ok) return auth.response;
  let b: Record<string, unknown>;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const utr = String(b.utr || "").replace(/\D/g, "");
  const kind = String(b.targetKind || "") as UpiTargetKind;
  const amountPaise = Math.round(Number(b.amountPaise) || 0);
  if (!/^\d{12}$/.test(utr)) return NextResponse.json({ ok: false, error: "A UTR is 12 digits" }, { status: 400 });
  if (!KINDS.has(kind) || !String(b.targetId || "").trim()) {
    return NextResponse.json({ ok: false, error: "What the payment is for is missing" }, { status: 400 });
  }
  if (!(amountPaise > 0)) return NextResponse.json({ ok: false, error: "Amount missing" }, { status: 400 });
  const r = await recordUpiProofFromErp({
    utr,
    amountPaise,
    paidOn: /^\d{4}-\d{2}-\d{2}$/.test(String(b.paidOn || "")) ? String(b.paidOn) : "",
    payeeName: String(b.payeeName || "").slice(0, 120),
    payeeVpa: String(b.payeeVpa || "").slice(0, 120),
    targetKind: kind,
    targetId: String(b.targetId).slice(0, 200),
    targetLabel: String(b.targetLabel || "").slice(0, 200),
    by: auth.viaMirrorSecret ? "system" : auth.ctx.session.fullName,
    staffId: auth.viaMirrorSecret ? "" : auth.ctx.session.staffId || "",
  });
  return NextResponse.json(r, { status: r.ok ? 200 : 409 });
}
