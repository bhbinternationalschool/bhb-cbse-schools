/**
 * Fee collection vouchers — Supabase normalized tables (fee_desk_*).
 * Server-only. Text ids match desk CollectionVoucher ids.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CollectionVoucher,
  FeesState,
  TenderMode,
  VoucherLine,
  VoucherTender,
} from "@/lib/fees";
import {
  fetchFeeDeskAncillaryFromDb,
  pushFeeDeskAncillaryToDb,
  rebuildFeeOpenDuesCache,
  type FeeDeskAncillary,
} from "@/lib/feesDeskAncillary.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { feesDualWriteDbEnabled } from "@/lib/feesDbConfig";

export type FeeDeskSyncMeta = {
  voucherCount: number;
  lastCollectedAt: string | null;
  updatedAt: string;
  chequeCount?: number;
  chargeVoucherCount?: number;
  openDuesCount?: number;
  ancillaryUpdatedAt?: string | null;
};

function mapLineKind(kind: string): string {
  if (kind === "store") return "store_sale";
  if (kind === "transport" || kind === "special" || kind === "academic") {
    return kind;
  }
  return "academic";
}

function unmapLineKind(kind: string, original?: string): VoucherLine["kind"] {
  if (original) return original as VoucherLine["kind"];
  if (kind === "store_sale") return "store";
  return kind as VoucherLine["kind"];
}

function voucherToRows(
  tenantId: string,
  v: CollectionVoucher,
): {
  header: Record<string, unknown>;
  lines: Record<string, unknown>[];
  tenders: Record<string, unknown>[];
} {
  const header = {
    id: v.id,
    tenant_id: tenantId,
    household_id: v.householdId || null,
    academic_year_code: v.academicYearCode,
    receipt_no: v.receiptNo,
    school_receipt_no: v.schoolReceiptNo || "",
    source: v.source || "counter",
    manual_book_series: v.manualBookSeries || "",
    manual_book_leaf: v.manualBookLeaf || "",
    collection_date: v.collectionDate,
    transaction_date: v.transactionDate || v.collectionDate,
    transaction_id: v.transactionId || "",
    collected_at: v.collectedAt || new Date().toISOString(),
    cashier_name: v.cashierName || "",
    total_paise: v.totalPaise,
    note: v.note || "",
    voided_at: v.voidedAt,
    whatsapp_sent_at: v.whatsappSentAt,
    voucher_json: {
      source: v.source,
      manualBookSeries: v.manualBookSeries,
      manualBookLeaf: v.manualBookLeaf,
    },
    updated_at: new Date().toISOString(),
  };

  const lines = (v.lines || []).map((line) => ({
    id: `${v.id}:${line.dueKey}`,
    voucher_id: v.id,
    tenant_id: tenantId,
    student_id: line.studentId,
    due_key: line.dueKey,
    kind: mapLineKind(line.kind),
    label: line.label,
    amount_paise: line.amountPaise,
    line_json: {
      studentName: line.studentName,
      kind: line.kind,
      billedPaise: line.billedPaise,
      concessionPaise: line.concessionPaise,
      concessionDetails: line.concessionDetails,
      storeIssueNo: line.storeIssueNo,
      storeItems: line.storeItems,
      transport: line.transport,
    },
  }));

  const tenders = (v.tenders || []).map((t, idx) => ({
    id: `${v.id}:t${idx}`,
    voucher_id: v.id,
    tenant_id: tenantId,
    tender_index: idx,
    mode: t.mode,
    amount_paise: t.amountPaise,
    ref: t.ref || "",
    instrument_date: t.instrumentDate || null,
    bank_name: t.bankName || "",
    realisation: t.realisation || "cleared",
    tender_json: {
      bankAccountId: t.bankAccountId,
    },
  }));

  return { header, lines, tenders };
}

function rowToVoucher(
  header: Record<string, unknown>,
  lineRows: Record<string, unknown>[],
  tenderRows: Record<string, unknown>[],
): CollectionVoucher {
  const lines: VoucherLine[] = lineRows
    .sort((a, b) =>
      String(a.due_key).localeCompare(String(b.due_key)),
    )
    .map((row) => {
      const lj = (row.line_json as Record<string, unknown>) || {};
      return {
        dueKey: String(row.due_key),
        studentId: String(row.student_id),
        studentName: String(lj.studentName || ""),
        label: String(row.label || ""),
        kind: unmapLineKind(String(row.kind), String(lj.kind || "")),
        amountPaise: Number(row.amount_paise) || 0,
        billedPaise: lj.billedPaise as number | undefined,
        concessionPaise: lj.concessionPaise as number | undefined,
        concessionDetails: lj.concessionDetails as VoucherLine["concessionDetails"],
        storeIssueNo: lj.storeIssueNo as string | undefined,
        storeItems: lj.storeItems as VoucherLine["storeItems"],
        transport: lj.transport as VoucherLine["transport"],
      };
    });

  const tenders: VoucherTender[] = tenderRows
    .sort(
      (a, b) =>
        Number(a.tender_index) - Number(b.tender_index),
    )
    .map((row) => {
      const tj = (row.tender_json as Record<string, unknown>) || {};
      return {
        mode: String(row.mode) as TenderMode,
        amountPaise: Number(row.amount_paise) || 0,
        ref: String(row.ref || ""),
        instrumentDate: String(row.instrument_date || "").slice(0, 10),
        bankName: String(row.bank_name || ""),
        bankAccountId: tj.bankAccountId as string | undefined,
        realisation:
          (row.realisation as VoucherTender["realisation"]) || "cleared",
      };
    });

  return {
    id: String(header.id),
    receiptNo: String(header.receipt_no),
    schoolReceiptNo: String(header.school_receipt_no || ""),
    source: (header.source as CollectionVoucher["source"]) || "counter",
    manualBookSeries: String(header.manual_book_series || ""),
    manualBookLeaf: String(header.manual_book_leaf || ""),
    householdId: String(header.household_id || ""),
    academicYearCode: String(header.academic_year_code),
    collectionDate: String(header.collection_date).slice(0, 10),
    transactionDate: String(header.transaction_date).slice(0, 10),
    transactionId: String(header.transaction_id || ""),
    collectedAt: String(header.collected_at),
    cashierName: String(header.cashier_name || ""),
    lines,
    tenders,
    totalPaise: Number(header.total_paise) || 0,
    note: String(header.note || ""),
    voidedAt: (header.voided_at as string | null) ?? null,
    whatsappSentAt: (header.whatsapp_sent_at as string | null) ?? null,
  };
}

export { feesDualWriteDbEnabled, feesReadFromDbEnabled } from "@/lib/feesDbConfig";

const FEE_DESK_META_SELECT =
  "voucher_count, last_collected_at, updated_at, cheque_count, charge_voucher_count, open_dues_count, ancillary_updated_at";

function mapFeeDeskMetaRow(
  metaRow: Record<string, unknown> | null,
): FeeDeskSyncMeta | null {
  if (!metaRow) return null;
  return {
    voucherCount: metaRow.voucher_count as number,
    lastCollectedAt: metaRow.last_collected_at as string | null,
    updatedAt: String(metaRow.updated_at),
    chequeCount: metaRow.cheque_count as number | undefined,
    chargeVoucherCount: metaRow.charge_voucher_count as number | undefined,
    openDuesCount: metaRow.open_dues_count as number | undefined,
    ancillaryUpdatedAt: metaRow.ancillary_updated_at as string | null,
  };
}

async function resolveCtx(): Promise<{
  sb: SupabaseClient;
  tenantId: string;
} | null> {
  return getServerTenantContext();
}

/** Upsert all vouchers (full desk snapshot). */
export async function pushFeeVouchersToDb(
  vouchers: CollectionVoucher[],
): Promise<{ ok: boolean; count: number; error?: string }> {
  if (!feesDualWriteDbEnabled()) {
    return { ok: true, count: 0 };
  }
  const ctx = await resolveCtx();
  if (!ctx) {
    return { ok: false, count: 0, error: "Supabase tenant not configured" };
  }
  const { sb, tenantId } = ctx;

  const active = vouchers.filter((v) => v.id && v.receiptNo);
  const ids = active.map((v) => v.id);
  const idSet = new Set(ids);

  const { data: existingHeaders } = await sb
    .from("fee_desk_vouchers")
    .select("id")
    .eq("tenant_id", tenantId);
  const staleIds = (existingHeaders ?? [])
    .map((r) => String(r.id))
    .filter((id) => !idSet.has(id));
  // NEVER deleted. A fee receipt is append-only — voiding keeps the row — so
  // a server voucher the pushing browser doesn't know can only mean that
  // browser is unhydrated or partially hydrated. Deleting here is how eight
  // receipts (RCV-00001..08) vanished on 2026-08-26: a freshly-logged-in
  // browser holding two receipts pushed, and the prune took the rest with
  // it. The server keeps everything; hydration merges the union back down.
  if (staleIds.length > 0) {
    console.warn(
      `[fees-desk] push omitted ${staleIds.length} voucher(s) the server holds — keeping them (append-only receipts)`,
    );
  }

  if (ids.length > 0) {
    const { error: delLines } = await sb
      .from("fee_desk_voucher_lines")
      .delete()
      .eq("tenant_id", tenantId)
      .in("voucher_id", ids);
    if (delLines) {
      return { ok: false, count: 0, error: delLines.message };
    }
    const { error: delTenders } = await sb
      .from("fee_desk_voucher_tenders")
      .delete()
      .eq("tenant_id", tenantId)
      .in("voucher_id", ids);
    if (delTenders) {
      return { ok: false, count: 0, error: delTenders.message };
    }
  }

  const allLines: Record<string, unknown>[] = [];
  const allTenders: Record<string, unknown>[] = [];
  const headers: Record<string, unknown>[] = [];

  for (const v of active) {
    const { header, lines, tenders } = voucherToRows(tenantId, v);
    headers.push(header);
    allLines.push(...lines);
    allTenders.push(...tenders);
  }

  if (headers.length) {
    const { error: hErr } = await sb
      .from("fee_desk_vouchers")
      .upsert(headers, { onConflict: "id" });
    if (hErr) return { ok: false, count: 0, error: hErr.message };
  }

  if (allLines.length) {
    const { error: lErr } = await sb
      .from("fee_desk_voucher_lines")
      .upsert(allLines, { onConflict: "id" });
    if (lErr) return { ok: false, count: 0, error: lErr.message };
  }

  if (allTenders.length) {
    const { error: tErr } = await sb
      .from("fee_desk_voucher_tenders")
      .upsert(allTenders, { onConflict: "id" });
    if (tErr) return { ok: false, count: 0, error: tErr.message };
  }

  const lastCollected = active
    .map((v) => v.collectedAt)
    .filter(Boolean)
    .sort()
    .pop();

  const now = new Date().toISOString();
  await sb.from("fee_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      voucher_count: active.length,
      last_collected_at: lastCollected || null,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true, count: active.length };
}

export async function fetchFeeVouchersFromDb(): Promise<{
  vouchers: CollectionVoucher[];
  meta: FeeDeskSyncMeta | null;
  /** false = tenant/query could not be resolved; result is NOT a confirmed empty state. */
  ok: boolean;
}> {
  const ctx = await resolveCtx();
  if (!ctx) return { vouchers: [], meta: null, ok: false };
  const { sb, tenantId } = ctx;

  const { data: headers, error: hErr } = await sb
    .from("fee_desk_vouchers")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("collected_at", { ascending: false });

  if (hErr) {
    console.warn("[fees-db] fetch failed", hErr.message);
    return { vouchers: [], meta: null, ok: false };
  }

  if (!headers?.length) {
    const { data: metaRow, error: metaErr } = await sb
      .from("fee_desk_sync_meta")
      .select(FEE_DESK_META_SELECT)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (metaErr) {
      console.warn("[fees-db] meta fetch failed", metaErr.message);
      return { vouchers: [], meta: null, ok: false };
    }
    return {
      vouchers: [],
      meta: mapFeeDeskMetaRow(metaRow as Record<string, unknown> | null),
      ok: true,
    };
  }

  const ids = headers.map((h) => h.id as string);

  const [
    { data: lineRows, error: lErr },
    { data: tenderRows, error: tErr },
    { data: metaRow, error: metaErr },
  ] = await Promise.all([
    sb
      .from("fee_desk_voucher_lines")
      .select("*")
      .eq("tenant_id", tenantId)
      .in("voucher_id", ids),
    sb
      .from("fee_desk_voucher_tenders")
      .select("*")
      .eq("tenant_id", tenantId)
      .in("voucher_id", ids),
    sb
      .from("fee_desk_sync_meta")
      .select(FEE_DESK_META_SELECT)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  if (lErr || tErr || metaErr) {
    console.warn(
      "[fees-db] fetch failed",
      lErr?.message,
      tErr?.message,
      metaErr?.message,
    );
    return { vouchers: [], meta: null, ok: false };
  }

  const linesByVoucher = new Map<string, Record<string, unknown>[]>();
  for (const row of lineRows ?? []) {
    const vid = String(row.voucher_id);
    const list = linesByVoucher.get(vid) ?? [];
    list.push(row as Record<string, unknown>);
    linesByVoucher.set(vid, list);
  }

  const tendersByVoucher = new Map<string, Record<string, unknown>[]>();
  for (const row of tenderRows ?? []) {
    const vid = String(row.voucher_id);
    const list = tendersByVoucher.get(vid) ?? [];
    list.push(row as Record<string, unknown>);
    tendersByVoucher.set(vid, list);
  }

  const vouchers = headers.map((h) =>
    rowToVoucher(
      h as Record<string, unknown>,
      linesByVoucher.get(String(h.id)) ?? [],
      tendersByVoucher.get(String(h.id)) ?? [],
    ),
  );

  return {
    vouchers,
    meta: mapFeeDeskMetaRow(metaRow as Record<string, unknown> | null),
    ok: true,
  };
}

export type FeeDeskSnapshot = {
  vouchers: CollectionVoucher[];
  ancillary: FeeDeskAncillary;
  meta: FeeDeskSyncMeta | null;
  /** false = tenant/query could not be resolved; result is NOT a confirmed empty state. */
  ok: boolean;
};

/** Push full fee desk (vouchers + ancillary) and rebuild open dues cache. */
export async function pushFeeDeskToDb(
  state: Pick<FeesState, "vouchers"> & FeeDeskAncillary,
  opts?: { academicYearCode?: string; rebuildOpenDues?: boolean },
): Promise<{ ok: boolean; error?: string; voucherCount: number; openDuesCount?: number }> {
  const voucherResult = await pushFeeVouchersToDb(state.vouchers ?? []);
  if (!voucherResult.ok) {
    return {
      ok: false,
      error: voucherResult.error,
      voucherCount: 0,
    };
  }

  const ancillaryResult = await pushFeeDeskAncillaryToDb({
    cheques: state.cheques ?? [],
    manualBooks: state.manualBooks ?? [],
    dayCloses: state.dayCloses ?? [],
    installmentPlans: state.installmentPlans ?? [],
    planAllocations: state.planAllocations ?? [],
    carriedForwardDues: state.carriedForwardDues ?? [],
    chargeVouchers: state.chargeVouchers ?? [],
  });
  if (!ancillaryResult.ok) {
    return {
      ok: false,
      error: ancillaryResult.error,
      voucherCount: voucherResult.count,
    };
  }

  let openDuesCount: number | undefined;
  // No academic year to scope the rebuild to is "unknown", not "2025-26":
  // a guessed year rebuilt (and pruned) the wrong year's dues cache. Skip.
  const ay = opts?.academicYearCode || state.vouchers[0]?.academicYearCode || "";
  if (opts?.rebuildOpenDues !== false && ay) {
    const dues = await rebuildFeeOpenDuesCache(ay);
    if (!dues.ok) {
      return {
        ok: false,
        error: dues.error,
        voucherCount: voucherResult.count,
      };
    }
    openDuesCount = dues.count;
  }

  return { ok: true, voucherCount: voucherResult.count, openDuesCount };
}

export async function fetchFeeDeskFromDb(): Promise<FeeDeskSnapshot> {
  const [{ vouchers, meta, ok }, ancillary] = await Promise.all([
    fetchFeeVouchersFromDb(),
    fetchFeeDeskAncillaryFromDb(),
  ]);
  return { vouchers, ancillary, meta, ok };
}
