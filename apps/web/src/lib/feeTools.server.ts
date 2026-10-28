import "server-only";

/**
 * Server half of Fees → Bulk & PDC: the shared receipt-posting step and the
 * data reads the three tools need.
 *
 * RECEIPTS ARE MADE ONE WAY. `postReceiptsTogether` calls the counter engine
 * (`collectPayment`, the function the desk, the phone counter and pay-link
 * settlement all use) once per receipt, then pushes the fee desk ONCE —
 * `replace_fee_desk_voucher_lines` writes every new header, line and tender
 * in a single transaction, so a bulk payment lands whole or not at all. The
 * ledger is then projected from those rows like any other receipt.
 *
 * Before posting, every receipt is checked (dues still open, amounts within
 * them); if one is refused mid-way, the receipts already made in memory are
 * taken back out of the server's working copy so no later push can carry
 * them. That is a removal from this process's memory by id — never a
 * database delete.
 */

import { ApiError } from "@/lib/api/v1/errors";
import {
  assertFeeBookComplete,
  householdContact,
  istToday,
  loadFeeContext,
} from "@/lib/api/v1/staffFees";
import {
  collectPayment,
  computeStudentDues,
  loadFees,
  openFeeDues,
  writeFeesLocalRaw,
  type CollectionVoucher,
  type FeesState,
  type TenderMode,
  type VoucherLine,
  type VoucherTender,
} from "@/lib/fees";
import { pushFeesRemoteServer } from "@/lib/feesPersistence.server";
import { ANCILLARY_WARNING, decidePostOutcome, type BulkDue } from "@/lib/feeBulkAllocation";
import type { SisStudent } from "@/lib/sis";
import { getServerTenantContext } from "@/lib/serverTenant";

export type FeeToolsContext = Awaited<ReturnType<typeof loadFeeContext>>;

/** Everything needed to price dues and post receipts, read fresh. */
export async function loadFeeToolsContext(): Promise<FeeToolsContext> {
  const ctx = await loadFeeContext();
  // Transport and fee adjustments live outside the school mirror; dues priced
  // without them come out wrong (see paymentSettlement.server.ts, 26 Sep).
  const { ensureFeeDuesInputsHydrated } = await import("@/lib/feeDuesInputs.server");
  await ensureFeeDuesInputsHydrated({ force: true });
  await assertFeeBookComplete(ctx.fees);
  return { sis: ctx.sis, fees: loadFees(), masters: ctx.masters };
}

/** A child's open dues as the counter would show them. */
export function openDuesOf(
  student: SisStudent,
  ctx: FeeToolsContext,
  includeFuture: boolean,
): BulkDue[] {
  return openFeeDues(
    computeStudentDues(student, ctx.masters, ctx.fees, {
      asOf: istToday(),
      includeFuture,
      includePaid: false,
    }),
  )
    .filter((d) => d.balancePaise > 0)
    .map((d) => ({
      dueKey: d.dueKey,
      label: d.label,
      kind: d.kind,
      dueOn: d.dueOn || null,
      balancePaise: d.balancePaise,
    }));
}

export type ReceiptSpec = {
  householdId: string;
  lines: VoucherLine[];
  tender: Omit<VoucherTender, "amountPaise" | "realisation">;
  note: string;
  transactionId: string;
};

export type PostedReceipt = {
  voucherId: string;
  receiptNo: string;
  householdId: string;
  totalPaise: number;
  transactionId: string;
  duplicate: boolean;
};

function withoutVouchers(state: FeesState, ids: Set<string>): FeesState {
  return {
    ...state,
    vouchers: state.vouchers.filter((v) => !ids.has(v.id)),
    cheques: state.cheques.filter((c) => !ids.has(c.voucherId)),
  };
}

async function forgetInMemory(ids: Set<string>): Promise<void> {
  if (!ids.size) return;
  const next = withoutVouchers(loadFees(), ids);
  // On the server this sets the in-memory mirror slice; it pushes nothing.
  writeFeesLocalRaw(next);
}

/** Which of these voucher ids are really in fee_desk_vouchers (null = could not look). */
async function vouchersInDb(ids: string[]): Promise<Set<string> | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const found = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await ctx.sb
      .from("fee_desk_vouchers")
      .select("id")
      .eq("tenant_id", ctx.tenantId)
      .in("id", ids.slice(i, i + 100));
    if (error) return null;
    for (const r of data ?? []) found.add(String((r as { id: string }).id));
  }
  return found;
}

/** Live receipts already carrying one of these transaction ids (retry detection). */
export async function receiptsByTransactionId(
  txIds: string[],
): Promise<Map<string, { id: string; receipt_no: string; household_id: string; total_paise: number }> | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const out = new Map<string, { id: string; receipt_no: string; household_id: string; total_paise: number }>();
  for (let i = 0; i < txIds.length; i += 100) {
    const { data, error } = await ctx.sb
      .from("fee_desk_vouchers")
      .select("id, receipt_no, household_id, total_paise, transaction_id")
      .eq("tenant_id", ctx.tenantId)
      .is("voided_at", null)
      .in("transaction_id", txIds.slice(i, i + 100));
    if (error) return null;
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      out.set(String(r.transaction_id), {
        id: String(r.id),
        receipt_no: String(r.receipt_no ?? ""),
        household_id: String(r.household_id ?? ""),
        total_paise: Number(r.total_paise ?? 0),
      });
    }
  }
  return out;
}

/** Live receipts whose transaction id starts with `prefix` (a bulk batch). null = could not look. */
export async function receiptsByTransactionPrefix(
  prefix: string,
): Promise<{ id: string; receiptNo: string; householdId: string; totalPaise: number; transactionId: string }[] | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data, error } = await ctx.sb
    .from("fee_desk_vouchers")
    .select("id, receipt_no, household_id, total_paise, transaction_id")
    .eq("tenant_id", ctx.tenantId)
    .is("voided_at", null)
    .like("transaction_id", `${prefix.replace(/[%_\\]/g, (c) => `\\${c}`)}%`)
    .limit(500);
  if (error) return null;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    receiptNo: String(r.receipt_no ?? ""),
    householdId: String(r.household_id ?? ""),
    totalPaise: Number(r.total_paise ?? 0),
    transactionId: String(r.transaction_id ?? ""),
  }));
}

/**
 * Make several receipts and write them in ONE fee-desk transaction.
 * Receipts whose transaction id is already in the desk are returned as
 * duplicates and not made again.
 */
export async function postReceiptsTogether(input: {
  specs: ReceiptSpec[];
  mode: TenderMode;
  cashierName: string;
  academicYearCode: string;
  collectionDate: string;
  backdatePolicy: FeeToolsContext["masters"]["feeBackdatePolicy"] | undefined;
  mayBackdate: boolean;
}): Promise<{ receipts: PostedReceipt[]; warning: string | null }> {
  const already = await receiptsByTransactionId(input.specs.map((s) => s.transactionId));
  if (!already) throw new ApiError("server_error", "Could not check for receipts already made — nothing was posted", 503);
  // Also the server's own working copy (a receipt made but not yet pushed).
  const memory = new Map(
    loadFees()
      .vouchers.filter((v) => !v.voidedAt && v.transactionId)
      .map((v) => [v.transactionId, v] as const),
  );

  const made: CollectionVoucher[] = [];
  const results: PostedReceipt[] = [];
  const today = istToday();
  for (const spec of input.specs) {
    const prior = already.get(spec.transactionId);
    if (prior) {
      results.push({
        voucherId: prior.id,
        receiptNo: prior.receipt_no,
        householdId: prior.household_id,
        totalPaise: prior.total_paise,
        transactionId: spec.transactionId,
        duplicate: true,
      });
      continue;
    }
    const total = spec.lines.reduce((n, l) => n + l.amountPaise, 0);
    const mem = memory.get(spec.transactionId);
    if (mem) {
      // Made earlier on this instance but never confirmed in the desk: push it
      // with the rest rather than making a second one.
      made.push(mem);
      results.push({
        voucherId: mem.id,
        receiptNo: mem.receiptNo,
        householdId: mem.householdId,
        totalPaise: mem.totalPaise,
        transactionId: spec.transactionId,
        duplicate: false,
      });
      continue;
    }
    const r = collectPayment({
      householdId: spec.householdId,
      lines: spec.lines,
      tenders: [
        {
          ...spec.tender,
          amountPaise: total,
          realisation: input.mode === "cheque" ? "subject_to_clearance" : "cleared",
        },
      ],
      cashierName: input.cashierName,
      note: spec.note,
      academicYearCode: input.academicYearCode,
      collectionDate: input.collectionDate,
      transactionDate: input.collectionDate,
      transactionId: spec.transactionId,
      backdatePolicy: input.backdatePolicy,
      mayBackdate: input.mayBackdate,
      todayIsoOverride: today,
      source: "counter",
      receiptSeries: "F",
    });
    if (!r.ok) {
      await forgetInMemory(new Set(made.filter((v) => !memory.has(v.transactionId)).map((v) => v.id)));
      throw new ApiError("bad_request", `Nothing was posted — ${r.error}`, 400);
    }
    made.push(r.voucher);
    results.push({
      voucherId: r.voucher.id,
      receiptNo: r.voucher.receiptNo,
      householdId: r.voucher.householdId,
      totalPaise: r.voucher.totalPaise,
      transactionId: spec.transactionId,
      duplicate: false,
    });
  }

  if (made.length === 0) return { receipts: results, warning: null };

  const pushed = await pushFeesRemoteServer(loadFees());
  const stored = pushed.ok ? await vouchersInDb(made.map((v) => v.id)) : null;
  if (pushed.ok && stored && made.every((v) => stored.has(v.id))) {
    return { receipts: results, warning: null };
  }

  // Something did not go cleanly. Ask the desk what is actually there, by the
  // transaction ids this call was asked for (another instance may have won).
  const now = await receiptsByTransactionId(input.specs.map((s) => s.transactionId));
  const ours = new Set(made.map((v) => v.id));
  const allLive = now ? input.specs.every((sp) => now.has(sp.transactionId)) : null;
  const landed = await vouchersInDb([...ours]);
  const outcome = decidePostOutcome({
    pushOk: pushed.ok,
    allLive,
    noneLanded: landed ? [...ours].every((id) => !landed.has(id)) : null,
  });

  if (outcome.kind === "ok" && now) {
    // Copies of ours that are NOT the live receipts (we lost a race): out of
    // memory, so no later push carries a duplicate.
    const liveIds = new Set(input.specs.map((sp) => now.get(sp.transactionId)!.id));
    const losers = new Set([...ours].filter((id) => !liveIds.has(id)));
    if (losers.size) await dropAndRehydrate(losers);
    let warning: string | null = null;
    if (outcome.retryPush) {
      // The receipts are in; the cheque register / open-dues rebuild behind
      // them failed. Once more, then say so.
      const retry = await pushFeesRemoteServer(loadFees());
      if (!retry.ok) {
        console.error("[fee-tools] receipts saved but ancillary push failed twice", retry.error);
        warning = ANCILLARY_WARNING;
      }
    }
    return {
      receipts: input.specs.map((sp) => {
        const t = now.get(sp.transactionId)!;
        return {
          voucherId: t.id,
          receiptNo: t.receipt_no,
          householdId: t.household_id,
          totalPaise: t.total_paise,
          transactionId: sp.transactionId,
          duplicate: !ours.has(t.id),
        };
      }),
      warning,
    };
  }

  // Not confirmed: never leave these copies in this instance's memory.
  await dropAndRehydrate(ours);
  if (outcome.kind === "not_saved") {
    throw new ApiError(
      "server_error",
      `The receipts could not be saved — nothing was posted. ${pushed.error ?? ""}`.trim(),
      503,
    );
  }
  console.error("[fee-tools] receipt push uncertain", { pushOk: pushed.ok, error: pushed.error });
  throw new ApiError(
    "server_error",
    "The receipts may or may not have been saved — check Fees → Receipts before trying again (a retry will not make a second receipt)",
    503,
  );
}

/** Forget these vouchers in this instance's memory, then re-read the fee desk from the database. */
async function dropAndRehydrate(ids: Set<string>): Promise<void> {
  await forgetInMemory(ids);
  try {
    const { ensureFeesHydratedServer } = await import("@/lib/feesPersistence.server");
    await ensureFeesHydratedServer();
  } catch (e) {
    console.warn("[fee-tools] fee desk re-read after a failed post did not complete", e instanceof Error ? e.message : e);
  }
}

export { householdContact, istToday };

/** The tools' routes answer { ok:false, error } with the error's own status. */
export function toolsErrorResponse(e: unknown): Response {
  if (e instanceof ApiError) {
    return Response.json({ ok: false, error: e.message }, { status: e.status });
  }
  console.error("[fee-tools]", e);
  return Response.json({ ok: false, error: "Something went wrong on the server — reload and check before trying again" }, { status: 500 });
}
