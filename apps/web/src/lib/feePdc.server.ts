import "server-only";

/**
 * Post-dated cheque register — storage and the deposit step
 * (table fee_pdc_cheques; rules in lib/feePdc.ts).
 *
 * Deposit order, and why it is safe to retry at any point:
 *   1. claim the row (fee_pdc_claim_deposit) — one cashier at a time;
 *   2. make the receipt through the counter engine, transaction id
 *      'pdc:<id>' — a retry finds that receipt instead of making another;
 *   3. fee_pdc_mark_deposited — links the row, and refuses unless that
 *      receipt really is in the fee desk.
 * A failure after 2 leaves a receipt and a held row; pressing Deposit again
 * goes straight to 3.
 */

import { ApiError } from "@/lib/api/v1/errors";
import { newId } from "@/lib/masters";
import { canBackdateReceipt } from "@/lib/rbac";
import type { DemoSession } from "@/lib/auth";
import {
  canClosePdc,
  canDepositPdc,
  pdcInputProblem,
  pdcReceiptTransactionId,
  planPdcDeposit,
  type PdcInput,
  type PdcIntendedLine,
  type PdcRecord,
  type PdcStatus,
} from "@/lib/feePdc";
import {
  householdContact,
  istToday,
  loadFeeToolsContext,
  openDuesOf,
  postReceiptsTogether,
  receiptsByTransactionId,
} from "@/lib/feeTools.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { fetchAllPages } from "@/lib/supabase/pageAll";
import type { BulkDue } from "@/lib/feeBulkAllocation";
import type { VoucherLine } from "@/lib/fees";

type Row = Record<string, unknown>;

function fromRow(r: Row): PdcRecord {
  return {
    id: String(r.id),
    householdId: String(r.household_id ?? ""),
    guardianName: String(r.guardian_name ?? ""),
    chequeNo: String(r.cheque_no ?? ""),
    bankName: String(r.bank_name ?? ""),
    chequeDate: String(r.cheque_date ?? ""),
    amountPaise: Number(r.amount_paise ?? 0),
    receivedOn: String(r.received_on ?? ""),
    intended: Array.isArray(r.intended) ? (r.intended as PdcIntendedLine[]) : [],
    status: String(r.status ?? "held") as PdcStatus,
    statusReason: String(r.status_reason ?? ""),
    voucherId: String(r.voucher_id ?? ""),
    receiptNo: String(r.receipt_no ?? ""),
    note: String(r.note ?? ""),
    createdBy: String(r.created_by ?? ""),
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
  };
}

async function tenant() {
  const ctx = await getServerTenantContext();
  if (!ctx) throw new ApiError("server_error", "Fee data is unavailable right now", 503);
  return ctx;
}

/** Every PDC (paged — the register only grows). null = could not read. */
export async function listPdcs(): Promise<PdcRecord[] | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { rows, error } = await fetchAllPages<Row>((from, to) =>
    ctx.sb
      .from("fee_pdc_cheques")
      .select("*")
      .eq("tenant_id", ctx.tenantId)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (error) return null;
  return rows.map(fromRow);
}

async function getPdc(id: string): Promise<PdcRecord | null> {
  const ctx = await tenant();
  const { data, error } = await ctx.sb
    .from("fee_pdc_cheques")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new ApiError("server_error", "Could not read the cheque", 503);
  return data ? fromRow(data as Row) : null;
}

/** Bounced desk cheques (receipts voided by a bounce) — for the bounced report. */
export async function listBouncedDeskCheques(): Promise<
  { id: string; chequeNo: string; bankName: string; chequeDate: string; amountPaise: number; receiptNo: string; householdId: string; bouncedAt: string; reason: string }[] | null
> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { rows, error } = await fetchAllPages<Row>((from, to) =>
    ctx.sb
      .from("fee_desk_cheques")
      .select("id, cheque_no, bank_name, cheque_date, amount_paise, receipt_no, household_id, bounced_at, bounce_reason")
      .eq("tenant_id", ctx.tenantId)
      .eq("status", "bounced")
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (error) return null;
  return rows.map((r) => ({
    id: String(r.id),
    chequeNo: String(r.cheque_no ?? ""),
    bankName: String(r.bank_name ?? ""),
    chequeDate: String(r.cheque_date ?? ""),
    amountPaise: Number(r.amount_paise ?? 0),
    receiptNo: String(r.receipt_no ?? ""),
    householdId: String(r.household_id ?? ""),
    bouncedAt: String(r.bounced_at ?? ""),
    reason: String(r.bounce_reason ?? ""),
  }));
}

export async function createPdc(input: PdcInput & { note: string }, by: string, ay: string): Promise<PdcRecord> {
  const fctx = await loadFeeToolsContext();
  // This session's rows only: a child carried across years has one row per
  // year, and the old one's dues are not what this cheque is for.
  const kids = fctx.sis.students.filter(
    (s) => s.householdId === input.householdId && s.status === "active" && s.academicYearCode === ay,
  );
  if (!kids.length) throw new ApiError("bad_request", "No active children in this family", 400);
  // Future dues count: a PDC is usually for months not yet billed.
  const open = new Map<string, number>();
  const nameOf = new Map<string, string>();
  for (const s of kids) {
    nameOf.set(s.id, s.fullName);
    for (const d of openDuesOf(s, fctx, true)) open.set(`${s.id}|${d.dueKey}`, d.balancePaise);
  }
  const intended = input.intended.map((l) => ({
    ...l,
    studentName: nameOf.get(l.studentId) || l.studentName,
    amountPaise: Math.round(l.amountPaise),
  }));
  const problem = pdcInputProblem({ ...input, intended }, istToday(), open);
  if (problem) throw new ApiError("bad_request", problem, 400);

  const ctx = await tenant();
  const row = {
    id: newId("pdc"),
    tenant_id: ctx.tenantId,
    household_id: input.householdId,
    guardian_name: householdContact(fctx.sis, input.householdId).guardianName,
    cheque_no: input.chequeNo.trim(),
    bank_name: input.bankName.trim(),
    cheque_date: input.chequeDate,
    amount_paise: Math.round(input.amountPaise),
    received_on: input.receivedOn,
    intended,
    status: "held",
    note: input.note.trim().slice(0, 300),
    created_by: by,
  };
  const { data, error } = await ctx.sb.from("fee_pdc_cheques").insert(row).select("*").single();
  if (error) {
    if (error.code === "23505") {
      throw new ApiError("bad_request", `Cheque ${row.cheque_no} on ${row.bank_name} is already in the register`, 409);
    }
    throw new ApiError("server_error", `The cheque was not saved: ${error.message}`, 500);
  }
  return fromRow(data as Row);
}

export async function depositPdc(
  id: string,
  opts: { session: DemoSession },
): Promise<{ pdc: PdcRecord; receiptNo: string; voucherId: string; movedPaise: number }> {
  const ctx = await tenant();
  const pdc = await getPdc(id);
  if (!pdc) throw new ApiError("not_found", "No such cheque", 404);
  const today = istToday();
  const why = canDepositPdc(pdc, today);
  if (why) throw new ApiError("bad_request", why, 400);

  const { data: claimed, error: claimErr } = await ctx.sb.rpc("fee_pdc_claim_deposit", {
    p_tenant_id: ctx.tenantId,
    p_id: id,
  });
  if (claimErr) throw new ApiError("server_error", `Could not start the deposit: ${claimErr.message}`, 503);
  if (claimed !== true) {
    throw new ApiError("bad_request", "Someone else is depositing this cheque right now — wait a minute and reload", 409);
  }

  const release = async () => {
    await ctx.sb
      .from("fee_pdc_cheques")
      .update({ deposit_claimed_at: null })
      .eq("tenant_id", ctx.tenantId)
      .eq("id", id)
      .eq("status", "held");
  };

  let posted: { voucherId: string; receiptNo: string };
  let movedPaise = 0;
  try {
    // A deposit that made its receipt but died before linking it: link that
    // receipt now. Planning again would see the dues already paid by it.
    const prior = await receiptsByTransactionId([pdcReceiptTransactionId(pdc.id)]);
    if (!prior) throw new ApiError("server_error", "Could not check for an earlier deposit receipt — nothing was posted", 503);
    const earlier = prior.get(pdcReceiptTransactionId(pdc.id));
    if (earlier) {
      posted = { voucherId: earlier.id, receiptNo: earlier.receipt_no };
    } else {
      const made = await postPdcReceipt(pdc, opts, today);
      posted = { voucherId: made.voucherId, receiptNo: made.receiptNo };
      movedPaise = made.movedPaise;
    }
  } catch (e) {
    await release();
    throw e;
  }

  const { data: mark, error: markErr } = await ctx.sb.rpc("fee_pdc_mark_deposited", {
    p_tenant_id: ctx.tenantId,
    p_id: id,
    p_voucher_id: posted.voucherId,
    p_by: opts.session.fullName || opts.session.email || "fee desk",
  });
  const res = (mark ?? {}) as { ok?: boolean; error?: string };
  if (markErr || !res.ok) {
    await release();
    throw new ApiError(
      "server_error",
      `Receipt ${posted.receiptNo} was made, but the cheque could not be marked deposited (${markErr?.message || res.error}). Press Deposit again — it will link the same receipt, not make another.`,
      503,
    );
  }
  const after = await getPdc(id);
  return { pdc: after ?? pdc, receiptNo: posted.receiptNo, voucherId: posted.voucherId, movedPaise };
}

export async function closePdc(
  id: string,
  to: "bounced" | "returned" | "cancelled",
  reason: string,
  by: string,
): Promise<PdcRecord> {
  const ctx = await tenant();
  const pdc = await getPdc(id);
  if (!pdc) throw new ApiError("not_found", "No such cheque", 404);
  const why = canClosePdc(pdc, to, reason);
  if (why) throw new ApiError("bad_request", why, 400);
  // Conditional on still being held and not mid-deposit: a cheque being
  // turned into a receipt this minute cannot also be returned.
  const { data, error } = await ctx.sb
    .from("fee_pdc_cheques")
    .update({
      status: to,
      status_reason: reason.trim().slice(0, 300),
      status_by: by,
      status_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .eq("status", "held")
    .or(`deposit_claimed_at.is.null,deposit_claimed_at.lt.${new Date(Date.now() - 120_000).toISOString()}`)
    .select("*");
  if (error) throw new ApiError("server_error", `Not saved: ${error.message}`, 500);
  if (!data || data.length !== 1) {
    throw new ApiError("bad_request", "This cheque changed (deposited or closed) a moment ago — reload", 409);
  }
  return fromRow(data[0] as Row);
}

/** Step 2 of a deposit: the cheque receipt, from the dues as they stand now. */
async function postPdcReceipt(
  pdc: PdcRecord,
  opts: { session: DemoSession },
  today: string,
): Promise<{ voucherId: string; receiptNo: string; movedPaise: number }> {
  const fctx = await loadFeeToolsContext();
  const live = new Map<string, BulkDue[]>();
  const names = new Map<string, string>();
  for (const s of fctx.sis.students) {
    if (s.householdId !== pdc.householdId || s.status !== "active") continue;
    if (s.academicYearCode !== opts.session.academicYearCode) continue;
    names.set(s.id, s.fullName);
    live.set(s.id, openDuesOf(s, fctx, true));
  }
  const plan = planPdcDeposit(pdc, live);
  if (!plan.ok) throw new ApiError("bad_request", plan.error, 400);
  const [receipt] = await postReceiptsTogether({
    specs: [
      {
        householdId: pdc.householdId,
        lines: plan.lines.map((l) => ({
          dueKey: l.dueKey,
          studentId: l.studentId,
          studentName: names.get(l.studentId) || l.studentId,
          label: l.label,
          kind: l.kind as VoucherLine["kind"],
          amountPaise: l.amountPaise,
        })),
        tender: {
          mode: "cheque",
          ref: pdc.chequeNo,
          instrumentDate: pdc.chequeDate,
          bankName: pdc.bankName,
        },
        note: [`Post-dated cheque received ${pdc.receivedOn}`, pdc.note].filter(Boolean).join(" · "),
        transactionId: pdcReceiptTransactionId(pdc.id),
      },
    ],
    mode: "cheque",
    cashierName: opts.session.fullName || "Fee desk",
    academicYearCode: opts.session.academicYearCode,
    collectionDate: today,
    backdatePolicy: fctx.masters?.feeBackdatePolicy,
    mayBackdate: canBackdateReceipt(opts.session, fctx.masters),
  });
  if (!receipt) throw new ApiError("server_error", "No receipt was made", 500);
  return { voucherId: receipt.voucherId, receiptNo: receipt.receiptNo, movedPaise: plan.movedPaise };
}
