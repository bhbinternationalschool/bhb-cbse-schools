import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { writeAudit } from "@/lib/audit.server";
import { formatInr } from "@/lib/fees";
import type { BulkStrategy } from "@/lib/feeBulkAllocation";
import { listBulk, postBulk, previewBulk } from "@/lib/feeBulkPayments.server";
import { toolsErrorResponse } from "@/lib/feeTools.server";

export const runtime = "nodejs";

/**
 * Bulk fee payment (Fees → Bulk & PDC → Bulk payment).
 *
 * GET                       recent bulk payments
 * POST {action:"preview", studentIds, strategy, includeFuture}
 *      {action:"post", batchId, expectedTotalPaise, studentIds, strategy,
 *       includeFuture, mode, ref, instrumentDate, bankName, payerLabel, note}
 *
 * strategy: {kind:"full"} | {kind:"oldest_first", amountPaise}
 *         | {kind:"per_child", amounts:{[studentId]: paise}}
 *
 * PERMISSION. fees·create — taking money in, as at the counter.
 */
function readStrategy(raw: unknown): BulkStrategy | null {
  const s = (raw ?? {}) as Record<string, unknown>;
  if (s.kind === "full") return { kind: "full" };
  if (s.kind === "oldest_first") return { kind: "oldest_first", amountPaise: Math.round(Number(s.amountPaise) || 0) };
  if (s.kind === "per_child" && s.amounts && typeof s.amounts === "object") {
    const amounts: Record<string, number> = {};
    for (const [k, v] of Object.entries(s.amounts as Record<string, unknown>)) amounts[k] = Math.round(Number(v) || 0);
    return { kind: "per_child", amounts };
  }
  return null;
}

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "fees", "view");
  if (!auth.ok) return auth.response;
  const rows = await listBulk(100);
  if (!rows) return Response.json({ ok: false, error: "Could not read the bulk payments — try again" }, { status: 503 });
  return Response.json({ ok: true, payments: rows });
}

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "fees", "create");
  if (!auth.ok) return auth.response;
  if (auth.viaMirrorSecret) {
    return Response.json({ ok: false, error: "Fees are collected by a person, not a service" }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const strategy = readStrategy(body.strategy);
  if (!strategy) return Response.json({ ok: false, error: "Choose how to split the payment" }, { status: 400 });
  const studentIds = Array.isArray(body.studentIds) ? body.studentIds.map((x) => String(x)) : [];
  const includeFuture = body.includeFuture === true;

  try {
    if (body.action === "preview") {
      const { plan, children } = await previewBulk({ studentIds, strategy, includeFuture });
      return Response.json({
        ok: true,
        plan,
        children: children.map((c) => ({
          studentId: c.studentId,
          openPaise: c.dues.reduce((n, d) => n + d.balancePaise, 0),
        })),
      });
    }
    if (body.action === "post") {
      const session = auth.ctx.session;
      const r = await postBulk(
        {
          studentIds,
          strategy,
          includeFuture,
          batchId: String(body.batchId ?? ""),
          expectedTotalPaise: Math.round(Number(body.expectedTotalPaise) || 0),
          mode: String(body.mode ?? ""),
          ref: String(body.ref ?? ""),
          instrumentDate: String(body.instrumentDate ?? ""),
          bankName: String(body.bankName ?? ""),
          payerLabel: String(body.payerLabel ?? ""),
          note: String(body.note ?? ""),
        },
        session,
      );
      if (!r.duplicate) {
        await writeAudit({
          session,
          module: "fees",
          action: "create",
          entityType: "fee_bulk_payment",
          entityId: r.record.id,
          summary: `Bulk payment from ${r.record.payerLabel}: ${formatInr(r.record.totalPaise)} over ${r.record.receipts.length} receipt(s) (${r.record.receipts.map((x) => x.receiptNo).join(", ")})`,
          after: r.record,
        }).catch(() => null);
      }
      return Response.json({ ok: true, ...r });
    }
    return Response.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return toolsErrorResponse(e);
  }
}
