/**
 * Purchase desk — Supabase normalized tables (purchase_desk_*).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Grn,
  GrnLine,
  IndentLine,
  PoLine,
  PurchaseIndent,
  PurchaseOrder,
  PurchaseReturn,
  PurchaseReturnLine,
  PurchaseSettings,
  PurchaseState,
} from "@/lib/purchase";
import { purchaseDualWriteDbEnabled } from "@/lib/purchaseDbConfig";
import { getServerTenantContext } from "@/lib/serverTenant";

export type PurchaseDeskSyncMeta = {
  indentCount: number;
  orderCount: number;
  grnCount: number;
  returnCount: number;
  openPoCount: number;
  lastGrnAt: string | null;
  updatedAt: string;
};

export type PurchaseDeskBundle = Pick<
  PurchaseState,
  "indents" | "orders" | "grns" | "returns" | "settings"
>;

const META_SELECT =
  "indent_count, order_count, grn_count, return_count, open_po_count, last_grn_at, updated_at";

async function resolveCtx(): Promise<{
  sb: SupabaseClient;
  tenantId: string;
} | null> {
  return getServerTenantContext();
}

/**
 * Delete rows the client no longer holds — never on an empty payload.
 *
 * An empty keep-set means every stored row is "stale", so this deleted the
 * entire table. That is never what a sync means: a client with nothing to say
 * is a client whose cache was dropped, not an instruction to erase the
 * school's records.
 *
 * It is not hypothetical. On 2026-08-11 the attendance register for the
 * previous day was gone — pushed away by a phone whose localStorage had been
 * dropped on quota, with the emptiness check running AFTER the delete. This
 * same function is copied into 20 modules and called from 86 places, almost
 * none of them guarded, covering bank and cash ledgers, payroll runs, fee
 * cheques, library issues and 1,919 admission records.
 *
 * This floor stops the catastrophic case everywhere at once. It does NOT make
 * a partial payload safe — a client holding 3 of 900 rows still prunes 897.
 * That needs per-module scoping, the way attendance now prunes only within
 * the dates its payload covers. See docs/TODO.md.
 *
 * The read error is also surfaced now. It was discarded, which happened to
 * fail safe here (no data → nothing deleted), but "we could not read the
 * table" and "the table is empty" must not be the same value in a function
 * that deletes.
 */
async function deleteStale(
  sb: SupabaseClient,
  tenantId: string,
  table: string,
  keepIds: Set<string>,
) {
  if (keepIds.size === 0) {
    console.warn(
      `[${table}] refusing to prune: the payload holds no ids at all. ` +
        "An empty client is not an instruction to delete every row.",
    );
    return;
  }
  const { data, error } = await sb
    .from(table)
    .select("id")
    .eq("tenant_id", tenantId);
  if (error) {
    console.error(
      `[${table}] prune skipped — could not read existing ids:`,
      error.message,
    );
    return;
  }
  const stale = (data ?? [])
    .map((r) => String((r as { id: string }).id))
    .filter((id) => !keepIds.has(id));
  if (stale.length > 0) {
    await sb.from(table).delete().in("id", stale);
  }
}

async function upsertChunks(
  sb: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  chunk = 200,
): Promise<{ ok: boolean; error?: string }> {
  for (let i = 0; i < rows.length; i += chunk) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + chunk));
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}

function nowIso() {
  return new Date().toISOString();
}

function indentToRow(tenantId: string, i: PurchaseIndent): Record<string, unknown> {
  return {
    id: i.id,
    tenant_id: tenantId,
    indent_no: i.indentNo || "",
    academic_year_code: i.academicYearCode || "",
    requester_name: i.requesterName || "",
    requester_staff_id: i.requesterStaffId || "",
    department: i.department || "",
    urgency: i.urgency || "normal",
    status: i.status || "draft",
    note: i.note || "",
    estimated_paise: i.estimatedPaise ?? 0,
    decided_by: i.decidedBy || "",
    decided_at: i.decidedAt || null,
    decision_note: i.decisionNote || "",
    submitted_at: i.submittedAt || null,
    created_at: i.createdAt || nowIso(),
    updated_at: nowIso(),
  };
}

function indentLineToRow(
  tenantId: string,
  indentId: string,
  idx: number,
  line: IndentLine,
): Record<string, unknown> {
  return {
    id: line.id,
    tenant_id: tenantId,
    indent_id: indentId,
    line_index: idx,
    description: line.description || "",
    sku_item_id: line.skuItemId || "",
    qty: line.qty ?? 0,
    uom: line.uom || "nos",
    est_rate_paise: line.estRatePaise ?? 0,
    updated_at: nowIso(),
  };
}

function rowToIndentLine(r: Record<string, unknown>): IndentLine {
  return {
    id: String(r.id),
    description: String(r.description || ""),
    skuItemId: String(r.sku_item_id || "") || undefined,
    qty: Number(r.qty ?? 0),
    uom: String(r.uom || "nos"),
    estRatePaise: Number(r.est_rate_paise ?? 0),
  };
}

function rowToIndent(
  r: Record<string, unknown>,
  lines: IndentLine[],
): PurchaseIndent {
  return {
    id: String(r.id),
    indentNo: String(r.indent_no || ""),
    academicYearCode: String(r.academic_year_code || ""),
    requesterName: String(r.requester_name || ""),
    requesterStaffId: String(r.requester_staff_id || ""),
    department: String(r.department || ""),
    urgency: r.urgency === "urgent" ? "urgent" : "normal",
    status: String(r.status || "draft") as PurchaseIndent["status"],
    lines,
    note: String(r.note || ""),
    createdAt: String(r.created_at || nowIso()),
    submittedAt: r.submitted_at ? String(r.submitted_at) : "",
    decidedBy: String(r.decided_by || ""),
    decidedAt: r.decided_at ? String(r.decided_at) : "",
    decisionNote: String(r.decision_note || ""),
    estimatedPaise: Number(r.estimated_paise ?? 0),
  };
}

function orderToRow(tenantId: string, o: PurchaseOrder): Record<string, unknown> {
  return {
    id: o.id,
    tenant_id: tenantId,
    po_no: o.poNo || "",
    indent_id: o.indentId || "",
    vendor_id: o.vendorId || "",
    vendor_name: o.vendorName || "",
    status: o.status || "draft",
    approved_by: o.approvedBy || "",
    approved_at: o.approvedAt || null,
    academic_year_code: o.academicYearCode || "",
    note: o.note || "",
    discount_paise: o.discountPaise ?? 0,
    tax_paise: o.taxPaise ?? 0,
    amount_paise: o.amountPaise ?? 0,
    created_at: o.createdAt || nowIso(),
    updated_at: nowIso(),
  };
}

function orderLineToRow(
  tenantId: string,
  orderId: string,
  idx: number,
  line: PoLine,
): Record<string, unknown> {
  return {
    id: line.id,
    tenant_id: tenantId,
    order_id: orderId,
    line_index: idx,
    description: line.description || "",
    sku_item_id: line.skuItemId || "",
    qty: line.qty ?? 0,
    uom: line.uom || "nos",
    rate_paise: line.ratePaise ?? 0,
    updated_at: nowIso(),
  };
}

function rowToOrderLine(r: Record<string, unknown>): PoLine {
  return {
    id: String(r.id),
    description: String(r.description || ""),
    skuItemId: String(r.sku_item_id || "") || undefined,
    qty: Number(r.qty ?? 0),
    uom: String(r.uom || "nos"),
    ratePaise: Number(r.rate_paise ?? 0),
  };
}

function rowToOrder(
  r: Record<string, unknown>,
  lines: PoLine[],
): PurchaseOrder {
  return {
    id: String(r.id),
    poNo: String(r.po_no || ""),
    indentId: String(r.indent_id || "") || undefined,
    vendorId: String(r.vendor_id || ""),
    vendorName: String(r.vendor_name || ""),
    lines,
    status: String(r.status || "draft") as PurchaseOrder["status"],
    approvedBy: String(r.approved_by || ""),
    approvedAt: r.approved_at ? String(r.approved_at) : "",
    academicYearCode: String(r.academic_year_code || ""),
    note: String(r.note || ""),
    createdAt: String(r.created_at || nowIso()),
    discountPaise: Number(r.discount_paise ?? 0),
    taxPaise: Number(r.tax_paise ?? 0),
    amountPaise: Number(r.amount_paise ?? 0),
  };
}

function grnToRow(tenantId: string, g: Grn): Record<string, unknown> {
  return {
    id: g.id,
    tenant_id: tenantId,
    grn_no: g.grnNo || "",
    po_id: g.poId || "",
    grn_date: g.date,
    destination: g.destination || "store",
    photo_note: g.photoNote || "",
    bill_image_url: g.billImageUrl || "",
    ocr_bill_no: g.ocrBillNo || "",
    vendor_bill_id: g.vendorBillId || "",
    stock_applied: !!g.stockApplied,
    created_by: g.createdBy || "",
    created_at: g.createdAt || nowIso(),
    updated_at: nowIso(),
  };
}

function grnLineToRow(
  tenantId: string,
  grnId: string,
  idx: number,
  line: GrnLine,
): Record<string, unknown> {
  return {
    id: line.id,
    tenant_id: tenantId,
    grn_id: grnId,
    line_index: idx,
    po_line_id: line.poLineId || "",
    description: line.description || "",
    sku_item_id: line.skuItemId || "",
    qty_ordered: line.qtyOrdered ?? 0,
    qty_received: line.qtyReceived ?? 0,
    uom: line.uom || "nos",
    updated_at: nowIso(),
  };
}

function rowToGrnLine(r: Record<string, unknown>): GrnLine {
  return {
    id: String(r.id),
    poLineId: String(r.po_line_id || ""),
    description: String(r.description || ""),
    skuItemId: String(r.sku_item_id || "") || undefined,
    qtyOrdered: Number(r.qty_ordered ?? 0),
    qtyReceived: Number(r.qty_received ?? 0),
    uom: String(r.uom || "nos"),
  };
}

function rowToGrn(r: Record<string, unknown>, lines: GrnLine[]): Grn {
  const dest = String(r.destination || "store");
  return {
    id: String(r.id),
    grnNo: String(r.grn_no || ""),
    poId: String(r.po_id || ""),
    date: String(r.grn_date).slice(0, 10),
    lines,
    destination:
      dest === "library" || dest === "asset" || dest === "expense"
        ? dest
        : "store",
    photoNote: String(r.photo_note || ""),
    billImageUrl: String(r.bill_image_url || ""),
    ocrBillNo: String(r.ocr_bill_no || ""),
    createdBy: String(r.created_by || ""),
    createdAt: String(r.created_at || nowIso()),
    vendorBillId: String(r.vendor_bill_id || "") || undefined,
    stockApplied: r.stock_applied === true,
  };
}

function returnToRow(
  tenantId: string,
  r: PurchaseReturn,
): Record<string, unknown> {
  return {
    id: r.id,
    tenant_id: tenantId,
    return_no: r.returnNo || "",
    grn_id: r.grnId || "",
    vendor_bill_id: r.vendorBillId || "",
    vendor_id: r.vendorId || "",
    return_date: r.date,
    amount_paise: r.amountPaise ?? 0,
    note: r.note || "",
    created_by: r.createdBy || "",
    created_at: r.createdAt || nowIso(),
    updated_at: nowIso(),
  };
}

function returnLineToRow(
  tenantId: string,
  returnId: string,
  idx: number,
  line: PurchaseReturnLine,
): Record<string, unknown> {
  return {
    id: line.id,
    tenant_id: tenantId,
    return_id: returnId,
    line_index: idx,
    grn_line_id: line.grnLineId || "",
    description: line.description || "",
    sku_item_id: line.skuItemId || "",
    qty: line.qty ?? 0,
    rate_paise: line.ratePaise ?? 0,
    amount_paise: line.amountPaise ?? 0,
    updated_at: nowIso(),
  };
}

function rowToReturnLine(r: Record<string, unknown>): PurchaseReturnLine {
  return {
    id: String(r.id),
    grnLineId: String(r.grn_line_id || ""),
    description: String(r.description || ""),
    skuItemId: String(r.sku_item_id || "") || undefined,
    qty: Number(r.qty ?? 0),
    ratePaise: Number(r.rate_paise ?? 0),
    amountPaise: Number(r.amount_paise ?? 0),
  };
}

function rowToReturn(
  r: Record<string, unknown>,
  lines: PurchaseReturnLine[],
): PurchaseReturn {
  return {
    id: String(r.id),
    returnNo: String(r.return_no || ""),
    grnId: String(r.grn_id || ""),
    vendorBillId: String(r.vendor_bill_id || ""),
    vendorId: String(r.vendor_id || ""),
    date: String(r.return_date).slice(0, 10),
    lines,
    amountPaise: Number(r.amount_paise ?? 0),
    note: String(r.note || ""),
    createdBy: String(r.created_by || ""),
    createdAt: String(r.created_at || nowIso()),
  };
}

function collectNestedLineIds<T extends { id: string }>(
  parents: Array<{ id: string; lines?: T[] }>,
): Set<string> {
  const keep = new Set<string>();
  for (const parent of parents) {
    for (const line of parent.lines ?? []) {
      keep.add(line.id);
    }
  }
  return keep;
}

export async function pushPurchaseDeskToDb(
  state: PurchaseState,
): Promise<{ ok: boolean; error?: string }> {
  if (!purchaseDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = nowIso();

  const indents = state.indents ?? [];
  const orders = state.orders ?? [];
  const grns = state.grns ?? [];
  const returns = state.returns ?? [];
  const settings = state.settings ?? {
    adminLimitPaise: 500_000,
    principalLimitPaise: 5_000_000,
  };

  await Promise.all([
    deleteStale(sb, tenantId, "purchase_desk_indents", new Set(indents.map((i) => i.id))),
    deleteStale(
      sb,
      tenantId,
      "purchase_desk_indent_lines",
      collectNestedLineIds(indents),
    ),
    deleteStale(sb, tenantId, "purchase_desk_orders", new Set(orders.map((o) => o.id))),
    deleteStale(
      sb,
      tenantId,
      "purchase_desk_order_lines",
      collectNestedLineIds(orders),
    ),
    deleteStale(sb, tenantId, "purchase_desk_grns", new Set(grns.map((g) => g.id))),
    deleteStale(
      sb,
      tenantId,
      "purchase_desk_grn_lines",
      collectNestedLineIds(grns),
    ),
    deleteStale(sb, tenantId, "purchase_desk_returns", new Set(returns.map((r) => r.id))),
    deleteStale(
      sb,
      tenantId,
      "purchase_desk_return_lines",
      collectNestedLineIds(returns),
    ),
  ]);

  const indentLineRows = indents.flatMap((indent) =>
    (indent.lines ?? []).map((line, idx) =>
      indentLineToRow(tenantId, indent.id, idx, line),
    ),
  );
  const orderLineRows = orders.flatMap((order) =>
    (order.lines ?? []).map((line, idx) =>
      orderLineToRow(tenantId, order.id, idx, line),
    ),
  );
  const grnLineRows = grns.flatMap((grn) =>
    (grn.lines ?? []).map((line, idx) => grnLineToRow(tenantId, grn.id, idx, line)),
  );
  const returnLineRows = returns.flatMap((ret) =>
    (ret.lines ?? []).map((line, idx) =>
      returnLineToRow(tenantId, ret.id, idx, line),
    ),
  );

  const tables: [string, Record<string, unknown>[]][] = [
    ["purchase_desk_indents", indents.map((i) => indentToRow(tenantId, i))],
    ["purchase_desk_indent_lines", indentLineRows],
    ["purchase_desk_orders", orders.map((o) => orderToRow(tenantId, o))],
    ["purchase_desk_order_lines", orderLineRows],
    ["purchase_desk_grns", grns.map((g) => grnToRow(tenantId, g))],
    ["purchase_desk_grn_lines", grnLineRows],
    ["purchase_desk_returns", returns.map((r) => returnToRow(tenantId, r))],
    ["purchase_desk_return_lines", returnLineRows],
  ];

  for (const [table, rows] of tables) {
    const r = await upsertChunks(sb, table, rows);
    if (!r.ok) return r;
  }

  await sb.from("purchase_desk_settings").upsert(
    {
      tenant_id: tenantId,
      admin_limit_paise: settings.adminLimitPaise ?? 500_000,
      principal_limit_paise: settings.principalLimitPaise ?? 5_000_000,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  const openPos = orders.filter(
    (o) => o.status === "issued" || o.status === "partial_grn",
  );
  let lastGrnAt: string | null = null;
  for (const g of grns) {
    const at = g.date;
    if (at && (!lastGrnAt || at > lastGrnAt)) lastGrnAt = at;
  }

  await sb.from("purchase_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      indent_count: indents.length,
      order_count: orders.length,
      grn_count: grns.length,
      return_count: returns.length,
      open_po_count: openPos.length,
      last_grn_at: lastGrnAt,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true };
}

export async function fetchPurchaseDeskFromDb(): Promise<{
  bundle: PurchaseDeskBundle;
  meta: PurchaseDeskSyncMeta | null;
  /** false = tenant/query could not be resolved; bundle is NOT a confirmed empty state. */
  ok: boolean;
}> {
  const ctx = await resolveCtx();
  const emptySettings: PurchaseSettings = {
    adminLimitPaise: 500_000,
    principalLimitPaise: 5_000_000,
  };
  const empty: PurchaseDeskBundle = {
    indents: [],
    orders: [],
    grns: [],
    returns: [],
    settings: emptySettings,
  };
  if (!ctx) return { bundle: empty, meta: null, ok: false };
  const { sb, tenantId } = ctx;

  const [
    { data: indentRows, error: indentErr },
    { data: indentLineRows, error: indentLineErr },
    { data: orderRows, error: orderErr },
    { data: orderLineRows, error: orderLineErr },
    { data: grnRows, error: grnErr },
    { data: grnLineRows, error: grnLineErr },
    { data: returnRows, error: returnErr },
    { data: returnLineRows, error: returnLineErr },
    { data: settingsRow, error: settingsErr },
    { data: metaRow },
  ] = await Promise.all([
    sb.from("purchase_desk_indents").select("*").eq("tenant_id", tenantId),
    sb.from("purchase_desk_indent_lines").select("*").eq("tenant_id", tenantId),
    sb.from("purchase_desk_orders").select("*").eq("tenant_id", tenantId),
    sb.from("purchase_desk_order_lines").select("*").eq("tenant_id", tenantId),
    sb.from("purchase_desk_grns").select("*").eq("tenant_id", tenantId),
    sb.from("purchase_desk_grn_lines").select("*").eq("tenant_id", tenantId),
    sb.from("purchase_desk_returns").select("*").eq("tenant_id", tenantId),
    sb.from("purchase_desk_return_lines").select("*").eq("tenant_id", tenantId),
    sb
      .from("purchase_desk_settings")
      .select("admin_limit_paise, principal_limit_paise")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    sb
      .from("purchase_desk_sync_meta")
      .select(META_SELECT)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  if (
    indentErr ||
    indentLineErr ||
    orderErr ||
    orderLineErr ||
    grnErr ||
    grnLineErr ||
    returnErr ||
    returnLineErr ||
    settingsErr
  ) {
    console.warn(
      "[purchase-db] fetch failed",
      indentErr?.message,
      indentLineErr?.message,
      orderErr?.message,
      orderLineErr?.message,
      grnErr?.message,
      grnLineErr?.message,
      returnErr?.message,
      returnLineErr?.message,
      settingsErr?.message,
    );
    return { bundle: empty, meta: null, ok: false };
  }

  const linesByIndent = new Map<string, IndentLine[]>();
  for (const row of indentLineRows ?? []) {
    const r = row as Record<string, unknown>;
    const indentId = String(r.indent_id);
    const list = linesByIndent.get(indentId) ?? [];
    list.push(rowToIndentLine(r));
    linesByIndent.set(indentId, list);
  }

  const linesByOrder = new Map<string, PoLine[]>();
  for (const row of orderLineRows ?? []) {
    const r = row as Record<string, unknown>;
    const orderId = String(r.order_id);
    const list = linesByOrder.get(orderId) ?? [];
    list.push(rowToOrderLine(r));
    linesByOrder.set(orderId, list);
  }

  const linesByGrn = new Map<string, GrnLine[]>();
  for (const row of grnLineRows ?? []) {
    const r = row as Record<string, unknown>;
    const grnId = String(r.grn_id);
    const list = linesByGrn.get(grnId) ?? [];
    list.push(rowToGrnLine(r));
    linesByGrn.set(grnId, list);
  }

  const linesByReturn = new Map<string, PurchaseReturnLine[]>();
  for (const row of returnLineRows ?? []) {
    const r = row as Record<string, unknown>;
    const returnId = String(r.return_id);
    const list = linesByReturn.get(returnId) ?? [];
    list.push(rowToReturnLine(r));
    linesByReturn.set(returnId, list);
  }

  const s = settingsRow as {
    admin_limit_paise?: number;
    principal_limit_paise?: number;
  } | null;

  return {
    bundle: {
      indents: (indentRows ?? []).map((r) => {
        const rec = r as Record<string, unknown>;
        return rowToIndent(rec, linesByIndent.get(String(rec.id)) ?? []);
      }),
      orders: (orderRows ?? []).map((r) => {
        const rec = r as Record<string, unknown>;
        return rowToOrder(rec, linesByOrder.get(String(rec.id)) ?? []);
      }),
      grns: (grnRows ?? []).map((r) => {
        const rec = r as Record<string, unknown>;
        return rowToGrn(rec, linesByGrn.get(String(rec.id)) ?? []);
      }),
      returns: (returnRows ?? []).map((r) => {
        const rec = r as Record<string, unknown>;
        return rowToReturn(rec, linesByReturn.get(String(rec.id)) ?? []);
      }),
      settings: {
        adminLimitPaise: s?.admin_limit_paise ?? 500_000,
        principalLimitPaise: s?.principal_limit_paise ?? 5_000_000,
      },
    },
    meta: metaRow
      ? {
          indentCount: (metaRow as { indent_count: number }).indent_count,
          orderCount: (metaRow as { order_count: number }).order_count,
          grnCount: (metaRow as { grn_count: number }).grn_count,
          returnCount: (metaRow as { return_count: number }).return_count,
          openPoCount: (metaRow as { open_po_count: number }).open_po_count,
          lastGrnAt: (metaRow as { last_grn_at: string | null }).last_grn_at,
          updatedAt: String((metaRow as { updated_at: string }).updated_at),
        }
      : null,
    ok: true,
  };
}
