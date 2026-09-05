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
import { fetchAllPages } from "@/lib/supabase/pageAll";

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
      gatewayProvider: t.gatewayProvider || "",
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
        gatewayProvider: (tj.gatewayProvider as string | undefined) || "",
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

/**
 * The vouchers a push may safely REPLACE the lines of.
 *
 * Only those it actually carries lines for. A push that says nothing about a
 * voucher's lines is a browser that does not know them — unhydrated, or
 * hydrated with headers before lines arrived — not a receipt that has none.
 *
 * Exported so the rule can be tested. It is one `.filter`, but it is the one
 * that cost 134 receipts their lines on 2026-09-01: 5,80,543 of collections
 * showing a guardian and an amount with no student, no head and no month,
 * and every month those families had paid reading unpaid again.
 */
export function voucherIdsCarryingLines(
  vouchers: Pick<CollectionVoucher, "id" | "lines">[],
): string[] {
  return vouchers
    .filter((v) => Array.isArray(v.lines) && v.lines.length > 0)
    .map((v) => v.id);
}

/** The same rule for tenders — a push without them must not erase them. */
export function voucherIdsCarryingTenders(
  vouchers: Pick<CollectionVoucher, "id" | "tenders">[],
): string[] {
  return vouchers
    .filter((v) => Array.isArray(v.tenders) && v.tenders.length > 0)
    .map((v) => v.id);
}

/**
 * Every row, not the first thousand.
 *
 * PostgREST caps an unbounded select at its configured maximum — 1000 here —
 * and returns the truncation as a perfectly ordinary success. Reading fee
 * lines that way meant receipts beyond the cap hydrated with NO LINES, and a
 * browser holding that state then pushed it back: on 2026-09-01, with 1048
 * lines in the table, 134 receipts lost theirs outright.
 *
 * The push no longer deletes what it was not given, so the damage is stopped.
 * This stops the CAUSE: a desk that never sees a receipt's lines shows it as
 * settling nothing, whatever the database holds.
 *
 * Paged rather than given a bigger number, because a bigger number is the
 * same bug with a later date on it.
 */
async function fetchAllRows(
  sb: Awaited<ReturnType<typeof resolveCtx>> extends infer C ? (C extends { sb: infer S } ? S : never) : never,
  table: string,
  tenantId: string,
  voucherIds: string[],
): Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }> {
  const PAGE = 1000;
  const out: Record<string, unknown>[] = [];
  // Chunk the id filter too: a URL carrying 400+ ids is its own limit.
  for (let i = 0; i < voucherIds.length; i += 200) {
    const idChunk = voucherIds.slice(i, i + 200);
    let from = 0;
    for (;;) {
      const { data, error } = await sb
        .from(table)
        .select("*")
        .eq("tenant_id", tenantId)
        .in("voucher_id", idChunk)
        .range(from, from + PAGE - 1);
      if (error) return { data: null, error };
      const rows = (data ?? []) as Record<string, unknown>[];
      out.push(...rows);
      if (rows.length < PAGE) break;
      from += PAGE;
    }
  }
  return { data: out, error: null };
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

  const { rows: existingHeaders } = await fetchAllPages<{ id: string }>((from, to) =>
    sb
      .from("fee_desk_vouchers")
      .select("id")
      .eq("tenant_id", tenantId)
      .order("id", { ascending: true })
      .range(from, to),
  );
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

  // Replace the lines only of vouchers the push actually CARRIES lines for.
  //
  // The delete used to cover every pushed id, so a browser holding a voucher
  // header with an empty `lines` array wiped the real lines and put nothing
  // back. That is how 134 receipts — RCV-00001..00227, 5,80,543 — ended up on
  // 2026-09-01 showing a guardian and an amount with no student, no head and
  // no month, while every month they had paid still read unpaid: the dues
  // clear from the lines, and the lines were gone.
  //
  // It is the same lesson as the header prune above, one level down. A
  // receipt is append-only; a push that says nothing about a voucher's lines
  // is a browser that does not know them, not a receipt that has none.
  const idsWithLines = voucherIdsCarryingLines(active);
  const idsWithTenders = voucherIdsCarryingTenders(active);

  const omittedLines = ids.length - idsWithLines.length;
  if (omittedLines > 0) {
    console.warn(
      `[fees-desk] push carried ${omittedLines} voucher(s) with no lines — keeping the server's (a receipt without lines clears no dues)`,
    );
  }

  if (idsWithLines.length > 0) {
    const { error: delLines } = await sb
      .from("fee_desk_voucher_lines")
      .delete()
      .eq("tenant_id", tenantId)
      .in("voucher_id", idsWithLines);
    if (delLines) {
      return { ok: false, count: 0, error: delLines.message };
    }
  }
  if (idsWithTenders.length > 0) {
    const { error: delTenders } = await sb
      .from("fee_desk_voucher_tenders")
      .delete()
      .eq("tenant_id", tenantId)
      .in("voucher_id", idsWithTenders);
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

/**
 * One household's vouchers — the parent app's receipt list. Same mappers
 * as the full fetch, filtered at the query so a family never pulls the
 * school's whole book.
 */
export async function fetchHouseholdVouchersFromDb(
  householdId: string,
): Promise<{ vouchers: CollectionVoucher[]; ok: boolean }> {
  const ctx = await resolveCtx();
  if (!ctx) return { vouchers: [], ok: false };
  const { sb, tenantId } = ctx;
  const { data: headers, error: hErr } = await sb
    .from("fee_desk_vouchers")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("household_id", householdId)
    .order("collected_at", { ascending: false });
  if (hErr) {
    console.warn("[fees-db] household vouchers fetch failed", hErr.message);
    return { vouchers: [], ok: false };
  }
  if (!headers?.length) return { vouchers: [], ok: true };
  const ids = headers.map((h) => h.id as string);
  const [{ data: lineRows, error: lErr }, { data: tenderRows, error: tErr }] = await Promise.all([
    fetchAllRows(sb, "fee_desk_voucher_lines", tenantId, ids),
    fetchAllRows(sb, "fee_desk_voucher_tenders", tenantId, ids),
  ]);
  if (lErr || tErr) {
    console.warn("[fees-db] household voucher parts fetch failed", lErr?.message || tErr?.message);
    return { vouchers: [], ok: false };
  }
  const linesBy = new Map<string, Record<string, unknown>[]>();
  for (const r of (lineRows ?? []) as Record<string, unknown>[]) {
    const k = String(r.voucher_id);
    (linesBy.get(k) ?? linesBy.set(k, []).get(k)!).push(r);
  }
  const tendersBy = new Map<string, Record<string, unknown>[]>();
  for (const r of (tenderRows ?? []) as Record<string, unknown>[]) {
    const k = String(r.voucher_id);
    (tendersBy.get(k) ?? tendersBy.set(k, []).get(k)!).push(r);
  }
  return {
    ok: true,
    vouchers: (headers as Record<string, unknown>[]).map((h) =>
      rowToVoucher(h, linesBy.get(String(h.id)) ?? [], tendersBy.get(String(h.id)) ?? []),
    ),
  };
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

  // Paged: 502 receipts today; the thousand-and-first would have vanished
  // from every browser silently, and the next push would have pruned its
  // lines. Ordered by id for stable pages, newest first afterwards.
  const headersRes = await fetchAllPages<Record<string, unknown>>((from, to) =>
    sb
      .from("fee_desk_vouchers")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const hErr = headersRes.error ? { message: headersRes.error } : null;
  const headers = headersRes.rows.sort((a, b) =>
    String(b.collected_at ?? "").localeCompare(String(a.collected_at ?? "")),
  );

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
    fetchAllRows(sb, "fee_desk_voucher_lines", tenantId, ids),
    fetchAllRows(sb, "fee_desk_voucher_tenders", tenantId, ids),
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
