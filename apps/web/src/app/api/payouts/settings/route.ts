/**
 * POST { refundApproval, refundApprovalAbovePaise } — who approves a fee-refund
 * link (Cashgram): "owner" (every one), "above" (links above the amount), or
 * "none". The school decides (director, 10 Oct 2026); the default is "owner".
 *
 * POST { enabled } — the owner's Payouts switch (director, 7 Oct 2026: "toggle
 * off/on … because sometime wallet may be low"; owner/director only). ON is
 * refused until the ₹1 test transfer has succeeded.
 */

import { NextResponse } from "next/server";
import { requireStaffApi } from "@/lib/apiRouteAuth.server";
import { readApprovalRule } from "@/lib/cashgram";
import { setPaymentApproval, setPayoutsEnabled, setRefundApproval } from "@/lib/payouts.server";
import { isSuperAdminSession } from "@/lib/superAdmin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireStaffApi(req);
  if (!auth.ok) return auth.response;
  if (auth.viaMirrorSecret || !isSuperAdminSession(auth.ctx.session)) {
    return NextResponse.json({ ok: false, error: "Only the owner can change Payouts settings." }, { status: 403 });
  }
  let body: {
    enabled?: unknown;
    refundApproval?: unknown;
    refundApprovalAbovePaise?: unknown;
    paymentApproval?: unknown;
    paymentApprovalAbovePaise?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  // Vendor bills and vouchers paid from the wallet: the same three choices.
  if (body.paymentApproval !== undefined) {
    const raw = String(body.paymentApproval);
    if (!["owner", "above", "none"].includes(raw)) {
      return NextResponse.json({ ok: false, error: "paymentApproval must be owner, above or none" }, { status: 400 });
    }
    const r = await setPaymentApproval(
      readApprovalRule(raw),
      Number(body.paymentApprovalAbovePaise ?? 0),
      auth.ctx.session.fullName || auth.ctx.session.email || "owner",
    );
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  if (body.refundApproval !== undefined) {
    const raw = String(body.refundApproval);
    if (!["owner", "above", "none"].includes(raw)) {
      return NextResponse.json({ ok: false, error: "refundApproval must be owner, above or none" }, { status: 400 });
    }
    const r = await setRefundApproval(
      readApprovalRule(raw),
      Number(body.refundApprovalAbovePaise ?? 0),
      auth.ctx.session.fullName || auth.ctx.session.email || "owner",
    );
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ ok: false, error: "enabled must be true or false" }, { status: 400 });
  }
  const r = await setPayoutsEnabled(body.enabled, auth.ctx.session.fullName || auth.ctx.session.email || "owner");
  return NextResponse.json(r, { status: r.ok ? 200 : 409 });
}
