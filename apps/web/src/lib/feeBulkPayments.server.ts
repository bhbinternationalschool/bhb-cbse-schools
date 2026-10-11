import "server-only";

/**
 * Bulk fee payment — one payment for several children (siblings, a staff-ward
 * group, a sponsor), one receipt per child, all written in one fee-desk
 * transaction (lib/feeTools.server.ts). The allocation is lib/feeBulkAllocation.
 *
 * Preview and post run the SAME plan from dues read fresh on the server. Post
 * carries the total the office saw; if the dues moved in between (someone
 * collected at the counter), nothing is posted and the office previews again.
 * The batch id is minted by the browser and stamped on every receipt, so a
 * double-click or a retry returns the receipts already made.
 */

import { ApiError } from "@/lib/api/v1/errors";
import type { DemoSession } from "@/lib/auth";
import { canBackdateReceipt } from "@/lib/rbac";
import { TENDER_MODES, type TenderMode, type VoucherLine } from "@/lib/fees";
import {
  bulkPlanSignature,
  bulkReceiptTransactionId,
  planBulkAllocation,
  sessionRowProblem,
  type BulkChild,
  type BulkPlan,
  type BulkStrategy,
} from "@/lib/feeBulkAllocation";
import {
  istToday,
  loadFeeToolsContext,
  openDuesOf,
  postReceiptsTogether,
  receiptsByTransactionPrefix,
  type PostedReceipt,
} from "@/lib/feeTools.server";
import { getServerTenantContext } from "@/lib/serverTenant";

export type BulkRequest = {
  /** The session the office is working in (the signed session cookie's year). */
  academicYearCode: string;
  studentIds: string[];
  strategy: BulkStrategy;
  includeFuture: boolean;
};

export type BulkRecord = {
  id: string;
  payerLabel: string;
  mode: string;
  ref: string;
  collectionDate: string;
  totalPaise: number;
  receipts: { studentId: string; studentName: string; householdId: string; voucherId: string; receiptNo: string; totalPaise: number }[];
  note: string;
  createdBy: string;
  createdAt: string;
};

const BATCH_ID_RE = /^bulk_[a-z0-9]{6,32}$/;

async function childrenFor(req: BulkRequest) {
  const ctx = await loadFeeToolsContext();
  const children: BulkChild[] = [];
  const rows = req.studentIds.map((id) => {
    const s = ctx.sis.students.find((x) => x.id === id);
    if (!s) throw new ApiError("bad_request", "A chosen student is no longer on the roll — reload", 400);
    return s;
  });
  const stale = sessionRowProblem(rows, req.academicYearCode);
  if (stale) throw new ApiError("bad_request", stale, 400);
  for (const s of rows) {
    children.push({
      studentId: s.id,
      studentName: s.fullName,
      householdId: s.householdId || "",
      dues: s.status === "active" ? openDuesOf(s, ctx, req.includeFuture) : [],
    });
  }
  return { ctx, children };
}

export async function previewBulk(req: BulkRequest): Promise<{ plan: BulkPlan; children: BulkChild[] }> {
  const { children } = await childrenFor(req);
  return { plan: planBulkAllocation(children, req.strategy), children };
}

export async function postBulk(
  req: BulkRequest & {
    batchId: string;
    expectedTotalPaise: number;
    /** bulkPlanSignature of the preview the office saw. */
    expectedSignature: string;
    mode: string;
    ref: string;
    instrumentDate: string;
    bankName: string;
    payerLabel: string;
    note: string;
  },
  session: DemoSession,
): Promise<{ record: BulkRecord; duplicate: boolean; warning: string | null }> {
  if (!BATCH_ID_RE.test(req.batchId)) throw new ApiError("bad_request", "Bad batch id — reload and preview again", 400);
  const meta = TENDER_MODES.find((m) => m.value === req.mode);
  if (!meta) throw new ApiError("bad_request", "Choose how the money was paid", 400);
  const ref = req.ref.trim().slice(0, 60);
  if (meta.needsRef && !ref) throw new ApiError("bad_request", `${meta.label}: enter ${meta.refLabel.toLowerCase()}`, 400);
  const payerLabel = req.payerLabel.trim().slice(0, 120);
  if (!payerLabel) throw new ApiError("bad_request", "Say who paid (e.g. the sponsor's name, or 'Staff ward — Oct')", 400);

  const existing = await getBulk(req.batchId);
  if (existing) return { record: existing, duplicate: true, warning: null };

  // Receipts of this batch already made (a retry after the register row
  // failed): never plan again — those dues read paid now. Record them.
  const made = await receiptsByTransactionPrefix(`bulk:${req.batchId}:`);
  if (!made) throw new ApiError("server_error", "Could not check for receipts already made — nothing was posted", 503);

  const { ctx, children } = await childrenFor(req);
  const plan = made.length
    ? ({
        ok: true as const,
        totalPaise: made.reduce((n, m) => n + m.totalPaise, 0),
        skipped: [],
        receipts: made.map((m) => {
          const sid = m.transactionId.slice(`bulk:${req.batchId}:`.length);
          const c = children.find((x) => x.studentId === sid);
          return { studentId: sid, studentName: c?.studentName ?? sid, householdId: m.householdId, lines: [], totalPaise: m.totalPaise, remainingPaise: 0 };
        }),
      } satisfies BulkPlan)
    : planBulkAllocation(children, req.strategy);
  if (!plan.ok) throw new ApiError("bad_request", plan.error, 400);
  if (
    !made.length &&
    (plan.totalPaise !== Math.round(req.expectedTotalPaise) ||
      bulkPlanSignature(plan.receipts) !== req.expectedSignature)
  ) {
    throw new ApiError(
      "bad_request",
      "The dues changed since the preview (someone may have collected at the counter). Nothing was posted — preview again.",
      409,
    );
  }

  const today = istToday();
  const instrumentDate = meta.needsInstrumentDate ? req.instrumentDate.trim() || today : "";
  const { receipts: posted, warning }: { receipts: PostedReceipt[]; warning: string | null } = made.length
    ? {
        receipts: made.map((m) => ({ voucherId: m.id, receiptNo: m.receiptNo, householdId: m.householdId, totalPaise: m.totalPaise, transactionId: m.transactionId, duplicate: true })),
        warning: null,
      }
    : await postReceiptsTogether({
    specs: plan.receipts.map((r) => ({
      householdId: r.householdId,
      lines: r.lines.map(
        (l): VoucherLine => ({
          dueKey: l.dueKey,
          studentId: r.studentId,
          studentName: r.studentName,
          label: l.label,
          kind: l.kind as VoucherLine["kind"],
          amountPaise: l.amountPaise,
        }),
      ),
      tender: { mode: req.mode as TenderMode, ref, instrumentDate, bankName: req.bankName.trim().slice(0, 80) },
      note: [`Bulk payment · ${payerLabel}`, req.note.trim().slice(0, 200)].filter(Boolean).join(" · "),
      transactionId: bulkReceiptTransactionId(req.batchId, r.studentId),
    })),
    mode: req.mode as TenderMode,
    cashierName: session.fullName || "Fee desk",
    academicYearCode: session.academicYearCode,
    collectionDate: today,
    backdatePolicy: ctx.masters?.feeBackdatePolicy,
    mayBackdate: canBackdateReceipt(session, ctx.masters),
  });

  const byTx = new Map(posted.map((p) => [p.transactionId, p]));
  const receipts = plan.receipts.map((r) => {
    const p = byTx.get(bulkReceiptTransactionId(req.batchId, r.studentId));
    return {
      studentId: r.studentId,
      studentName: r.studentName,
      householdId: r.householdId,
      voucherId: p?.voucherId ?? "",
      receiptNo: p?.receiptNo ?? "",
      totalPaise: p?.totalPaise ?? r.totalPaise,
    };
  });
  const record: BulkRecord = {
    id: req.batchId,
    payerLabel,
    mode: req.mode,
    ref,
    collectionDate: today,
    totalPaise: receipts.reduce((n, r) => n + r.totalPaise, 0),
    receipts,
    note: req.note.trim().slice(0, 200),
    createdBy: session.fullName || session.email || "",
    createdAt: new Date().toISOString(),
  };

  // The receipts are the money and are already safe. The batch row is the
  // register entry tying them together; if it fails, say so — the receipts
  // still carry the batch id in their transaction ids.
  const t = await getServerTenantContext();
  const { error } = t
    ? await t.sb.from("fee_bulk_payments").upsert(
        {
          id: record.id,
          tenant_id: t.tenantId,
          payer_label: record.payerLabel,
          mode: record.mode,
          ref: record.ref,
          instrument_date: instrumentDate || null,
          bank_name: req.bankName.trim().slice(0, 80),
          collection_date: record.collectionDate,
          total_paise: record.totalPaise,
          receipts: record.receipts,
          note: record.note,
          created_by: record.createdBy,
        },
        { onConflict: "id", ignoreDuplicates: true },
      )
    : { error: { message: "no tenant" } };
  if (error) {
    console.error("[fee-bulk] batch row not written", record.id, error.message);
    throw new ApiError(
      "server_error",
      `All ${receipts.length} receipts were made (${receipts.map((r) => r.receiptNo).join(", ")}), but the bulk register entry was not saved. Do not collect again.`,
      500,
    );
  }
  return { record, duplicate: false, warning };
}

function fromRow(r: Record<string, unknown>): BulkRecord {
  return {
    id: String(r.id),
    payerLabel: String(r.payer_label ?? ""),
    mode: String(r.mode ?? ""),
    ref: String(r.ref ?? ""),
    collectionDate: String(r.collection_date ?? ""),
    totalPaise: Number(r.total_paise ?? 0),
    receipts: Array.isArray(r.receipts) ? (r.receipts as BulkRecord["receipts"]) : [],
    note: String(r.note ?? ""),
    createdBy: String(r.created_by ?? ""),
    createdAt: String(r.created_at ?? ""),
  };
}

async function getBulk(id: string): Promise<BulkRecord | null> {
  const t = await getServerTenantContext();
  if (!t) throw new ApiError("server_error", "Fee data is unavailable right now", 503);
  const { data, error } = await t.sb
    .from("fee_bulk_payments")
    .select("*")
    .eq("tenant_id", t.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new ApiError("server_error", "Could not read the bulk register", 503);
  return data ? fromRow(data as Record<string, unknown>) : null;
}

/** Most recent bulk payments. null = could not read. */
export async function listBulk(limit = 100): Promise<BulkRecord[] | null> {
  const t = await getServerTenantContext();
  if (!t) return null;
  const { data, error } = await t.sb
    .from("fee_bulk_payments")
    .select("*")
    .eq("tenant_id", t.tenantId)
    .order("created_at", { ascending: false })
    .limit(Math.min(500, limit));
  if (error) return null;
  return (data ?? []).map((r) => fromRow(r as Record<string, unknown>));
}
