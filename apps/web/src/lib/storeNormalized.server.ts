/**
 * Store desk — Supabase normalized tables (store_desk_*).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  StoreAssetAllocation,
  StoreCategoryDef,
  StoreInfraLevel,
  StoreInventoryAllocation,
  StoreIssue,
  StoreIssueLine,
  StoreItem,
  StoreSaleGroup,
  StoreSellReturn,
  StoreSellReturnLine,
  StoreSource,
  StoreState,
  StoreStockMovement,
  StoreUom,
} from "@/lib/store";
import { storeDualWriteDbEnabled } from "@/lib/storeDbConfig";
import { getServerTenantContext } from "@/lib/serverTenant";

export type StoreDeskSyncMeta = {
  categoryCount: number;
  itemCount: number;
  issueCount: number;
  movementCount: number;
  openDueCount: number;
  lastIssueAt: string | null;
  updatedAt: string;
};

export type StoreDeskBundle = Pick<
  StoreState,
  | "categories"
  | "saleGroups"
  | "uoms"
  | "infraLevels"
  | "sources"
  | "items"
  | "issues"
  | "movements"
  | "inventoryAllocations"
  | "assetAllocations"
  | "sellReturns"
>;

const META_SELECT =
  "category_count, item_count, issue_count, movement_count, open_due_count, last_issue_at, updated_at";

type NamedMaster = {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  sortOrder: number;
};

async function resolveCtx(): Promise<{
  sb: SupabaseClient;
  tenantId: string;
} | null> {
  return getServerTenantContext();
}

async function deleteStale(
  sb: SupabaseClient,
  tenantId: string,
  table: string,
  keepIds: Set<string>,
) {
  const { data } = await sb.from(table).select("id").eq("tenant_id", tenantId);
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

function namedMasterToRow(
  tenantId: string,
  row: NamedMaster,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id: row.id,
    tenant_id: tenantId,
    name: row.name || "",
    code: row.code || "",
    is_active: row.isActive !== false,
    sort_order: row.sortOrder ?? 0,
    updated_at: nowIso(),
    ...extra,
  };
}

function rowToNamedMaster(r: Record<string, unknown>): NamedMaster {
  return {
    id: String(r.id),
    name: String(r.name || ""),
    code: String(r.code || ""),
    isActive: r.is_active !== false,
    sortOrder: Number(r.sort_order ?? 0),
  };
}

function categoryToRow(
  tenantId: string,
  c: StoreCategoryDef,
): Record<string, unknown> {
  return namedMasterToRow(tenantId, c, {
    preferred_source_ids: c.preferredSourceIds ?? [],
  });
}

function rowToCategory(r: Record<string, unknown>): StoreCategoryDef {
  const ids = r.preferred_source_ids;
  return {
    ...rowToNamedMaster(r),
    preferredSourceIds: Array.isArray(ids) ? ids.map((x) => String(x)) : [],
  };
}

function saleGroupToRow(
  tenantId: string,
  g: StoreSaleGroup,
): Record<string, unknown> {
  return namedMasterToRow(tenantId, g, {
    category_id: g.categoryId || "",
    class_ids: g.classIds ?? [],
  });
}

function rowToSaleGroup(r: Record<string, unknown>): StoreSaleGroup {
  const classIds = r.class_ids;
  return normalizeSaleGroupFromRow({
    ...rowToNamedMaster(r),
    categoryId: String(r.category_id || ""),
    classIds: Array.isArray(classIds) ? classIds.map((x) => String(x)) : [],
  });
}

function normalizeSaleGroupFromRow(c: Partial<StoreSaleGroup>): StoreSaleGroup {
  const classIds = Array.isArray(c.classIds)
    ? c.classIds.map(String).filter(Boolean)
    : [];
  return {
    id: c.id || "",
    name: c.name || "",
    code: c.code || "",
    isActive: c.isActive !== false,
    sortOrder: Number(c.sortOrder ?? 0),
    categoryId: (c.categoryId ?? "").trim(),
    classIds,
  };
}

function sourceToRow(tenantId: string, s: StoreSource): Record<string, unknown> {
  return namedMasterToRow(tenantId, s, {
    phone: s.phone || "",
    accounts_vendor_id: s.accountsVendorId || "",
  });
}

function rowToSource(r: Record<string, unknown>): StoreSource {
  return {
    ...rowToNamedMaster(r),
    phone: String(r.phone || ""),
    accountsVendorId: String(r.accounts_vendor_id || ""),
  };
}

function itemToRow(tenantId: string, i: StoreItem): Record<string, unknown> {
  return {
    id: i.id,
    tenant_id: tenantId,
    sku: i.sku || "",
    name: i.name || "",
    category_id: i.categoryId || "",
    sale_group_id: i.saleGroupId || "",
    uom_id: i.uomId || "",
    source_id: i.sourceId || "",
    infra_level_id: i.infraLevelId || "",
    size_label: i.sizeLabel || "",
    purchase_price_paise: i.purchasePricePaise ?? 0,
    sale_price_paise: i.salePricePaise ?? i.unitPricePaise ?? 0,
    unit_price_paise: i.unitPricePaise ?? i.salePricePaise ?? 0,
    max_discount_pct: i.maxDiscountPct ?? 0,
    audience: i.audience || "student",
    applicable_class_ids: i.applicableClassIds ?? [],
    is_active: i.isActive !== false,
    stock_on_hand: i.stockOnHand ?? 0,
    reorder_level: i.reorderLevel ?? 0,
    opening_qty: i.openingQty ?? 0,
    issue_policy: i.issuePolicy || "unlimited",
    max_qty_per_ay: i.maxQtyPerAy ?? 0,
    barcode: i.barcode || "",
    updated_at: nowIso(),
  };
}

function rowToItem(r: Record<string, unknown>): StoreItem {
  const sale = Number(r.sale_price_paise ?? 0);
  const unit = Number(r.unit_price_paise ?? sale);
  const classIds = r.applicable_class_ids;
  return {
    id: String(r.id),
    sku: String(r.sku || ""),
    name: String(r.name || ""),
    categoryId: String(r.category_id || ""),
    saleGroupId: String(r.sale_group_id || ""),
    uomId: String(r.uom_id || ""),
    sourceId: String(r.source_id || ""),
    infraLevelId: String(r.infra_level_id || ""),
    sizeLabel: String(r.size_label || ""),
    purchasePricePaise: Number(r.purchase_price_paise ?? 0),
    salePricePaise: sale,
    unitPricePaise: unit || sale,
    maxDiscountPct: Number(r.max_discount_pct ?? 0),
    audience:
      r.audience === "staff" || r.audience === "both" ? r.audience : "student",
    applicableClassIds: Array.isArray(classIds)
      ? classIds.map((x) => String(x))
      : [],
    isActive: r.is_active !== false,
    stockOnHand: Number(r.stock_on_hand ?? 0),
    reorderLevel: Number(r.reorder_level ?? 0),
    openingQty: Number(r.opening_qty ?? 0),
    issuePolicy: String(r.issue_policy || "unlimited") as StoreItem["issuePolicy"],
    maxQtyPerAy: Number(r.max_qty_per_ay ?? 0),
    barcode: String(r.barcode || ""),
  };
}

function issueLineId(issueId: string, idx: number) {
  return `${issueId}_L${idx}`;
}

function issueToRow(tenantId: string, i: StoreIssue): Record<string, unknown> {
  return {
    id: i.id,
    tenant_id: tenantId,
    issue_no: i.issueNo || "",
    recipient_kind: i.recipientKind || "student",
    student_id: i.studentId || "",
    staff_id: i.staffId || "",
    household_id: i.householdId || "",
    academic_year_code: i.academicYearCode || "",
    issued_on: i.issuedOn,
    total_paise: i.totalPaise ?? 0,
    sale_discount_paise: i.saleDiscountPaise ?? 0,
    note: i.note || "",
    created_at: i.createdAt || nowIso(),
    voided_at: i.voidedAt || null,
    payment_mode: i.paymentMode || "credit",
    payment_status: i.paymentStatus || "due",
    tender_mode: i.tenderMode || "cash",
    payment_channel: i.paymentChannel || "",
    counter_paid_paise: i.counterPaidPaise ?? 0,
    stock_group_id: i.stockGroupId || "",
    sale_group_id: i.saleGroupId || "",
    issue_kind: i.issueKind || "first",
    replaces_issue_id: i.replacesIssueId || "",
    replacement_reason: i.replacementReason || "",
    issued_by: i.issuedBy || "",
    store_location: i.storeLocation || "",
    return_to_stock: !!i.returnToStock,
    returned_paise: i.returnedPaise ?? 0,
    updated_at: nowIso(),
  };
}

function issueLineToRow(
  tenantId: string,
  issueId: string,
  idx: number,
  line: StoreIssueLine,
): Record<string, unknown> {
  return {
    id: issueLineId(issueId, idx),
    tenant_id: tenantId,
    issue_id: issueId,
    line_index: idx,
    item_id: line.itemId || "",
    sku: line.sku || "",
    name: line.name || "",
    size_label: line.sizeLabel || "",
    qty: line.qty ?? 0,
    unit_price_paise: line.unitPricePaise ?? 0,
    line_paise: line.linePaise ?? 0,
    max_discount_pct: line.maxDiscountPct ?? 0,
    updated_at: nowIso(),
  };
}

function rowToIssueLine(r: Record<string, unknown>): StoreIssueLine {
  return {
    itemId: String(r.item_id || ""),
    sku: String(r.sku || ""),
    name: String(r.name || ""),
    sizeLabel: String(r.size_label || ""),
    qty: Number(r.qty ?? 0),
    unitPricePaise: Number(r.unit_price_paise ?? 0),
    linePaise: Number(r.line_paise ?? 0),
    maxDiscountPct: Number(r.max_discount_pct ?? 0),
  };
}

function rowToIssue(
  r: Record<string, unknown>,
  lines: StoreIssueLine[],
): StoreIssue {
  return {
    id: String(r.id),
    issueNo: String(r.issue_no || ""),
    recipientKind:
      r.recipient_kind === "staff" ? "staff" : "student",
    studentId: String(r.student_id || ""),
    staffId: String(r.staff_id || ""),
    householdId: String(r.household_id || ""),
    academicYearCode: String(r.academic_year_code || ""),
    issuedOn: String(r.issued_on).slice(0, 10),
    lines,
    totalPaise: Number(r.total_paise ?? 0),
    saleDiscountPaise: Number(r.sale_discount_paise ?? 0),
    note: String(r.note || ""),
    createdAt: String(r.created_at || nowIso()),
    voidedAt: r.voided_at ? String(r.voided_at) : null,
    paymentMode: r.payment_mode === "cash" ? "cash" : "credit",
    paymentStatus:
      r.payment_status === "paid" || r.payment_status === "void"
        ? r.payment_status
        : "due",
    tenderMode:
      typeof r.tender_mode === "string" && r.tender_mode
        ? (r.tender_mode as StoreIssue["tenderMode"])
        : "cash",
    paymentChannel: String(r.payment_channel || ""),
    counterPaidPaise: Number(r.counter_paid_paise ?? 0),
    stockGroupId: String(r.stock_group_id || ""),
    saleGroupId: String(r.sale_group_id || ""),
    issueKind: String(r.issue_kind || "first") as StoreIssue["issueKind"],
    replacesIssueId: String(r.replaces_issue_id || ""),
    replacementReason: String(r.replacement_reason || ""),
    issuedBy: String(r.issued_by || ""),
    storeLocation: String(r.store_location || ""),
    returnToStock: r.return_to_stock === true,
    returnedPaise: Number(r.returned_paise ?? 0),
  };
}

function movementToRow(
  tenantId: string,
  m: StoreStockMovement,
): Record<string, unknown> {
  return {
    id: m.id,
    tenant_id: tenantId,
    item_id: m.itemId || "",
    at: m.at || nowIso(),
    kind: m.kind || "adjust",
    qty_delta: m.qtyDelta ?? 0,
    note: m.note || "",
    ref_issue_id: m.refIssueId || "",
    by_user: m.by || "",
    updated_at: nowIso(),
  };
}

function rowToMovement(r: Record<string, unknown>): StoreStockMovement {
  return {
    id: String(r.id),
    itemId: String(r.item_id || ""),
    at: String(r.at || nowIso()),
    kind: String(r.kind || "adjust") as StoreStockMovement["kind"],
    qtyDelta: Number(r.qty_delta ?? 0),
    note: String(r.note || ""),
    refIssueId: String(r.ref_issue_id || ""),
    by: String(r.by_user || ""),
  };
}

function inventoryAllocToRow(
  tenantId: string,
  a: StoreInventoryAllocation,
): Record<string, unknown> {
  return {
    id: a.id,
    tenant_id: tenantId,
    item_id: a.itemId || "",
    infra_level_id: a.infraLevelId || "",
    qty: a.qty ?? 0,
    note: a.note || "",
    updated_at: a.updatedAt || nowIso(),
  };
}

function rowToInventoryAlloc(r: Record<string, unknown>): StoreInventoryAllocation {
  return {
    id: String(r.id),
    itemId: String(r.item_id || ""),
    infraLevelId: String(r.infra_level_id || ""),
    qty: Number(r.qty ?? 0),
    note: String(r.note || ""),
    updatedAt: String(r.updated_at || nowIso()),
  };
}

function assetAllocToRow(
  tenantId: string,
  a: StoreAssetAllocation,
): Record<string, unknown> {
  return {
    id: a.id,
    tenant_id: tenantId,
    item_id: a.itemId || "",
    asset_tag: a.assetTag || "",
    assigned_to: a.assignedTo || "",
    location: a.location || "",
    qty: a.qty ?? 0,
    note: a.note || "",
    updated_at: a.updatedAt || nowIso(),
  };
}

function rowToAssetAlloc(r: Record<string, unknown>): StoreAssetAllocation {
  return {
    id: String(r.id),
    itemId: String(r.item_id || ""),
    assetTag: String(r.asset_tag || ""),
    assignedTo: String(r.assigned_to || ""),
    location: String(r.location || ""),
    qty: Number(r.qty ?? 0),
    note: String(r.note || ""),
    updatedAt: String(r.updated_at || nowIso()),
  };
}

function sellReturnLineId(returnId: string, idx: number) {
  return `${returnId}_L${idx}`;
}

function sellReturnToRow(
  tenantId: string,
  r: StoreSellReturn,
): Record<string, unknown> {
  return {
    id: r.id,
    tenant_id: tenantId,
    return_no: r.returnNo || "",
    issue_id: r.issueId || "",
    student_id: r.studentId || "",
    staff_id: r.staffId || "",
    returned_on: r.returnedOn,
    total_paise: r.totalPaise ?? 0,
    note: r.note || "",
    created_at: r.createdAt || nowIso(),
    created_by: r.createdBy || "",
    updated_at: nowIso(),
  };
}

function sellReturnLineToRow(
  tenantId: string,
  returnId: string,
  idx: number,
  line: StoreSellReturnLine,
): Record<string, unknown> {
  return {
    id: sellReturnLineId(returnId, idx),
    tenant_id: tenantId,
    return_id: returnId,
    line_index: idx,
    item_id: line.itemId || "",
    sku: line.sku || "",
    name: line.name || "",
    size_label: line.sizeLabel || "",
    qty: line.qty ?? 0,
    unit_price_paise: line.unitPricePaise ?? 0,
    line_paise: line.linePaise ?? 0,
    updated_at: nowIso(),
  };
}

function rowToSellReturnLine(r: Record<string, unknown>): StoreSellReturnLine {
  return {
    itemId: String(r.item_id || ""),
    sku: String(r.sku || ""),
    name: String(r.name || ""),
    sizeLabel: String(r.size_label || ""),
    qty: Number(r.qty ?? 0),
    unitPricePaise: Number(r.unit_price_paise ?? 0),
    linePaise: Number(r.line_paise ?? 0),
  };
}

function rowToSellReturn(
  r: Record<string, unknown>,
  lines: StoreSellReturnLine[],
): StoreSellReturn {
  return {
    id: String(r.id),
    returnNo: String(r.return_no || ""),
    issueId: String(r.issue_id || ""),
    studentId: String(r.student_id || ""),
    staffId: String(r.staff_id || ""),
    returnedOn: String(r.returned_on).slice(0, 10),
    lines,
    totalPaise: Number(r.total_paise ?? 0),
    note: String(r.note || ""),
    createdAt: String(r.created_at || nowIso()),
    createdBy: String(r.created_by || ""),
  };
}

function flattenIssueLines(issues: StoreIssue[]) {
  const rows: Record<string, unknown>[] = [];
  const keep = new Set<string>();
  for (const issue of issues) {
    (issue.lines ?? []).forEach((line, idx) => {
      const id = issueLineId(issue.id, idx);
      keep.add(id);
      rows.push(issueLineToRow("", issue.id, idx, line));
    });
  }
  return { rows, keep };
}

function flattenSellReturnLines(returns: StoreSellReturn[]) {
  const rows: Record<string, unknown>[] = [];
  const keep = new Set<string>();
  for (const ret of returns) {
    (ret.lines ?? []).forEach((line, idx) => {
      const id = sellReturnLineId(ret.id, idx);
      keep.add(id);
      rows.push(sellReturnLineToRow("", ret.id, idx, line));
    });
  }
  return { rows, keep };
}

export async function pushStoreDeskToDb(
  state: StoreState,
): Promise<{ ok: boolean; error?: string }> {
  if (!storeDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = nowIso();

  const categories = state.categories ?? [];
  const saleGroups = state.saleGroups ?? [];
  const uoms = state.uoms ?? [];
  const infraLevels = state.infraLevels ?? [];
  const sources = state.sources ?? [];
  const items = state.items ?? [];
  const issues = state.issues ?? [];
  const movements = state.movements ?? [];
  const inventoryAllocations = state.inventoryAllocations ?? [];
  const assetAllocations = state.assetAllocations ?? [];
  const sellReturns = state.sellReturns ?? [];

  const issueLineFlat = flattenIssueLines(issues);
  const sellReturnLineFlat = flattenSellReturnLines(sellReturns);

  await Promise.all([
    deleteStale(sb, tenantId, "store_desk_categories", new Set(categories.map((c) => c.id))),
    deleteStale(sb, tenantId, "store_desk_sale_groups", new Set(saleGroups.map((c) => c.id))),
    deleteStale(sb, tenantId, "store_desk_uoms", new Set(uoms.map((c) => c.id))),
    deleteStale(sb, tenantId, "store_desk_infra_levels", new Set(infraLevels.map((c) => c.id))),
    deleteStale(sb, tenantId, "store_desk_sources", new Set(sources.map((c) => c.id))),
    deleteStale(sb, tenantId, "store_desk_items", new Set(items.map((c) => c.id))),
    deleteStale(sb, tenantId, "store_desk_issues", new Set(issues.map((c) => c.id))),
    deleteStale(sb, tenantId, "store_desk_issue_lines", issueLineFlat.keep),
    deleteStale(sb, tenantId, "store_desk_movements", new Set(movements.map((c) => c.id))),
    deleteStale(
      sb,
      tenantId,
      "store_desk_inventory_allocations",
      new Set(inventoryAllocations.map((c) => c.id)),
    ),
    deleteStale(
      sb,
      tenantId,
      "store_desk_asset_allocations",
      new Set(assetAllocations.map((c) => c.id)),
    ),
    deleteStale(sb, tenantId, "store_desk_sell_returns", new Set(sellReturns.map((c) => c.id))),
    deleteStale(sb, tenantId, "store_desk_sell_return_lines", sellReturnLineFlat.keep),
  ]);

  const tables: [string, Record<string, unknown>[]][] = [
    ["store_desk_categories", categories.map((c) => categoryToRow(tenantId, c))],
    ["store_desk_sale_groups", saleGroups.map((g) => saleGroupToRow(tenantId, g))],
    ["store_desk_uoms", uoms.map((c) => namedMasterToRow(tenantId, c))],
    ["store_desk_infra_levels", infraLevels.map((c) => namedMasterToRow(tenantId, c))],
    ["store_desk_sources", sources.map((s) => sourceToRow(tenantId, s))],
    ["store_desk_items", items.map((i) => itemToRow(tenantId, i))],
    ["store_desk_issues", issues.map((i) => issueToRow(tenantId, i))],
    [
      "store_desk_issue_lines",
      issueLineFlat.rows.map((r) => ({ ...r, tenant_id: tenantId })),
    ],
    ["store_desk_movements", movements.map((m) => movementToRow(tenantId, m))],
    [
      "store_desk_inventory_allocations",
      inventoryAllocations.map((a) => inventoryAllocToRow(tenantId, a)),
    ],
    [
      "store_desk_asset_allocations",
      assetAllocations.map((a) => assetAllocToRow(tenantId, a)),
    ],
    ["store_desk_sell_returns", sellReturns.map((r) => sellReturnToRow(tenantId, r))],
    [
      "store_desk_sell_return_lines",
      sellReturnLineFlat.rows.map((r) => ({ ...r, tenant_id: tenantId })),
    ],
  ];

  for (const [table, rows] of tables) {
    const r = await upsertChunks(sb, table, rows);
    if (!r.ok) return r;
  }

  const openDue = issues.filter(
    (i) => i.paymentStatus === "due" && !i.voidedAt,
  );
  let lastIssueAt: string | null = null;
  for (const i of issues) {
    const at = i.issuedOn;
    if (at && (!lastIssueAt || at > lastIssueAt)) lastIssueAt = at;
  }

  await sb.from("store_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      category_count: categories.length,
      item_count: items.length,
      issue_count: issues.length,
      movement_count: movements.length,
      open_due_count: openDue.length,
      last_issue_at: lastIssueAt,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true };
}

export async function fetchStoreDeskFromDb(): Promise<{
  bundle: StoreDeskBundle;
  meta: StoreDeskSyncMeta | null;
}> {
  const ctx = await resolveCtx();
  const empty: StoreDeskBundle = {
    categories: [],
    saleGroups: [],
    uoms: [],
    infraLevels: [],
    sources: [],
    items: [],
    issues: [],
    movements: [],
    inventoryAllocations: [],
    assetAllocations: [],
    sellReturns: [],
  };
  if (!ctx) return { bundle: empty, meta: null };
  const { sb, tenantId } = ctx;

  const [
    { data: categoryRows },
    { data: saleGroupRows },
    { data: uomRows },
    { data: infraRows },
    { data: sourceRows },
    { data: itemRows },
    { data: issueRows },
    { data: issueLineRows },
    { data: movementRows },
    { data: invAllocRows },
    { data: assetAllocRows },
    { data: sellReturnRows },
    { data: sellReturnLineRows },
    { data: metaRow },
  ] = await Promise.all([
    sb.from("store_desk_categories").select("*").eq("tenant_id", tenantId),
    sb.from("store_desk_sale_groups").select("*").eq("tenant_id", tenantId),
    sb.from("store_desk_uoms").select("*").eq("tenant_id", tenantId),
    sb.from("store_desk_infra_levels").select("*").eq("tenant_id", tenantId),
    sb.from("store_desk_sources").select("*").eq("tenant_id", tenantId),
    sb.from("store_desk_items").select("*").eq("tenant_id", tenantId),
    sb.from("store_desk_issues").select("*").eq("tenant_id", tenantId),
    sb.from("store_desk_issue_lines").select("*").eq("tenant_id", tenantId),
    sb.from("store_desk_movements").select("*").eq("tenant_id", tenantId),
    sb.from("store_desk_inventory_allocations").select("*").eq("tenant_id", tenantId),
    sb.from("store_desk_asset_allocations").select("*").eq("tenant_id", tenantId),
    sb.from("store_desk_sell_returns").select("*").eq("tenant_id", tenantId),
    sb.from("store_desk_sell_return_lines").select("*").eq("tenant_id", tenantId),
    sb
      .from("store_desk_sync_meta")
      .select(META_SELECT)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  const linesByIssue = new Map<string, StoreIssueLine[]>();
  for (const row of issueLineRows ?? []) {
    const r = row as Record<string, unknown>;
    const issueId = String(r.issue_id);
    const list = linesByIssue.get(issueId) ?? [];
    list.push(rowToIssueLine(r));
    linesByIssue.set(issueId, list);
  }

  const issues = (issueRows ?? []).map((r) => {
    const rec = r as Record<string, unknown>;
    const id = String(rec.id);
    const lines = (linesByIssue.get(id) ?? []).slice();
    return rowToIssue(rec, lines);
  });

  const returnLinesByReturn = new Map<string, StoreSellReturnLine[]>();
  for (const row of sellReturnLineRows ?? []) {
    const r = row as Record<string, unknown>;
    const returnId = String(r.return_id);
    const list = returnLinesByReturn.get(returnId) ?? [];
    list.push(rowToSellReturnLine(r));
    returnLinesByReturn.set(returnId, list);
  }

  const sellReturns = (sellReturnRows ?? []).map((r) => {
    const rec = r as Record<string, unknown>;
    const id = String(rec.id);
    const lines = (returnLinesByReturn.get(id) ?? []).slice();
    return rowToSellReturn(rec, lines);
  });

  return {
    bundle: {
      categories: (categoryRows ?? []).map((r) =>
        rowToCategory(r as Record<string, unknown>),
      ),
      saleGroups: (saleGroupRows ?? []).map((r) =>
        rowToSaleGroup(r as Record<string, unknown>),
      ),
      uoms: (uomRows ?? []).map((r) =>
        rowToNamedMaster(r as Record<string, unknown>),
      ) as StoreUom[],
      infraLevels: (infraRows ?? []).map((r) =>
        rowToNamedMaster(r as Record<string, unknown>),
      ) as StoreInfraLevel[],
      sources: (sourceRows ?? []).map((r) => rowToSource(r as Record<string, unknown>)),
      items: (itemRows ?? []).map((r) => rowToItem(r as Record<string, unknown>)),
      issues,
      movements: (movementRows ?? []).map((r) =>
        rowToMovement(r as Record<string, unknown>),
      ),
      inventoryAllocations: (invAllocRows ?? []).map((r) =>
        rowToInventoryAlloc(r as Record<string, unknown>),
      ),
      assetAllocations: (assetAllocRows ?? []).map((r) =>
        rowToAssetAlloc(r as Record<string, unknown>),
      ),
      sellReturns,
    },
    meta: metaRow
      ? {
          categoryCount: (metaRow as { category_count: number }).category_count,
          itemCount: (metaRow as { item_count: number }).item_count,
          issueCount: (metaRow as { issue_count: number }).issue_count,
          movementCount: (metaRow as { movement_count: number }).movement_count,
          openDueCount: (metaRow as { open_due_count: number }).open_due_count,
          lastIssueAt: (metaRow as { last_issue_at: string | null }).last_issue_at,
          updatedAt: String((metaRow as { updated_at: string }).updated_at),
        }
      : null,
  };
}
