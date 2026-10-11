import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { writeAudit } from "@/lib/audit.server";
import { formatInr } from "@/lib/fees";
import type { PdcIntendedLine } from "@/lib/feePdc";
import {
  closePdc,
  createPdc,
  depositPdc,
  listBouncedDeskCheques,
  listPdcs,
} from "@/lib/feePdc.server";
import { toolsErrorResponse } from "@/lib/feeTools.server";

export const runtime = "nodejs";

/**
 * Post-dated cheque register (Fees → Bulk & PDC → Post-dated cheques).
 *
 * GET                    every PDC (the screen sorts by cheque date)
 *     ?bounced=1         the bounced report: PDCs bounced before deposit AND
 *                        fee-desk cheques that bounced after (their receipts
 *                        were voided by Cheques → Bounce)
 * POST {action:"create", householdId, chequeNo, bankName, chequeDate,
 *       amountPaise, receivedOn, intended:[{studentId,dueKey,label,kind,amountPaise}], note}
 *      {action:"deposit", id}           on/after the cheque date → receipt
 *      {action:"bounce"|"return"|"cancel", id, reason}
 *
 * PERMISSION. Recording and depositing take money in: fees·create (the
 * counter's own grant). Closing a cheque without a receipt: fees·edit.
 */
export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "fees", "view");
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  if (url.searchParams.get("bounced") === "1") {
    const [pdcs, desk] = await Promise.all([listPdcs(), listBouncedDeskCheques()]);
    if (!pdcs || !desk) {
      return Response.json({ ok: false, error: "Could not read the cheque registers — try again" }, { status: 503 });
    }
    return Response.json({
      ok: true,
      pdcs: pdcs.filter((p) => p.status === "bounced"),
      desk,
    });
  }
  const rows = await listPdcs();
  if (!rows) return Response.json({ ok: false, error: "Could not read the post-dated cheques — try again" }, { status: 503 });
  return Response.json({ ok: true, pdcs: rows });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const action = String(body.action ?? "");
  const need = action === "create" || action === "deposit" ? "create" : "edit";
  const auth = await requireStaffPermission(req, "fees", need);
  if (!auth.ok) return auth.response;
  if (auth.viaMirrorSecret) {
    return Response.json({ ok: false, error: "Cheques are handled by a person, not a service" }, { status: 403 });
  }
  const session = auth.ctx.session;
  const who = session.fullName || session.email || "fee desk";

  try {
    if (action === "create") {
      const intended = (Array.isArray(body.intended) ? body.intended : []).map((x) => {
        const l = (x ?? {}) as Record<string, unknown>;
        return {
          studentId: String(l.studentId ?? ""),
          studentName: String(l.studentName ?? ""),
          dueKey: String(l.dueKey ?? ""),
          label: String(l.label ?? ""),
          kind: String(l.kind ?? ""),
          amountPaise: Math.round(Number(l.amountPaise) || 0),
        } satisfies PdcIntendedLine;
      });
      const pdc = await createPdc(
        {
          householdId: String(body.householdId ?? ""),
          chequeNo: String(body.chequeNo ?? ""),
          bankName: String(body.bankName ?? ""),
          chequeDate: String(body.chequeDate ?? ""),
          amountPaise: Math.round(Number(body.amountPaise) || 0),
          receivedOn: String(body.receivedOn ?? ""),
          intended,
          note: String(body.note ?? ""),
        },
        who,
        session.academicYearCode,
      );
      await writeAudit({
        session,
        module: "fees",
        action: "create",
        entityType: "pdc_cheque",
        entityId: pdc.id,
        summary: `Post-dated cheque ${pdc.chequeNo} (${pdc.bankName}) ${formatInr(pdc.amountPaise)} dated ${pdc.chequeDate} from ${pdc.guardianName}`,
        after: pdc,
      }).catch(() => null);
      return Response.json({ ok: true, pdc });
    }

    const id = String(body.id ?? "").trim();
    if (!id) return Response.json({ ok: false, error: "id is required" }, { status: 400 });

    if (action === "deposit") {
      const r = await depositPdc(id, { session });
      await writeAudit({
        session,
        module: "fees",
        action: "create",
        entityType: "pdc_cheque",
        entityId: id,
        summary: `Post-dated cheque ${r.pdc.chequeNo} deposited — receipt ${r.receiptNo} (${formatInr(r.pdc.amountPaise)})`,
        after: { receiptNo: r.receiptNo, voucherId: r.voucherId, movedPaise: r.movedPaise },
      }).catch(() => null);
      return Response.json({ ok: true, ...r });
    }

    if (action === "bounce" || action === "return" || action === "cancel") {
      const to = action === "bounce" ? "bounced" : action === "return" ? "returned" : "cancelled";
      const pdc = await closePdc(id, to, String(body.reason ?? ""), who);
      await writeAudit({
        session,
        module: "fees",
        action: "edit",
        entityType: "pdc_cheque",
        entityId: id,
        summary: `Post-dated cheque ${pdc.chequeNo} ${to}: ${pdc.statusReason}`,
        after: { status: to, reason: pdc.statusReason },
      }).catch(() => null);
      return Response.json({ ok: true, pdc });
    }

    return Response.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return toolsErrorResponse(e);
  }
}
