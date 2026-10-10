/**
 * Staff salary by Cashgram link (director, 10 Oct 2026). For staff with no
 * UPI ID or bank account on file — a new joiner, someone leaving — or whenever
 * the office would rather the person chose where the money goes. Cashfree
 * texts them a link; they verify by OTP and pick UPI or bank.
 *
 * GET  ?kind=payroll_line&ids=a,b   the links for these salary lines
 * POST {action:"send", runId, staffId, amountPaise, expiryDays?}
 *      {action:"refresh" | "cancel", cashgramId}
 *
 * Same authority as Pay via Cashfree: payroll approve or accounts approve.
 * The amount and the phone come from the server's payroll run and staff
 * record, never from the screen (cashgramRefunds.server prepareStaffCashgram).
 */

import { NextResponse } from "next/server";
import { requireAnyStaffPermission } from "@/lib/apiRouteAuth.server";
import {
  cancelCashgramRefund,
  getCashgramRefund,
  listCashgramsForTargets,
  prepareStaffCashgram,
  refreshCashgramRefund,
} from "@/lib/cashgramRefunds.server";

export const runtime = "nodejs";

const VIEW = [
  { module: "payroll" as const, action: "view" as const },
  { module: "accounts" as const, action: "view" as const },
];
const PAY = [
  { module: "payroll" as const, action: "approve" as const },
  { module: "accounts" as const, action: "approve" as const },
];

export async function GET(req: Request) {
  const auth = await requireAnyStaffPermission(req, VIEW);
  if (!auth.ok) return auth.response;
  const q = new URL(req.url).searchParams;
  if (q.get("kind") !== "payroll_line") return NextResponse.json({ ok: false, error: "Unknown kind" }, { status: 400 });
  const ids = (q.get("ids") || "").split(",").map((x) => x.trim()).filter(Boolean);
  return NextResponse.json({ ok: true, links: await listCashgramsForTargets("payroll_line", ids) });
}

export async function POST(req: Request) {
  const auth = await requireAnyStaffPermission(req, PAY);
  if (!auth.ok) return auth.response;
  if (auth.viaMirrorSecret) {
    return NextResponse.json({ ok: false, error: "Salaries are sent by a person, not a service" }, { status: 403 });
  }
  const who = auth.ctx.session.fullName || auth.ctx.session.email || "payroll";
  let b: Record<string, unknown>;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const action = String(b.action || "");

  if (action === "send") {
    const r = await prepareStaffCashgram({
      runId: String(b.runId || "").trim(),
      staffId: String(b.staffId || "").trim(),
      amountPaise: Math.round(Number(b.amountPaise) || 0),
      expiryDays: Number(b.expiryDays ?? 7),
      requestedBy: who,
    });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }

  const cashgramId = String(b.cashgramId || "").trim();
  const row = cashgramId ? await getCashgramRefund(cashgramId) : null;
  // Only staff links here; fee refunds have their own route and permission.
  if (!row || row.purpose !== "staff_pay") return NextResponse.json({ ok: false, error: "No such pay link" }, { status: 404 });

  if (action === "refresh") {
    const fresh = await refreshCashgramRefund(cashgramId);
    return NextResponse.json({ ok: true, refund: fresh ?? row });
  }
  if (action === "cancel") {
    const r = await cancelCashgramRefund(cashgramId, who);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
}
