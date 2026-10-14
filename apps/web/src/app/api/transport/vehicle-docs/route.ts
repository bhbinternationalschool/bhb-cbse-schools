/**
 * Vehicle documents — PUC, fitness, permit, road tax, CNG hydro test,
 * AIS-140, fire extinguisher and insurance — server truth (one
 * module_local_state row, lib/transportFinance.server.ts).
 *
 * GET   every document (history included), the expense head a fee would be
 *       booked to, and — for someone who may post — the school banks.
 * POST  { action: "save", id?, baseUpdatedAt?, doc }   transport · create/edit
 *       { action: "post-fee", id, mode, bankCode?, paidOn, ref? }
 *                                                     + accounts · edit
 *       { action: "void", id, reason }                transport · delete
 *                                                     (+ accounts · approve when its fee is booked)
 *
 * Replaces the desk-only "Certificate renewal" and "Insurance policy" forms,
 * which wrote slices the server never saved (14 Oct 2026).
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { hasPermission } from "@/lib/rbac";
import {
  postVehicleDocFee,
  readFleetVehicles,
  readVehicleDocs,
  saveVehicleDoc,
  vehicleDocPostingTargets,
  voidVehicleDoc,
} from "@/lib/transportFinance.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "transport", "view");
  if (!auth.ok) return auth.response;
  const [docs, vehicles] = await Promise.all([readVehicleDocs(), readFleetVehicles()]);
  if (!docs) return NextResponse.json({ ok: false, error: "Could not read the vehicle documents" }, { status: 502 });
  const can = (m: "accounts" | "transport", a: "edit" | "approve" | "create" | "delete") =>
    auth.viaMirrorSecret || hasPermission(auth.ctx.session, auth.ctx.masters, m, a, auth.ctx.rbac);
  const canPost = can("accounts", "edit");
  const targets = canPost ? await vehicleDocPostingTargets() : null;
  return NextResponse.json(
    {
      ok: true,
      docs: docs.state.docs,
      vehicles: vehicles ?? [],
      vehiclesKnown: vehicles !== null,
      expenseHead: targets?.expense ?? null,
      banks: targets?.banks ?? [],
      canPost,
      canReverse: can("accounts", "approve"),
    },
    { headers: { "cache-control": "no-store" } },
  );
}

type Body = {
  action?: string;
  id?: string;
  baseUpdatedAt?: string;
  doc?: unknown;
  mode?: string;
  bankCode?: string;
  paidOn?: string;
  ref?: string;
  reason?: string;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const action = String(body.action ?? "");
  if (action === "save") {
    const auth = await requireStaffPermission(req, "transport", body.id ? "edit" : "create");
    if (!auth.ok) return auth.response;
    const by = auth.ctx.session.fullName || auth.ctx.session.email || "staff";
    const r = await saveVehicleDoc({ id: body.id || undefined, baseUpdatedAt: body.baseUpdatedAt, doc: body.doc, by });
    return NextResponse.json(r, { status: r.ok ? 200 : (r.status ?? 422) });
  }
  if (action === "post-fee") {
    const t = await requireStaffPermission(req, "transport", "edit");
    if (!t.ok) return t.response;
    // Booking money is an Accounts entry, whoever starts it.
    const auth = await requireStaffPermission(req, "accounts", "edit");
    if (!auth.ok) return auth.response;
    const by = auth.ctx.session.fullName || auth.ctx.session.email || "staff";
    const mode = body.mode === "bank" ? "bank" : body.mode === "cash" ? "cash" : null;
    if (!mode) return NextResponse.json({ ok: false, error: "Paid in cash or from a bank?" }, { status: 400 });
    const r = await postVehicleDocFee({
      id: String(body.id ?? ""),
      mode,
      bankCode: body.bankCode,
      paidOn: String(body.paidOn ?? ""),
      ref: body.ref,
      by,
    });
    return NextResponse.json(r, { status: r.ok ? 200 : (r.status ?? 422) });
  }
  if (action === "void") {
    const auth = await requireStaffPermission(req, "transport", "delete");
    if (!auth.ok) return auth.response;
    const by = auth.ctx.session.fullName || auth.ctx.session.email || "staff";
    const canReverse = auth.viaMirrorSecret || hasPermission(auth.ctx.session, auth.ctx.masters, "accounts", "approve", auth.ctx.rbac);
    const r = await voidVehicleDoc({ id: String(body.id ?? ""), reason: String(body.reason ?? ""), by, canReverse });
    return NextResponse.json(r, { status: r.ok ? 200 : (r.status ?? 422) });
  }
  return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
}
