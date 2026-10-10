/**
 * Re-attach a receipt to the dues it paid.
 *
 * The money is already recorded; what was lost is which student, head and
 * month it went to. Without that a receipt clears nothing and every month it
 * paid reads unpaid.
 *
 * Server-side because the fee desk is localStorage-first: written here it is
 * authoritative, and a browser that has not seen the repair yet can no longer
 * delete it — a push replaces lines only for vouchers it actually carries
 * lines for.
 *
 * Needs `fees:edit`. It rewrites what a receipt says it settled, which is a
 * correction to the books, not a lookup.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import {
  buildRepairLines,
  checkReceiptRepair,
  type RepairAllocation,
} from "@/lib/receiptRepair";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "fees", "edit");
  if (!auth.ok) return auth.response;

  let body: { voucherId?: string; allocations?: RepairAllocation[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const voucherId = String(body.voucherId ?? "").trim();
  const allocations = Array.isArray(body.allocations) ? body.allocations : [];
  if (!voucherId) {
    return NextResponse.json({ ok: false, error: "Which receipt?" }, { status: 400 });
  }

  const ctx = await getServerTenantContext();
  if (!ctx) {
    return NextResponse.json(
      { ok: false, error: "Supabase tenant not configured" },
      { status: 502 },
    );
  }
  const { sb, tenantId } = ctx;

  // The receipt's own total is the authority on how much may be attached —
  // never a figure the browser sends. That is the whole invariant.
  const { data: voucher, error: vErr } = await sb
    .from("fee_desk_vouchers")
    .select("id, receipt_no, total_paise, voided_at")
    .eq("tenant_id", tenantId)
    .eq("id", voucherId)
    .maybeSingle();
  if (vErr) {
    return NextResponse.json({ ok: false, error: vErr.message }, { status: 502 });
  }
  if (!voucher) {
    return NextResponse.json({ ok: false, error: "Receipt not found" }, { status: 404 });
  }
  if ((voucher as { voided_at: string | null }).voided_at) {
    return NextResponse.json(
      { ok: false, error: "This receipt is voided — it settles nothing, so there is nothing to attach." },
      { status: 409 },
    );
  }

  const receiptTotalPaise = Number((voucher as { total_paise: number }).total_paise) || 0;
  const check = checkReceiptRepair({ receiptTotalPaise, allocations });
  if (!check.ok) {
    // Re-checked here and not only in the form: the form can be bypassed, and
    // a repair that does not tie is worse than the blank it replaces.
    return NextResponse.json(
      { ok: false, error: check.problems.join(" "), check },
      { status: 422 },
    );
  }

  const lines = buildRepairLines({ voucherId, tenantId, allocations });

  // Replace this receipt's lines in ONE transaction.
  //
  // This used to be a delete followed by an insert, with a comment claiming
  // that was safe "at this scope because the whole set is being supplied".
  // It was not. If the insert failed the delete had already committed, and
  // the receipt was left blank — by the identical mechanism that emptied the
  // entire fee book on 2026-09-06, one receipt at a time instead of 502. It
  // mattered more here than anywhere: this is the screen the office uses to
  // REPAIR a blank receipt, so its failure mode was to blank the thing it was
  // asked to mend.
  // The ONLY path allowed to change what a receipt settled.
  //
  // Receipt lines are append-only (20260907130000): a desk sync may add the
  // lines of a receipt that has none, and may never rewrite or remove the
  // lines of one that has them — which is what stopped four separate
  // incidents this week from being possible at all. A correction has to be
  // asked for by name, and this is the name. The function announces itself to
  // the trigger, refuses an allocation that does not equal the money taken,
  // and stamps who did it onto every line it writes.
  const { error: rpcErr } = await sb.rpc("repair_fee_receipt_allocation", {
    p_tenant_id: tenantId,
    p_voucher_id: voucherId,
    p_lines: lines,
    p_actor: auth.ctx.session?.fullName || auth.ctx.session?.email || "",
  });
  if (rpcErr) {
    return NextResponse.json(
      {
        ok: false,
        error: `Lines not written — the receipt is unchanged: ${rpcErr.message}`,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    receiptNo: (voucher as { receipt_no: string }).receipt_no,
    linesWritten: lines.length,
    attachedPaise: check.allocatedPaise,
  });
}
