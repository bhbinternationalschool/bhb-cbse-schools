/**
 * Transport → Finance → Vehicle loans, read from Ledger v2.
 *
 * GET   every vehicle-loan account with its outstanding balance, this
 *       year's principal and interest, the last EMI posted and every month
 *       whose EMI is not in the books (lib/transportFinance.ts).
 * POST  { action: "link", code, vehicleId, emiDueDay, paidBy } — which bus
 *       a loan account is for (Accounts · edit).
 *
 * A loan's outstanding balance is a position figure — what the school owes —
 * so reading it needs what the Accounts statements need: accounts · view AND
 * accounts_position · view (the same rule as /api/ledger's
 * account-statement). A transport-only login sees the tab say so, not
 * the numbers. Nothing here posts an EMI.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { hasPermission } from "@/lib/rbac";
import { buildVehicleLoans, saveLoanLink } from "@/lib/transportFinance.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "accounts", "view");
  if (!auth.ok) return auth.response;
  const pos = await requireStaffPermission(req, "accounts_position", "view");
  if (!pos.ok) return pos.response;
  const r = await buildVehicleLoans();
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status ?? 502 });
  const canEdit = auth.viaMirrorSecret || hasPermission(auth.ctx.session, auth.ctx.masters, "accounts", "edit", auth.ctx.rbac);
  return NextResponse.json({ ...r, canEdit }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  let body: { action?: string; code?: string; vehicleId?: string; emiDueDay?: number; paidBy?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  if (body.action !== "link") return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  const auth = await requireStaffPermission(req, "accounts", "edit");
  if (!auth.ok) return auth.response;
  const by = auth.ctx.session.fullName || auth.ctx.session.email || "staff";
  const r = await saveLoanLink({
    code: String(body.code ?? ""),
    vehicleId: String(body.vehicleId ?? ""),
    emiDueDay: Number(body.emiDueDay ?? 10),
    paidBy: String(body.paidBy ?? ""),
    by,
  });
  return NextResponse.json(r, { status: r.ok ? 200 : (r.status ?? 422) });
}
